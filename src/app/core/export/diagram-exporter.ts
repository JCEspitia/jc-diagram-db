import type { jsPDF as JsPDF } from 'jspdf';
import {
  ColumnSchema,
  DatabaseSchema,
  DiagramAreaLayout,
  DiagramLayout,
  TableSchema,
} from '../schema';
import { DEFAULT_TABLE_COLOR } from '../../shared/table-colors';

export type DiagramExportFormat = 'svg' | 'png' | 'pdf';

interface ExportModel {
  schema: DatabaseSchema;
  layout: DiagramLayout;
  projectName: string;
  areaId?: string;
}

interface RenderedSvg {
  source: string;
  width: number;
  height: number;
}

const TABLE_WIDTH = 220;
const HEADER_HEIGHT = 34;
const ROW_HEIGHT = 30;
const PADDING = 48;

export async function exportDiagram(
  model: ExportModel,
  format: DiagramExportFormat,
): Promise<void> {
  const filename = safeFilename(
    `${model.projectName}${model.areaId ? `-${areaName(model, model.areaId)}` : ''}`,
  );
  if (format === 'svg') {
    download(
      new Blob([renderDiagramSvg(model).source], { type: 'image/svg+xml;charset=utf-8' }),
      `${filename}.svg`,
    );
  } else if (format === 'png') {
    download(await svgToPng(renderDiagramSvg(model)), `${filename}.png`);
  } else {
    await exportPdf(model, filename);
  }
}

export function renderDiagramSvg(model: ExportModel): RenderedSvg {
  const tableIds = scopedTableIds(model);
  const tables = model.schema.tables.filter(({ id }) => tableIds.has(id));
  const tableBoxes = tables.map((table) => {
    const position = model.layout.tables[table.id] ?? { x: 0, y: 0 };
    const columns = visibleColumns(model, table);
    return {
      table,
      columns,
      x: position.x,
      y: position.y,
      width: position.width ?? TABLE_WIDTH,
      height: HEADER_HEIGHT + columns.length * ROW_HEIGHT,
    };
  });
  const areas = Object.entries(model.layout.areas ?? {}).filter(
    ([id]) => !model.areaId || id === model.areaId,
  );
  const rawBounds = [
    ...tableBoxes.map(({ x, y, width, height }) => ({
      left: x,
      top: y,
      right: x + width,
      bottom: y + height,
    })),
    ...areas.map(([_id, area]) => ({
      left: area.x,
      top: area.y,
      right: area.x + area.width,
      bottom: area.y + area.height,
    })),
  ];
  const left = (rawBounds.length ? Math.min(...rawBounds.map(({ left }) => left)) : 0) - PADDING;
  const top = (rawBounds.length ? Math.min(...rawBounds.map(({ top }) => top)) : 0) - PADDING;
  const right =
    (rawBounds.length ? Math.max(...rawBounds.map(({ right }) => right)) : 640) + PADDING;
  const bottom =
    (rawBounds.length ? Math.max(...rawBounds.map(({ bottom }) => bottom)) : 360) + PADDING;
  const width = Math.max(320, right - left);
  const height = Math.max(220, bottom - top);
  const translate = `translate(${-left} ${-top})`;

  const areaMarkup = areas
    .map(
      ([_id, area]) => `<g>
      <rect x="${area.x}" y="${area.y}" width="${area.width}" height="${area.height}" rx="8" fill="${area.color}12" stroke="${area.color}" stroke-width="1.5"/>
      <rect x="${area.x}" y="${area.y}" width="${area.width}" height="30" rx="7" fill="${area.color}"/>
      <rect x="${area.x}" y="${area.y + 23}" width="${area.width}" height="7" fill="${area.color}"/>
      <text x="${area.x + 12}" y="${area.y + 20}" class="area-title">${xml(area.name)}</text>
    </g>`,
    )
    .join('');

  const relationshipMarkup = model.schema.relationships
    .filter(
      ({ sourceTableId, targetTableId }) =>
        tableIds.has(sourceTableId) && tableIds.has(targetTableId),
    )
    .map((relationship) => {
      const source = tableBoxes.find(({ table }) => table.id === relationship.sourceTableId);
      const target = tableBoxes.find(({ table }) => table.id === relationship.targetTableId);
      if (!source || !target) return '';
      const sourceIndex = Math.max(
        0,
        source.columns.findIndex(({ id }) => id === relationship.sourceColumnId),
      );
      const targetIndex = Math.max(
        0,
        target.columns.findIndex(({ id }) => id === relationship.targetColumnId),
      );
      const sourceRight = source.x <= target.x;
      const routeLayout = model.layout.relationships?.[relationship.id];
      const sourceSide = routeLayout?.sourceSide ?? (sourceRight ? 'right' : 'left');
      const targetSide = routeLayout?.targetSide ?? (sourceRight ? 'left' : 'right');
      const sx = source.x + (sourceSide === 'right' ? source.width : 0);
      const tx = target.x + (targetSide === 'right' ? target.width : 0);
      const sy = source.y + HEADER_HEIGHT + sourceIndex * ROW_HEIGHT + ROW_HEIGHT / 2;
      const ty = target.y + HEADER_HEIGHT + targetIndex * ROW_HEIGHT + ROW_HEIGHT / 2;
      const sourceLane =
        routeLayout?.sourceX ?? routeLayout?.routeX ?? sx + (sourceSide === 'right' ? 36 : -36);
      const targetLane =
        routeLayout?.targetX ?? routeLayout?.routeX ?? tx + (targetSide === 'right' ? 36 : -36);
      const routeY = routeLayout?.routeY ?? (sy + ty) / 2;
      const path = routeLayout?.waypoints?.length
        ? polylinePath([{ x: sx, y: sy }, ...routeLayout.waypoints, { x: tx, y: ty }])
        : `M ${sx} ${sy} H ${sourceLane} V ${routeY} H ${targetLane} V ${ty} H ${tx}`;
      const sourceCardinality =
        relationship.sourceCardinality ?? (relationship.type === 'many-to-one' ? 'many' : 'one');
      const targetCardinality =
        relationship.targetCardinality ?? (relationship.type === 'one-to-many' ? 'many' : 'one');
      return `<path d="${path}" fill="none" stroke="#8190a0" stroke-width="1.5" stroke-linejoin="round"/>
        ${cardinalityMarkup(sx + (sourceSide === 'right' ? 12 : -12), sy, sourceCardinality)}
        ${cardinalityMarkup(tx + (targetSide === 'right' ? 12 : -12), ty, targetCardinality)}`;
    })
    .join('');

  const tableMarkup = tableBoxes
    .map(({ table, columns, x, y, width: tableWidth, height: tableHeight }) => {
      const foreignKeys = foreignKeyIds(model.schema, table.id);
      const primaryKeys = primaryKeyIds(table);
      const rows = columns
        .map((column, index) => {
          const icons = columnVisualIndicators(
            model.schema,
            column,
            primaryKeys.has(column.id),
            foreignKeys.has(column.id),
          );
          const row = columnRowLayout(tableWidth, column, icons.iconCount, icons.badgeCount);
          return `<g transform="translate(0 ${HEADER_HEIGHT + index * ROW_HEIGHT})">
        <rect width="${tableWidth}" height="${ROW_HEIGHT}" fill="${index % 2 ? '#fbfcfd' : '#ffffff'}"/>
        <text x="${row.nameX}" y="19" class="column-name">${xml(shortenToWidth(column.name, row.nameWidth, 5.8))}</text>
        <g transform="translate(${row.iconsX} 9)">${icons.icons}</g>
        <text x="${row.typeX}" y="19" class="column-type">${xml(shortenToWidth(column.type, row.typeWidth, 5.6))}</text>
        <g transform="translate(${row.badgesX} 8)">${icons.badges}</g>
        <circle cx="${row.handleX}" cy="${ROW_HEIGHT / 2}" r="3" fill="#fff" stroke="#aab5c0"/>
        <line x1="0" y1="${ROW_HEIGHT}" x2="${tableWidth}" y2="${ROW_HEIGHT}" stroke="#e7ebef"/>
      </g>`;
        })
        .join('');
      return `<g transform="translate(${x} ${y})" filter="url(#shadow)">
      <rect width="${tableWidth}" height="${tableHeight}" rx="5" fill="#ffffff" stroke="#cbd3da"/>
      <rect width="${tableWidth}" height="${HEADER_HEIGHT}" rx="5" fill="${table.color ?? DEFAULT_TABLE_COLOR}"/>
      <rect y="${HEADER_HEIGHT - 6}" width="${tableWidth}" height="6" fill="${table.color ?? DEFAULT_TABLE_COLOR}"/>
      <g transform="translate(10 11)" class="header-table-icon"><rect width="13" height="13" rx="2"/><path d="M1 5h11M5 1v11"/></g>
      <text x="30" y="23" class="table-title">${xml(table.name)}</text>
      ${table.note || table.checks?.length ? '<g transform="translate(' + (tableWidth - 22) + ' 11)" class="header-info"><circle cx="7" cy="7" r="6"/><path d="M7 6v5M7 3.7v.2"/></g>' : ''}
      ${rows}
    </g>`;
    })
    .join('');

  return {
    width,
    height,
    source: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      <defs><filter id="shadow" x="-20%" y="-20%" width="140%" height="150%"><feDropShadow dx="0" dy="2" stdDeviation="3" flood-opacity=".16"/></filter></defs>
      <style>text{font-family:Inter,Arial,sans-serif}.table-title,.area-title{fill:#fff;font-size:12px;font-weight:700}.column-name{fill:#2e3943;font-size:11px}.column-type{fill:#7a8792;font-size:9px}.export-icon{fill:none;stroke:currentColor;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round}.pk-icon{color:#d89b22}.fk-icon{color:#718294}.comment-icon{color:#8493a3}.unique-icon{color:#8a6bd1}.info-icon{color:#3e91c9}.row-badge rect{fill:#edf0f3;stroke:#d7dce1}.row-badge text{fill:#66727d;font-size:7px;font-weight:700}.cardinality circle{fill:#fff;stroke:#8190a0}.cardinality text{fill:#657583;font-size:7px;font-weight:700}.header-table-icon,.header-info{fill:none;stroke:#fff;stroke-width:1.4;stroke-linecap:round;stroke-linejoin:round;opacity:.9}</style>
      <rect width="100%" height="100%" fill="#f8fafb"/>
      <g transform="${translate}">${areaMarkup}${relationshipMarkup}${tableMarkup}</g>
    </svg>`,
  };
}

async function exportPdf(model: ExportModel, filename: string): Promise<void> {
  const { jsPDF } = await import('jspdf');
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  await addDiagramPage(
    pdf,
    renderDiagramSvg(model),
    model.areaId ? areaName(model, model.areaId) : model.projectName,
  );
  if (!model.areaId) {
    for (const areaId of Object.keys(model.layout.areas ?? {})) {
      pdf.addPage('a4', 'landscape');
      await addDiagramPage(pdf, renderDiagramSvg({ ...model, areaId }), areaName(model, areaId));
    }
  }
  addDocumentationPages(pdf, model);
  pdf.save(`${filename}.pdf`);
}

async function addDiagramPage(pdf: JsPDF, svg: RenderedSvg, title: string): Promise<void> {
  const blob = await svgToPng(svg, 1.6);
  const data = await blobToDataUrl(blob);
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(15);
  pdf.setTextColor(35, 45, 55);
  pdf.text(title, 12, 12);
  const scale = Math.min((pageWidth - 20) / svg.width, (pageHeight - 24) / svg.height);
  const width = svg.width * scale;
  const height = svg.height * scale;
  pdf.addImage(data, 'PNG', (pageWidth - width) / 2, 18, width, height, undefined, 'FAST');
}

function addDocumentationPages(pdf: JsPDF, model: ExportModel): void {
  const ids = scopedTableIds(model);
  const tables = model.schema.tables.filter(({ id }) => ids.has(id));
  const enums = model.schema.enums.filter((item) =>
    tables.some((table) =>
      table.columns.some((column) => normalizeType(column.type) === item.name.toLowerCase()),
    ),
  );
  let y = 18;
  const newPage = (title = 'Schema documentation') => {
    pdf.addPage('a4', 'portrait');
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(16);
    pdf.setTextColor(35, 45, 55);
    pdf.text(title, 14, 16);
    y = 25;
  };
  const ensure = (height: number) => {
    if (y + height > pdf.internal.pageSize.getHeight() - 14) newPage();
  };
  const text = (
    value: string,
    indent = 14,
    size = 9,
    color: [number, number, number] = [72, 82, 92],
  ) => {
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(size);
    pdf.setTextColor(...color);
    const lines = pdf.splitTextToSize(
      value,
      pdf.internal.pageSize.getWidth() - indent - 14,
    ) as string[];
    ensure(lines.length * 4.2 + 2);
    pdf.text(lines, indent, y);
    y += lines.length * 4.2 + 2;
  };
  newPage(model.areaId ? `${areaName(model, model.areaId)} documentation` : 'Schema documentation');
  text(
    `${tables.length} tables · ${model.schema.relationships.length} relationships · ${enums.length} referenced enums`,
  );
  for (const enumSchema of enums) {
    ensure(16);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(12);
    pdf.setTextColor(92, 72, 160);
    pdf.text(`Enum ${enumSchema.name}`, 14, y);
    y += 6;
    text(enumSchema.values.join('  ·  '), 18);
  }
  for (const table of tables) {
    ensure(24);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(13);
    pdf.setTextColor(30, 105, 165);
    pdf.text(`Table ${table.schema ? `${table.schema}.` : ''}${table.name}`, 14, y);
    y += 6;
    if (table.note) text(`Comment: ${table.note}`, 18);
    for (const column of table.columns) {
      const flags = columnFlags(model.schema, table, column);
      text(
        `${column.name}  ${column.type}${flags.length ? `  [${flags.join(', ')}]` : ''}`,
        18,
        9,
        [45, 55, 65],
      );
      if (column.note) text(`Comment: ${column.note}`, 24, 8, [100, 108, 116]);
      if (column.defaultValue !== undefined)
        text(`Default: ${column.defaultValue}`, 24, 8, [100, 108, 116]);
    }
    for (const check of table.checks ?? []) text(`Check: ${check.expression}`, 18, 8);
    for (const index of table.indexes) {
      const names = index.columns.map(
        (id) => table.columns.find((column) => column.id === id)?.name ?? id,
      );
      text(
        `Index${index.name ? ` ${index.name}` : ''}: (${names.join(', ')})${index.primaryKey ? ' primary' : ''}${index.unique ? ' unique' : ''}`,
        18,
        8,
      );
    }
    y += 3;
  }
}

function columnVisualIndicators(
  schema: DatabaseSchema,
  column: ColumnSchema,
  primaryKey: boolean,
  foreignKey: boolean,
): { icons: string; badges: string; iconCount: number; badgeCount: number } {
  const markers: string[] = [];
  if (primaryKey) {
    markers.push(
      '<g class="export-icon pk-icon" transform="scale(.5)"><path d="M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z"/><circle cx="16.5" cy="7.5" r=".5" fill="currentColor"/></g>',
    );
  }
  if (foreignKey) {
    markers.push(
      '<g class="export-icon fk-icon" transform="scale(.5)"><path d="M9 17H7A5 5 0 0 1 7 7h2M15 7h2a5 5 0 1 1 0 10h-2M8 12h8"/></g>',
    );
  }
  if (column.note) {
    markers.push(
      '<g class="export-icon comment-icon" transform="scale(.5)"><path d="M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2zM7 11h10M7 15h6M7 7h8"/></g>',
    );
  }
  if (column.unique) {
    markers.push(
      '<g class="export-icon unique-icon" transform="scale(.5)"><path d="M12 10a2 2 0 0 0-2 2c0 1.02-.1 2.51-.26 4M14 13.12c0 2.38 0 6.38-1 8.88M17.29 21.02c.12-.6.43-2.3.5-3.02M2 12A10 10 0 0 1 20 6M2 16h.01M21.8 16c.2-2 .131-5.354 0-6M5 19.5C5.5 18 6 15 6 12a6 6 0 0 1 .34-2M8.65 22c.21-.66.45-1.32.57-2M9 6.8a6 6 0 0 1 9 5.2v2"/></g>',
    );
  }
  const enumName = normalizeType(column.type);
  const hasAdditionalInfo =
    Boolean(column.note) ||
    column.defaultValue !== undefined ||
    schema.enums.some(({ name }) => name.toLowerCase() === enumName);
  if (hasAdditionalInfo) {
    markers.push(
      '<g class="export-icon info-icon" transform="scale(.5)"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></g>',
    );
  }
  const icons = markers
    .map((marker, index) => `<g transform="translate(${index * 15} 0)">${marker}</g>`)
    .join('');
  const badgeValues = [!column.nullable ? 'NN' : '', column.increment ? 'AI' : ''].filter(Boolean);
  const badges = badgeValues
    .map(
      (value, index) => `<g class="row-badge" transform="translate(${index * 18} 0)">
        <rect width="16" height="13" rx="2"/><text x="8" y="9" text-anchor="middle">${value}</text>
      </g>`,
    )
    .join('');
  return { icons, badges, iconCount: markers.length, badgeCount: badgeValues.length };
}

function cardinalityMarkup(x: number, y: number, cardinality: 'zero' | 'one' | 'many'): string {
  const label = cardinality === 'many' ? 'N' : cardinality === 'zero' ? '0' : '1';
  return `<g class="cardinality"><circle cx="${x}" cy="${y}" r="7"/><text x="${x}" y="${y + 2.5}" text-anchor="middle">${label}</text></g>`;
}

function polylinePath(points: { x: number; y: number }[]): string {
  return points.map(({ x, y }, index) => `${index ? 'L' : 'M'} ${x} ${y}`).join(' ');
}

function visibleColumns(model: ExportModel, table: TableSchema): ColumnSchema[] {
  const level = model.layout.detailLevel ?? 'all';
  if (level === 'names') return [];
  if (level === 'all') return table.columns;
  const keys = new Set([...primaryKeyIds(table), ...foreignKeyIds(model.schema, table.id)]);
  return table.columns.filter(({ id }) => keys.has(id));
}

function scopedTableIds(model: ExportModel): Set<string> {
  return new Set(
    model.areaId
      ? (model.layout.areas?.[model.areaId]?.tableIds ?? [])
      : model.schema.tables.map(({ id }) => id),
  );
}

function primaryKeyIds(table: TableSchema): Set<string> {
  return new Set([
    ...table.columns.filter(({ primaryKey }) => primaryKey).map(({ id }) => id),
    ...table.indexes.filter(({ primaryKey }) => primaryKey).flatMap(({ columns }) => columns),
  ]);
}

function foreignKeyIds(schema: DatabaseSchema, tableId: string): Set<string> {
  return new Set(
    schema.relationships.flatMap((relationship) => [
      ...(relationship.sourceTableId === tableId ? [relationship.sourceColumnId] : []),
      ...(relationship.targetTableId === tableId ? [relationship.targetColumnId] : []),
    ]),
  );
}

function columnFlags(schema: DatabaseSchema, table: TableSchema, column: ColumnSchema): string[] {
  const flags: string[] = [];
  if (primaryKeyIds(table).has(column.id)) flags.push('PK');
  if (foreignKeyIds(schema, table.id).has(column.id)) flags.push('FK');
  if (!column.nullable) flags.push('not null');
  if (column.unique) flags.push('unique');
  if (column.increment) flags.push('increment');
  return flags;
}

async function svgToPng(svg: RenderedSvg, scale = 2): Promise<Blob> {
  const url = URL.createObjectURL(new Blob([svg.source], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    const image = new Image();
    image.decoding = 'async';
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('Could not render the exported SVG'));
      image.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(svg.width * scale);
    canvas.height = Math.ceil(svg.height * scale);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas export is not supported by this browser');
    context.scale(scale, scale);
    context.drawImage(image, 0, 0, svg.width, svg.height);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('Could not create PNG'))),
        'image/png',
      ),
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}

function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url));
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function areaName(model: ExportModel, areaId: string): string {
  return model.layout.areas?.[areaId]?.name ?? 'area';
}

function normalizeType(type: string): string {
  return type.replace(/\[\]$/, '').split('.').at(-1)?.replaceAll('"', '').toLowerCase() ?? type;
}

function columnRowLayout(
  tableWidth: number,
  column: ColumnSchema,
  iconCount: number,
  badgeCount: number,
): {
  nameX: number;
  nameWidth: number;
  iconsX: number;
  typeX: number;
  typeWidth: number;
  badgesX: number;
  handleX: number;
} {
  const nameX = 8;
  const innerRight = tableWidth - 8;
  const handleWidth = 6;
  const handleX = innerRight - handleWidth / 2;
  const badgesWidth = badgeCount ? badgeCount * 16 + (badgeCount - 1) * 3 : 0;
  const badgesX = innerRight - handleWidth - 5 - badgesWidth;
  const typeWidth = Math.min(55, Math.max(22, column.type.length * 5.6));
  const typeX = badgesX - 5 - typeWidth;
  const iconsWidth = iconCount ? 12 + (iconCount - 1) * 15 : 0;
  const iconsX = typeX - 5 - iconsWidth;
  return {
    nameX,
    nameWidth: Math.max(24, iconsX - 5 - nameX),
    iconsX,
    typeX,
    typeWidth,
    badgesX,
    handleX,
  };
}

function shortenToWidth(value: string, width: number, averageCharacterWidth: number): string {
  const length = Math.max(1, Math.floor(width / averageCharacterWidth));
  return value.length <= length ? value : `${value.slice(0, Math.max(1, length - 1))}…`;
}

function safeFilename(value: string): string {
  return (
    value
      .trim()
      .replace(/[^a-z0-9._-]+/gi, '-')
      .replace(/^-|-$/g, '') || 'diagram'
  );
}

function xml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
