import type { jsPDF as JsPDF } from 'jspdf';
import {
  ColumnSchema,
  DatabaseSchema,
  DiagramAreaLayout,
  DiagramLayout,
  TableSchema,
} from '../schema';
import { DEFAULT_TABLE_COLOR } from '../../shared/table-colors';
import { saveBlob } from '../import-export/save-file';
import { roundedPolylinePath } from '../diagram/diagram-geometry';

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

export interface DiagramExportOptions {
  pngScale?: number;
}

const TABLE_WIDTH = 220;
const HEADER_HEIGHT = 34;
const ROW_HEIGHT = 30;
const PADDING = 48;

export async function exportDiagram(
  model: ExportModel,
  format: DiagramExportFormat,
  options: DiagramExportOptions = {},
): Promise<void> {
  const filename = safeFilename(
    `${model.projectName}${model.areaId ? `-${areaName(model, model.areaId)}` : ''}`,
  );
  if (format === 'svg') {
    await saveBlob(
      new Blob([renderDiagramSvg(model).source], { type: 'image/svg+xml;charset=utf-8' }),
      `${filename}.svg`,
    );
  } else if (format === 'png') {
    await saveBlob(await svgToPng(renderDiagramSvg(model), options.pngScale ?? 2), `${filename}.png`);
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
      const sourceOffset = endpointPortOffset(model.schema, relationship, 'source');
      const targetOffset = endpointPortOffset(model.schema, relationship, 'target');
      const sy = source.y + HEADER_HEIGHT + sourceIndex * ROW_HEIGHT + ROW_HEIGHT / 2 + sourceOffset;
      const ty = target.y + HEADER_HEIGHT + targetIndex * ROW_HEIGHT + ROW_HEIGHT / 2 + targetOffset;
      const sourceLane =
        routeLayout?.sourceX ?? routeLayout?.routeX ?? sx + (sourceSide === 'right' ? 36 : -36);
      const targetLane =
        routeLayout?.targetX ?? routeLayout?.routeX ?? tx + (targetSide === 'right' ? 36 : -36);
      const routeY = routeLayout?.routeY ?? (sy + ty) / 2;
      const automaticPoints = [
        { x: sx, y: sy },
        { x: sourceLane, y: sy },
        { x: sourceLane, y: routeY },
        { x: targetLane, y: routeY },
        { x: targetLane, y: ty },
        { x: tx, y: ty },
      ];
      const manualPoints = routeLayout?.waypoints?.length
        ? [{ x: sx, y: sy }, ...routeLayout.waypoints, { x: tx, y: ty }]
        : null;
      const points = manualPoints && isOrthogonalPolyline(manualPoints) ? manualPoints : automaticPoints;
      const path = roundedPolylinePath(points);
      const sourceCardinality =
        relationship.sourceCardinality ?? (relationship.type === 'many-to-one' ? 'many' : 'one');
      const targetCardinality =
        relationship.targetCardinality ?? (relationship.type === 'one-to-many' ? 'many' : 'one');
      return `<path d="${path}" fill="none" stroke="#a8adb4" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        ${cardinalityMarkup(sx, sy, sourceLane, sourceCardinality)}
        ${cardinalityMarkup(tx, ty, targetLane, targetCardinality)}`;
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
      <style>text{font-family:Inter,Arial,sans-serif}.table-title,.area-title{fill:#fff;font-size:12px;font-weight:700}.column-name{fill:#2e3943;font-size:11px}.column-type{fill:#7a8792;font-size:9px}.export-icon{fill:none;stroke:currentColor;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round}.pk-icon{color:#d89b22}.fk-icon{color:#718294}.comment-icon{color:#8493a3}.unique-icon{color:#8a6bd1}.info-icon{color:#3e91c9}.row-badge rect{fill:#edf0f3;stroke:#d7dce1}.row-badge text{fill:#66727d;font-size:7px;font-weight:700}.cardinality{fill:none;stroke:#87909a;stroke-width:1.25;stroke-linecap:round}.cardinality-label{fill:#59636e;font-size:8px;font-weight:700;paint-order:stroke;stroke:#fff;stroke-width:2.5}.header-table-icon,.header-info{fill:none;stroke:#fff;stroke-width:1.4;stroke-linecap:round;stroke-linejoin:round;opacity:.9}</style>
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
  await saveBlob(pdf.output('blob'), `${filename}.pdf`);
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
  const margin = 14;
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const contentWidth = pageWidth - margin * 2;
  const columns = [44, 38, 50, 42, contentWidth - 174] as const;
  let y = 25;
  const newPage = (title = 'Schema documentation') => {
    pdf.addPage('a4', 'landscape');
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(16);
    pdf.setTextColor(35, 45, 55);
    pdf.text(title, margin, 16);
    y = 25;
  };
  const ensure = (height: number) => {
    if (y + height > pageHeight - margin) newPage();
  };
  newPage(model.areaId ? `${areaName(model, model.areaId)} documentation` : 'Schema documentation');
  pdf.setFillColor(244, 247, 250);
  pdf.roundedRect(margin, y - 5, contentWidth, 10, 2, 2, 'F');
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(8);
  pdf.setTextColor(78, 91, 104);
  pdf.text(
    `${tables.length} tables  ·  ${model.schema.relationships.length} relationships  ·  ${enums.length} referenced enums`,
    margin + 4,
    y + 1,
  );
  y += 13;
  for (const enumSchema of enums) {
    const enumName = pdf.splitTextToSize(enumSchema.name, contentWidth - 31) as string[];
    const enumValues = pdf.splitTextToSize(enumSchema.values.join('  ·  '), contentWidth - 12) as string[];
    const enumHeight = enumName.length * 4 + enumValues.length * 3.8 + 13;
    ensure(enumHeight + 3);
    pdf.setFillColor(248, 246, 253);
    pdf.roundedRect(margin, y - 2, contentWidth, enumHeight, 3, 3, 'F');
    pdf.setFillColor(110, 85, 170);
    pdf.roundedRect(margin + 4, y + 1, 19, 6, 1.5, 1.5, 'F');
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(6.5);
    pdf.setTextColor(255, 255, 255);
    pdf.text('ENUM', margin + 13.5, y + 5.1, { align: 'center' });
    pdf.setFontSize(8.5);
    pdf.setTextColor(85, 63, 145);
    pdf.text(enumName, margin + 27, y + 5.2);
    const dividerY = y + enumName.length * 4 + 7;
    pdf.setDrawColor(218, 210, 237);
    pdf.line(margin + 4, dividerY, pageWidth - margin - 4, dividerY);
    pdf.setFont('helvetica', 'normal');
    pdf.setTextColor(96, 85, 120);
    pdf.setFontSize(7.5);
    pdf.text(enumValues, margin + 6, dividerY + 4.2);
    y += enumHeight + 3;
  }
  for (const table of tables) {
    const color = hexColor(table.color ?? DEFAULT_TABLE_COLOR);
    const title = `${table.schema ? `${table.schema}.` : ''}${table.name}`;
    const drawTableHeader = (continued = false) => {
      ensure(10);
      pdf.setFillColor(...color);
      pdf.roundedRect(margin, y, contentWidth, 8, 2, 2, 'F');
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(11);
      pdf.setTextColor(255, 255, 255);
      pdf.text(title, margin + 4, y + 5.4);
      if (continued) {
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(7);
        pdf.text('continued', pageWidth - margin - 4, y + 5.2, { align: 'right' });
      }
      y += 8;
    };
    const drawColumnHeaders = () => {
      ensure(7);
      pdf.setFillColor(239, 243, 246);
      pdf.rect(margin, y, contentWidth, 6, 'F');
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(7);
      pdf.setTextColor(79, 92, 104);
      let x = margin + 2;
      for (const [index, label] of ['FIELD', 'TYPE', 'CONSTRAINTS', 'DEFAULT', 'DESCRIPTION'].entries()) {
        pdf.text(label, x, y + 4);
        x += columns[index]!;
      }
      y += 6;
    };
    // Do not leave a table title at the foot of a page. Tables may span pages,
    // but their header and first row always stay together.
    ensure(table.note ? 30 : 25);
    drawTableHeader();
    if (table.note) {
      const note = pdf.splitTextToSize(table.note, contentWidth - 31) as string[];
      const noteHeight = note.length * 3.6 + 6;
      if (y + noteHeight > pageHeight - margin) {
        newPage();
        drawTableHeader(true);
      }
      pdf.setFillColor(246, 249, 251);
      pdf.rect(margin, y, contentWidth, noteHeight, 'F');
      pdf.setFillColor(...color);
      pdf.rect(margin, y, 2, noteHeight, 'F');
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(7);
      pdf.setTextColor(...color);
      pdf.text('DESCRIPTION', margin + 5, y + 4);
      pdf.setFont('helvetica', 'italic');
      pdf.setFontSize(7.5);
      pdf.setTextColor(103, 114, 124);
      pdf.text(note, margin + 27, y + 4, { maxWidth: contentWidth - 31 });
      y += noteHeight;
    }
    drawColumnHeaders();
    for (const column of table.columns) {
      const flags = columnFlags(model.schema, table, column);
      const cells = [
        column.name,
        column.type,
        flags.join(' · '),
        column.defaultValue === undefined ? '—' : String(column.defaultValue),
        column.note ?? '—',
      ].map((value, index) => pdf.splitTextToSize(value, columns[index]! - 4) as string[]);
      const height = Math.max(...cells.map((lines) => lines.length)) * 3.6 + 5;
      if (y + height > pageHeight - margin) {
        newPage();
        drawTableHeader(true);
        drawColumnHeaders();
      }
      const rowColor: [number, number, number] =
        table.columns.indexOf(column) % 2 ? [250, 252, 253] : [255, 255, 255];
      pdf.setFillColor(...rowColor);
      pdf.rect(margin, y, contentWidth, height, 'F');
      pdf.setDrawColor(226, 231, 235);
      pdf.rect(margin, y, contentWidth, height, 'S');
      let x = margin;
      cells.forEach((lines, index) => {
        pdf.setFont('helvetica', index === 0 ? 'bold' : 'normal');
        pdf.setFontSize(index === 0 ? 8 : 7.5);
        const cellColor: [number, number, number] = index === 2 ? color : [55, 67, 78];
        pdf.setTextColor(...cellColor);
        pdf.text(lines, x + 2, y + 3.5);
        if (index > 0) pdf.line(x, y, x, y + height);
        x += columns[index]!;
      });
      y += height;
    }
    const details: { label: string; value: string }[] = [
      ...(table.checks ?? []).map((check) => ({ label: 'CHECK', value: check.expression })),
    ];
    for (const index of table.indexes) {
      const names = index.columns.map(
        (id) => table.columns.find((column) => column.id === id)?.name ?? id,
      );
      details.push(
        {
          label: 'INDEX',
          value: `${index.name ? `${index.name}: ` : ''}(${names.join(', ')})${index.primaryKey ? ' · primary' : ''}${index.unique ? ' · unique' : ''}`,
        },
      );
    }
    if (details.length) {
      const drawDetailsHeader = () => {
        ensure(7);
        pdf.setFillColor(244, 247, 249);
        pdf.rect(margin, y, contentWidth, 6, 'F');
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(7);
        pdf.setTextColor(...color);
        pdf.text('TABLE DETAILS', margin + 3, y + 4);
        y += 6;
      };
      if (y + 14 > pageHeight - margin) {
        newPage();
        drawTableHeader(true);
      }
      drawDetailsHeader();
      for (const detail of details) {
        const lines = pdf.splitTextToSize(detail.value, contentWidth - 31) as string[];
        const detailHeight = Math.max(7, lines.length * 3.7 + 4);
        if (y + detailHeight > pageHeight - margin) {
          newPage();
          drawTableHeader(true);
          drawDetailsHeader();
        }
        pdf.setFillColor(251, 252, 253);
        pdf.rect(margin, y, contentWidth, detailHeight, 'F');
        pdf.setDrawColor(226, 231, 235);
        pdf.rect(margin, y, contentWidth, detailHeight, 'S');
        pdf.setFillColor(...color);
        pdf.roundedRect(margin + 3, y + 2, 20, 4.5, 1, 1, 'F');
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(5.8);
        pdf.setTextColor(255, 255, 255);
        pdf.text(detail.label, margin + 13, y + 5.2, { align: 'center' });
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(7.5);
        pdf.setTextColor(78, 90, 101);
        pdf.text(lines, margin + 27, y + 4.2);
        y += detailHeight;
      }
    }
    y += 5;
  }
}

function hexColor(value: string): [number, number, number] {
  const normalized = value.replace('#', '');
  if (!/^[0-9a-f]{6}$/i.test(normalized)) return [81, 117, 178];
  return [
    Number.parseInt(normalized.slice(0, 2), 16),
    Number.parseInt(normalized.slice(2, 4), 16),
    Number.parseInt(normalized.slice(4, 6), 16),
  ];
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

function cardinalityMarkup(
  x: number,
  y: number,
  towardX: number,
  cardinality: 'zero' | 'one' | 'many',
): string {
  const direction = towardX >= x ? 1 : -1;
  const near = x + direction * 4;
  const far = x + direction * 12;
  const symbol =
    cardinality === 'zero'
      ? `M ${x + direction * 8} ${y - 3} a 3 3 0 1 0 0 6 a 3 3 0 1 0 0 -6`
      : cardinality === 'one'
        ? `M ${x + direction * 8} ${y - 5} V ${y + 5}`
        : `M ${far} ${y} L ${near} ${y - 5} M ${far} ${y} H ${near} M ${far} ${y} L ${near} ${y + 5}`;
  const label = cardinality === 'many' ? '*' : cardinality === 'zero' ? '0' : '1';
  return `<path class="cardinality" d="${symbol}"/><text class="cardinality-label" x="${x + direction * 19}" y="${y + 3}" text-anchor="middle">${label}</text>`;
}

function endpointPortOffset(
  schema: DatabaseSchema,
  relationship: DatabaseSchema['relationships'][number],
  endpoint: 'source' | 'target',
): number {
  const tableId = endpoint === 'source' ? relationship.sourceTableId : relationship.targetTableId;
  const columnId = endpoint === 'source' ? relationship.sourceColumnId : relationship.targetColumnId;
  const cardinality = endpointCardinality(relationship, endpoint);
  const cardinalities = (['zero', 'one', 'many'] as const).filter((candidate) =>
    schema.relationships.some(
      (item) =>
        (endpoint === 'source' ? item.sourceTableId : item.targetTableId) === tableId &&
        (endpoint === 'source' ? item.sourceColumnId : item.targetColumnId) === columnId &&
        endpointCardinality(item, endpoint) === candidate,
    ),
  );
  return (cardinalities.indexOf(cardinality) - (cardinalities.length - 1) / 2) * 12;
}

function endpointCardinality(
  relationship: DatabaseSchema['relationships'][number],
  endpoint: 'source' | 'target',
): 'zero' | 'one' | 'many' {
  return endpoint === 'source'
    ? (relationship.sourceCardinality ?? (relationship.type === 'many-to-one' ? 'many' : 'one'))
    : (relationship.targetCardinality ?? (relationship.type === 'one-to-many' ? 'many' : 'one'));
}

function isOrthogonalPolyline(points: { x: number; y: number }[]): boolean {
  return points.slice(0, -1).every((point, index) => {
    const next = points[index + 1]!;
    return Math.abs(point.x - next.x) < 0.01 || Math.abs(point.y - next.y) < 0.01;
  });
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
