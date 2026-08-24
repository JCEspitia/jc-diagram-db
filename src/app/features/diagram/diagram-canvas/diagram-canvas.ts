import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  computed,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import {
  columnAnchor,
  DEFAULT_TABLE_METRICS,
  defaultOrthogonalRoute,
  fitToScreen,
  moveOrthogonalSegment,
  normalizeOrthogonalPolyline,
  OrthogonalRoute,
  orthogonalRoutePoints,
  Point,
  pullOrthogonalSegment,
  roundedPolylinePath,
  routeAroundObstacles,
  screenToWorld,
  tableLayout,
  zoomAtPoint,
} from '../../../core/diagram/diagram-geometry';
import { DiagramOperation } from '../../../core/diagram/operations/diagram.operations';
import {
  ColumnSchema,
  DatabaseSchema,
  DiagramAreaLayout,
  DiagramLayout,
  RelationshipLayout,
  RelationshipSchema,
  TableLayout,
  TableSchema,
  ViewportState,
} from '../../../core/schema';
import { TableNode } from '../table-node/table-node';
import { DiagramArea } from '../diagram-area/diagram-area';
import { TooltipDirective } from '../../../shared/tooltip/tooltip.directive';
import {
  LucideArrowLeftFromLine,
  LucideArrowRightFromLine,
  LucideRotateCcw,
  LucideSettings,
  LucideTrash2,
} from '@lucide/angular';

interface RenderedRelationship {
  relationship: RelationshipSchema;
  path: string;
  source: { x: number; y: number };
  target: { x: number; y: number };
  route: OrthogonalRoute;
  points: Point[];
  handles: RouteSegmentHandle[];
  pullCandidates: RouteSegmentHandle[];
  resetPoint: Point;
  canReset: boolean;
  sourceSide: 'left' | 'right';
  targetSide: 'left' | 'right';
  sourceCardinality: 'zero' | 'one' | 'many';
  targetCardinality: 'zero' | 'one' | 'many';
  connected: boolean;
  flow: 'forward' | 'reverse' | null;
}

interface RouteSegmentHandle {
  segmentIndex: number;
  point: Point;
  orientation: 'horizontal' | 'vertical';
}

interface RelationshipEndpoint {
  tableId: string;
  columnId: string;
  side: 'left' | 'right';
}

interface SelectionRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

const MIN_ROUTE_POINT_DISTANCE = 36;
const ENDPOINT_LANE_DISTANCE = 44;

@Component({
  selector: 'app-diagram-canvas',
  imports: [
    TableNode,
    DiagramArea,
    LucideArrowLeftFromLine,
    LucideArrowRightFromLine,
    LucideRotateCcw,
    LucideSettings,
    LucideTrash2,
    TooltipDirective,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './diagram-canvas.html',
  styleUrl: './diagram-canvas.scss',
})
export class DiagramCanvas {
  readonly schema = input.required<DatabaseSchema>();
  readonly layout = input.required<DiagramLayout>();
  readonly selectedTableId = input<string>();
  readonly selectedTableIds = input<string[]>([]);
  readonly selectedColumnId = input<string>();
  readonly selectedRelationshipId = input<string>();
  readonly relationshipMode = input(false);
  readonly diagramOperation = output<DiagramOperation>();
  readonly tableSelected = output<{ tableId: string; additive: boolean }>();
  readonly tablesSelected = output<{ tableIds: string[]; additive: boolean }>();
  readonly tableEditRequested = output<string>();
  readonly tableColorChanged = output<{ tableId: string; color: string }>();
  readonly tableAreaChanged = output<{ tableId: string; areaId: string | null }>();
  readonly areaEditRequested = output<string>();
  readonly areaCollapsedChanged = output<string>();
  readonly columnSelected = output<{ tableId: string; columnId: string }>();
  readonly relationshipSelected = output<string>();
  readonly relationshipTypeChanged = output<{
    relationshipId: string;
    type: RelationshipSchema['type'];
    sourceCardinality: 'zero' | 'one' | 'many';
    targetCardinality: 'zero' | 'one' | 'many';
  }>();
  readonly relationshipDeleted = output<string>();
  readonly relationshipCreated = output<{
    sourceTableId: string;
    sourceColumnId: string;
    targetTableId: string;
    targetColumnId: string;
    sourceSide: 'left' | 'right';
    targetSide: 'left' | 'right';
  }>();
  readonly selectionCleared = output<void>();

  private interaction:
    | {
        kind: 'table';
        pointerId: number;
        startX: number;
        startY: number;
        tables: { tableId: string; from: TableLayout }[];
      }
    | { kind: 'pan'; pointerId: number; startX: number; startY: number; from: ViewportState }
    | {
        kind: 'marquee';
        pointerId: number;
        startX: number;
        startY: number;
        additive: boolean;
      }
    | {
        kind: 'relationship';
        pointerId: number;
        source: RelationshipEndpoint;
      }
    | {
        kind: 'segment';
        pointerId: number;
        relationshipId: string;
        from?: RelationshipLayout;
        segmentIndex: number;
        orientation: 'horizontal' | 'vertical';
        points: Point[];
      }
    | {
        kind: 'area';
        pointerId: number;
        areaId: string;
        startX: number;
        startY: number;
        from: DiagramAreaLayout;
        tables: { tableId: string; from: TableLayout }[];
      }
    | {
        kind: 'area-resize';
        pointerId: number;
        areaId: string;
        startX: number;
        startY: number;
        from: DiagramAreaLayout;
      }
    | undefined;
  private readonly tablePreview = signal<Record<string, TableLayout>>({});
  protected readonly panning = signal(false);
  protected readonly selectionRect = signal<SelectionRect | null>(null);
  protected readonly areaPreview = signal<{
    areaId: string;
    area: DiagramAreaLayout;
    tables: Record<string, TableLayout>;
  } | null>(null);
  private readonly viewportPreview = signal<ViewportState | null>(null);
  protected readonly relationshipTarget = signal<RelationshipEndpoint | null>(null);
  private readonly temporaryRelationship = signal<{
    source: { x: number; y: number };
    cursor: { x: number; y: number };
  } | null>(null);
  private readonly routePreview = signal<{
    relationshipId: string;
    layout: RelationshipLayout;
  } | null>(null);
  protected readonly hoveredSegment = signal<{
    relationshipId: string;
    point: Point;
    segmentIndex: number;
    orientation: 'horizontal' | 'vertical';
  } | null>(null);
  private readonly hoveredColumn = signal<{ tableId: string; columnId: string } | null>(null);
  protected readonly relationshipToolboxId = signal<string | null>(null);
  private readonly viewportElement = viewChild.required<ElementRef<HTMLElement>>('viewport');

  protected readonly transform = computed(() => {
    const viewport = this.viewportPreview() ?? this.layout().viewport;
    return `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`;
  });

  protected readonly edges = computed<RenderedRelationship[]>(() =>
    this.schema().relationships.flatMap((relationship, relationshipIndex) => {
      const sourceTable = this.schema().tables.find(({ id }) => id === relationship.sourceTableId);
      const targetTable = this.schema().tables.find(({ id }) => id === relationship.targetTableId);
      const sourceIndex = sourceTable
        ? this.visualColumnIndex(sourceTable, relationship.sourceColumnId)
        : -1;
      const targetIndex = targetTable
        ? this.visualColumnIndex(targetTable, relationship.targetColumnId)
        : -1;
      if (!sourceTable || !targetTable || sourceIndex < 0 || targetIndex < 0) return [];
      const sourceArea = this.collapsedAreaForTable(sourceTable.id);
      const targetArea = this.collapsedAreaForTable(targetTable.id);
      if (sourceArea && sourceArea === targetArea) return [];
      const sourceLayout = sourceArea
        ? { x: sourceArea.x, y: sourceArea.y, width: 180 }
        : this.tablePosition(sourceTable.id);
      const targetLayout = targetArea
        ? { x: targetArea.x, y: targetArea.y, width: 180 }
        : this.tablePosition(targetTable.id);
      const sourceOnLeft = sourceLayout.x > targetLayout.x;
      const routeLayout = this.layout().relationships?.[relationship.id];
      const sourceSide = routeLayout?.sourceSide ?? (sourceOnLeft ? 'left' : 'right');
      const targetSide = routeLayout?.targetSide ?? (sourceOnLeft ? 'right' : 'left');
      const source = sourceArea
        ? collapsedAreaAnchor(sourceArea, sourceSide)
        : this.visualAnchor(sourceLayout, sourceIndex, sourceSide);
      const target = targetArea
        ? collapsedAreaAnchor(targetArea, targetSide)
        : this.visualAnchor(targetLayout, targetIndex, targetSide);
      const routePreview = this.routePreview();
      const previewLayout =
        routePreview?.relationshipId === relationship.id ? routePreview.layout : routeLayout;
      const defaults = defaultOrthogonalRoute(source, target);
      let route: OrthogonalRoute = {
        sourceX: previewLayout?.sourceX ?? previewLayout?.routeX ?? defaults.sourceX,
        targetX: previewLayout?.targetX ?? previewLayout?.routeX ?? defaults.targetX,
        routeY: previewLayout?.routeY ?? defaults.routeY + ((relationshipIndex % 5) - 2) * 10,
      };
      route = {
        ...route,
        sourceX: outwardLaneX(source.x, route.sourceX, sourceSide),
        targetX: outwardLaneX(target.x, route.targetX, targetSide),
      };
      const manuallyRouted = Boolean(
        previewLayout?.sourceX !== undefined ||
        previewLayout?.targetX !== undefined ||
        previewLayout?.routeY !== undefined ||
        previewLayout?.routeX !== undefined ||
        previewLayout?.waypoints?.length,
      );
      const obstacles = this.schema()
        .tables.filter(
          ({ id }) =>
            id !== sourceTable.id && id !== targetTable.id && !this.collapsedAreaForTable(id),
        )
        .map((table) => {
          const position = this.tablePosition(table.id);
          return {
            left: position.x,
            top: position.y,
            right: position.x + (position.width ?? DEFAULT_TABLE_METRICS.width),
            bottom: position.y + this.visualTableHeight(table),
          };
        });
      if (!manuallyRouted) {
        route = routeAroundObstacles(source, target, route, obstacles);
      }
      const selectedTableIds = new Set(
        this.selectedTableIds().length
          ? this.selectedTableIds()
          : this.selectedTableId()
            ? [this.selectedTableId()!]
            : [],
      );
      const hoveredColumn = this.hoveredColumn();
      const columnFocus =
        hoveredColumn &&
        this.schema().relationships.some(
          (candidate) =>
            (candidate.sourceTableId === hoveredColumn.tableId &&
              candidate.sourceColumnId === hoveredColumn.columnId) ||
            (candidate.targetTableId === hoveredColumn.tableId &&
              candidate.targetColumnId === hoveredColumn.columnId),
        )
          ? hoveredColumn
          : null;
      const sourceFocused = columnFocus
        ? relationship.sourceTableId === columnFocus.tableId &&
          relationship.sourceColumnId === columnFocus.columnId
        : false;
      const targetFocused = columnFocus
        ? relationship.targetTableId === columnFocus.tableId &&
          relationship.targetColumnId === columnFocus.columnId
        : false;
      const savedPoints = previewLayout?.waypoints?.length
        ? [source, ...previewLayout.waypoints, target]
        : null;
      const points =
        savedPoints &&
        isOrthogonalPolyline(savedPoints) &&
        routeExitsOutward(savedPoints, sourceSide, targetSide)
          ? savedPoints
          : orthogonalRoutePoints(source, target, route);
      const automaticSource = sourceArea
        ? collapsedAreaAnchor(sourceArea, sourceOnLeft ? 'left' : 'right')
        : this.visualAnchor(sourceLayout, sourceIndex, sourceOnLeft ? 'left' : 'right');
      const automaticTarget = targetArea
        ? collapsedAreaAnchor(targetArea, sourceOnLeft ? 'right' : 'left')
        : this.visualAnchor(targetLayout, targetIndex, sourceOnLeft ? 'right' : 'left');
      const automaticDefaults = defaultOrthogonalRoute(automaticSource, automaticTarget);
      const automaticRoute = routeAroundObstacles(
        automaticSource,
        automaticTarget,
        {
          ...automaticDefaults,
          routeY: automaticDefaults.routeY + ((relationshipIndex % 5) - 2) * 10,
        },
        obstacles,
      );
      const automaticPoints = orthogonalRoutePoints(
        automaticSource,
        automaticTarget,
        automaticRoute,
      );
      return [
        {
          relationship,
          path: roundedPolylinePath(points),
          source,
          target,
          route,
          points,
          handles: routeSegmentHandles(points),
          pullCandidates: routePullCandidates(points),
          resetPoint: routeActionPoint(points),
          canReset: manuallyRouted && !samePolyline(points, automaticPoints),
          sourceSide,
          targetSide,
          sourceCardinality:
            relationship.sourceCardinality ??
            (relationship.type === 'many-to-one' ? 'many' : 'one'),
          targetCardinality:
            relationship.targetCardinality ??
            (relationship.type === 'one-to-many' ? 'many' : 'one'),
          connected: columnFocus
            ? sourceFocused || targetFocused
            : !selectedTableIds.size ||
              selectedTableIds.has(relationship.sourceTableId) ||
              selectedTableIds.has(relationship.targetTableId),
          flow: columnFocus
            ? sourceFocused
              ? 'forward'
              : targetFocused
                ? 'reverse'
                : null
            : !selectedTableIds.size
              ? null
              : selectedTableIds.has(relationship.sourceTableId)
                ? 'forward'
                : selectedTableIds.has(relationship.targetTableId)
                  ? 'reverse'
                  : null,
        },
      ];
    }),
  );

  protected readonly temporaryPath = computed(() => {
    const temporary = this.temporaryRelationship();
    return temporary
      ? roundedPolylinePath(
          orthogonalRoutePoints(
            temporary.source,
            temporary.cursor,
            defaultOrthogonalRoute(temporary.source, temporary.cursor),
          ),
        )
      : null;
  });

  protected tablePosition(tableId: string) {
    const areaTable = this.areaPreview()?.tables[tableId];
    if (areaTable) return areaTable;
    const preview = this.tablePreview();
    return preview[tableId] ?? tableLayout(this.layout(), tableId);
  }

  protected areaPosition(areaId: string, area: DiagramAreaLayout): DiagramAreaLayout {
    const preview = this.areaPreview();
    if (preview?.areaId === areaId) return preview.area;
    const tablePreview = this.tablePreview();
    if (!area.tableIds?.some((tableId) => tablePreview[tableId])) return area;
    const bounds = area.tableIds.flatMap((tableId) => {
      const table = this.schema().tables.find(({ id }) => id === tableId);
      if (!table) return [];
      const position = this.tablePosition(tableId);
      return [
        {
          left: position.x,
          top: position.y,
          right: position.x + (position.width ?? DEFAULT_TABLE_METRICS.width),
          bottom: position.y + this.visualTableHeight(table),
        },
      ];
    });
    if (!bounds.length) return area;
    const left = Math.min(...bounds.map(({ left }) => left)) - 24;
    const top = Math.min(...bounds.map(({ top }) => top)) - 42;
    const right = Math.max(...bounds.map(({ right }) => right)) + 24;
    const bottom = Math.max(...bounds.map(({ bottom }) => bottom)) + 24;
    return {
      ...area,
      x: left,
      y: top,
      width: Math.max(240, right - left),
      height: Math.max(160, bottom - top),
    };
  }

  protected areaEntries(): [string, DiagramAreaLayout][] {
    return Object.entries(this.layout().areas ?? {});
  }

  protected areaTableNames(area: DiagramAreaLayout): string[] {
    const ids = new Set(this.tablesInArea(area));
    return this.schema()
      .tables.filter(({ id }) => ids.has(id))
      .map(({ name }) => name);
  }

  protected tableVisible(tableId: string): boolean {
    return !this.collapsedAreaForTable(tableId);
  }

  private visibleColumns(table: TableSchema): ColumnSchema[] {
    const level = this.layout().detailLevel ?? 'all';
    if (level === 'names') return [];
    if (level === 'all') return table.columns;
    const relationshipColumnIds = new Set(
      this.schema().relationships.flatMap(({ sourceColumnId, targetColumnId }) => [
        sourceColumnId,
        targetColumnId,
      ]),
    );
    return table.columns.filter(
      ({ id, primaryKey }) =>
        primaryKey ||
        table.indexes.some((index) => index.primaryKey && index.columns.includes(id)) ||
        relationshipColumnIds.has(id),
    );
  }

  private visualColumnIndex(table: TableSchema, columnId: string): number {
    if ((this.layout().detailLevel ?? 'all') === 'names') return 0;
    return this.visibleColumns(table).findIndex(({ id }) => id === columnId);
  }

  private visualAnchor(layout: TableLayout, columnIndex: number, side: 'left' | 'right'): Point {
    if ((this.layout().detailLevel ?? 'all') === 'names') {
      return {
        x: layout.x + (side === 'right' ? (layout.width ?? DEFAULT_TABLE_METRICS.width) : 0),
        y: layout.y + DEFAULT_TABLE_METRICS.headerHeight / 2,
      };
    }
    return columnAnchor(layout, columnIndex, side);
  }

  private visualTableHeight(table: TableSchema): number {
    return (
      DEFAULT_TABLE_METRICS.headerHeight +
      this.visibleColumns(table).length * DEFAULT_TABLE_METRICS.rowHeight
    );
  }

  private collapsedAreaForTable(tableId: string): DiagramAreaLayout | undefined {
    return Object.values(this.layout().areas ?? {}).find(
      (area) => area.collapsed && area.tableIds?.includes(tableId),
    );
  }

  protected startAreaMove({ areaId, event }: { areaId: string; event: PointerEvent }): void {
    const from = this.layout().areas?.[areaId];
    if (!from) return;
    const tables = this.tablesInArea(from).map((tableId) => ({
      tableId,
      from: tableLayout(this.layout(), tableId),
    }));
    this.interaction = {
      kind: 'area',
      pointerId: event.pointerId,
      areaId,
      startX: event.clientX,
      startY: event.clientY,
      from,
      tables,
    };
    (event.target as Element).setPointerCapture(event.pointerId);
  }

  protected startAreaResize({ areaId, event }: { areaId: string; event: PointerEvent }): void {
    const from = this.layout().areas?.[areaId];
    if (!from) return;
    this.interaction = {
      kind: 'area-resize',
      pointerId: event.pointerId,
      areaId,
      startX: event.clientX,
      startY: event.clientY,
      from,
    };
    (event.target as Element).setPointerCapture(event.pointerId);
  }

  protected startTableDrag({ tableId, event }: { tableId: string; event: PointerEvent }): void {
    const selected = this.selectedTableIds();
    const additive = event.ctrlKey || event.metaKey || event.shiftKey;
    const alreadySelected = selected.includes(tableId);
    const tableIds = additive
      ? alreadySelected
        ? [tableId]
        : [...selected, tableId]
      : alreadySelected
        ? selected
        : [tableId];
    if (additive || !alreadySelected) this.tableSelected.emit({ tableId, additive });
    this.interaction = {
      kind: 'table',
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      tables: tableIds.map((id) => ({ tableId: id, from: tableLayout(this.layout(), id) })),
    };
    (event.target as Element).setPointerCapture(event.pointerId);
  }

  protected startPan(event: PointerEvent): void {
    if (event.button === 0) {
      if ((event.target as Element).closest('app-table-node, app-diagram-area')) return;
      event.preventDefault();
      this.interaction = {
        kind: 'marquee',
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        additive: event.ctrlKey || event.metaKey || event.shiftKey,
      };
      this.selectionRect.set(this.pointerSelectionRect(event.clientX, event.clientY, event));
      (event.currentTarget as Element).setPointerCapture(event.pointerId);
      return;
    }
    if (event.button !== 1 && event.button !== 2) return;
    event.preventDefault();
    this.panning.set(true);
    this.interaction = {
      kind: 'pan',
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      from: this.layout().viewport,
    };
    (event.currentTarget as Element).setPointerCapture(event.pointerId);
  }

  protected startRelationship({
    tableId,
    columnId,
    sourceSide,
    event,
  }: {
    tableId: string;
    columnId: string;
    sourceSide: 'left' | 'right';
    event: PointerEvent;
  }): void {
    const table = this.schema().tables.find(({ id }) => id === tableId);
    const columnIndex = table ? this.visualColumnIndex(table, columnId) : -1;
    if (!table || columnIndex < 0) return;
    const source = this.visualAnchor(tableLayout(this.layout(), tableId), columnIndex, sourceSide);
    this.interaction = {
      kind: 'relationship',
      pointerId: event.pointerId,
      source: { tableId, columnId, side: sourceSide },
    };
    this.temporaryRelationship.set({ source, cursor: source });
    (event.target as Element).setPointerCapture(event.pointerId);
  }

  protected movePointer(event: PointerEvent): void {
    const interaction = this.interaction;
    if (!interaction || interaction.pointerId !== event.pointerId) return;
    if (interaction.kind === 'table') {
      const deltaX = event.clientX - interaction.startX;
      const deltaY = event.clientY - interaction.startY;
      const zoom = this.layout().viewport.zoom;
      this.tablePreview.set(
        Object.fromEntries(
          interaction.tables.map(({ tableId, from }) => [
            tableId,
            { ...from, x: from.x + deltaX / zoom, y: from.y + deltaY / zoom },
          ]),
        ),
      );
    } else if (interaction.kind === 'marquee') {
      this.selectionRect.set(
        this.pointerSelectionRect(interaction.startX, interaction.startY, event),
      );
    } else if (interaction.kind === 'pan') {
      const deltaX = event.clientX - interaction.startX;
      const deltaY = event.clientY - interaction.startY;
      this.viewportPreview.set({
        ...interaction.from,
        x: interaction.from.x + deltaX,
        y: interaction.from.y + deltaY,
      });
    } else if (interaction.kind === 'relationship') {
      const bounds = this.viewportElement().nativeElement.getBoundingClientRect();
      const cursor = screenToWorld(
        { x: event.clientX - bounds.left, y: event.clientY - bounds.top },
        this.layout().viewport,
      );
      const current = this.temporaryRelationship();
      if (current) this.temporaryRelationship.set({ ...current, cursor });
      this.relationshipTarget.set(
        this.endpointAt(event.clientX, event.clientY, interaction.source),
      );
    } else if (interaction.kind === 'segment') {
      const bounds = this.viewportElement().nativeElement.getBoundingClientRect();
      const cursor = screenToWorld(
        { x: event.clientX - bounds.left, y: event.clientY - bounds.top },
        this.layout().viewport,
      );
      const requestedCoordinate = interaction.orientation === 'horizontal' ? cursor.y : cursor.x;
      const coordinate = keepSegmentOutsideTables(
        interaction.points,
        interaction.segmentIndex,
        interaction.orientation,
        requestedCoordinate,
        this.schema(),
        this.layout(),
        this.tablePreview(),
      );
      const points = moveOrthogonalSegment(
        interaction.points,
        interaction.segmentIndex,
        interaction.orientation,
        coordinate,
      );
      this.routePreview.set({
        relationshipId: interaction.relationshipId,
        layout: { ...interaction.from, waypoints: points.slice(1, -1) },
      });
    } else if (interaction.kind === 'area') {
      const zoom = this.layout().viewport.zoom;
      const deltaX = (event.clientX - interaction.startX) / zoom;
      const deltaY = (event.clientY - interaction.startY) / zoom;
      this.areaPreview.set({
        areaId: interaction.areaId,
        area: {
          ...interaction.from,
          x: interaction.from.x + deltaX,
          y: interaction.from.y + deltaY,
        },
        tables: Object.fromEntries(
          interaction.tables.map(({ tableId, from }) => [
            tableId,
            { ...from, x: from.x + deltaX, y: from.y + deltaY },
          ]),
        ),
      });
    } else if (interaction.kind === 'area-resize') {
      const zoom = this.layout().viewport.zoom;
      this.areaPreview.set({
        areaId: interaction.areaId,
        area: {
          ...interaction.from,
          width: Math.max(
            240,
            interaction.from.width + (event.clientX - interaction.startX) / zoom,
          ),
          height: Math.max(
            160,
            interaction.from.height + (event.clientY - interaction.startY) / zoom,
          ),
        },
        tables: {},
      });
    }
  }

  protected endPointer(event: PointerEvent): void {
    const interaction = this.interaction;
    if (!interaction || interaction.pointerId !== event.pointerId) return;
    if (interaction.kind === 'table') {
      const preview = this.tablePreview();
      const tables = interaction.tables.flatMap(({ tableId, from }) =>
        preview[tableId] ? [{ tableId, from, to: preview[tableId]! }] : [],
      );
      if (tables.length === 1) {
        this.diagramOperation.emit({
          type: 'MOVE_TABLE',
          ...tables[0]!,
        });
      } else if (tables.length > 1) {
        this.diagramOperation.emit({ type: 'MOVE_TABLES', tables });
      }
      this.tablePreview.set({});
    } else if (interaction.kind === 'marquee') {
      this.tablesSelected.emit({
        tableIds: this.tablesInsideSelection(interaction, event),
        additive: interaction.additive,
      });
      this.selectionRect.set(null);
    } else if (interaction.kind === 'pan') {
      const preview = this.viewportPreview();
      if (preview)
        this.diagramOperation.emit({
          type: 'CHANGE_VIEWPORT',
          from: interaction.from,
          to: preview,
        });
      this.viewportPreview.set(null);
      this.panning.set(false);
    } else if (interaction.kind === 'relationship') {
      const target = this.relationshipTarget();
      if (target) {
        this.relationshipCreated.emit({
          sourceTableId: interaction.source.tableId,
          sourceColumnId: interaction.source.columnId,
          targetTableId: target.tableId,
          targetColumnId: target.columnId,
          sourceSide: interaction.source.side,
          targetSide: target.side,
        });
      }
      this.clearTemporaryRelationship();
    } else if (interaction.kind === 'segment') {
      const preview = this.routePreview();
      if (preview) {
        const normalized = normalizeOrthogonalPolyline([
          interaction.points[0]!,
          ...(preview.layout.waypoints ?? []),
          interaction.points.at(-1)!,
        ]);
        this.diagramOperation.emit({
          type: 'CHANGE_RELATIONSHIP_ROUTE',
          relationshipId: interaction.relationshipId,
          from: interaction.from,
          to: { ...preview.layout, waypoints: normalized.slice(1, -1) },
        });
      }
      this.routePreview.set(null);
    } else if (interaction.kind === 'area') {
      const preview = this.areaPreview();
      if (preview)
        this.diagramOperation.emit({
          type: 'MOVE_AREA',
          areaId: interaction.areaId,
          from: interaction.from,
          to: preview.area,
          tables: interaction.tables.map(({ tableId, from }) => ({
            tableId,
            from,
            to: preview.tables[tableId]!,
          })),
        });
      this.areaPreview.set(null);
    } else {
      const preview = this.areaPreview();
      if (preview)
        this.diagramOperation.emit({
          type: 'RESIZE_AREA',
          areaId: interaction.areaId,
          from: interaction.from,
          to: preview.area,
        });
      this.areaPreview.set(null);
    }
    this.interaction = undefined;
  }

  protected cancelPointer(event: PointerEvent): void {
    if (this.interaction?.pointerId !== event.pointerId) return;
    this.tablePreview.set({});
    this.selectionRect.set(null);
    this.viewportPreview.set(null);
    this.panning.set(false);
    this.routePreview.set(null);
    this.areaPreview.set(null);
    this.clearTemporaryRelationship();
    this.interaction = undefined;
  }

  private pointerSelectionRect(
    startX: number,
    startY: number,
    event: Pick<PointerEvent, 'clientX' | 'clientY'>,
  ): SelectionRect {
    const bounds = this.viewportElement().nativeElement.getBoundingClientRect();
    const left = Math.min(startX, event.clientX) - bounds.left;
    const top = Math.min(startY, event.clientY) - bounds.top;
    return {
      left,
      top,
      width: Math.abs(event.clientX - startX),
      height: Math.abs(event.clientY - startY),
    };
  }

  private tablesInsideSelection(
    interaction: {
      kind: 'marquee';
      pointerId: number;
      startX: number;
      startY: number;
      additive: boolean;
    },
    event: PointerEvent,
  ): string[] {
    if (
      Math.abs(event.clientX - interaction.startX) < 3 &&
      Math.abs(event.clientY - interaction.startY) < 3
    )
      return [];
    const bounds = this.viewportElement().nativeElement.getBoundingClientRect();
    const start = screenToWorld(
      {
        x: Math.min(interaction.startX, event.clientX) - bounds.left,
        y: Math.min(interaction.startY, event.clientY) - bounds.top,
      },
      this.layout().viewport,
    );
    const end = screenToWorld(
      {
        x: Math.max(interaction.startX, event.clientX) - bounds.left,
        y: Math.max(interaction.startY, event.clientY) - bounds.top,
      },
      this.layout().viewport,
    );

    return this.schema().tables.flatMap((table) => {
      if (!this.tableVisible(table.id)) return [];
      const position = tableLayout(this.layout(), table.id);
      const width = position.width ?? DEFAULT_TABLE_METRICS.width;
      const height = this.visualTableHeight(table);
      const intersects =
        position.x < end.x &&
        position.x + width > start.x &&
        position.y < end.y &&
        position.y + height > start.y;
      return intersects ? [table.id] : [];
    });
  }

  protected zoom(event: WheelEvent): void {
    event.preventDefault();
    const element = event.currentTarget as HTMLElement;
    const bounds = element.getBoundingClientRect();
    const viewport = this.layout().viewport;
    const factor = Math.exp(-event.deltaY * 0.0015);
    const to = zoomAtPoint(
      viewport,
      { x: event.clientX - bounds.left, y: event.clientY - bounds.top },
      viewport.zoom * factor,
    );
    this.diagramOperation.emit({ type: 'CHANGE_VIEWPORT', from: viewport, to });
  }

  protected selectRelationship(event: PointerEvent, relationshipId: string): void {
    event.stopPropagation();
    this.relationshipSelected.emit(relationshipId);
  }

  protected resetRelationshipRoute(event: PointerEvent, relationshipId: string): void {
    event.preventDefault();
    event.stopPropagation();
    this.hoveredSegment.set(null);
    this.diagramOperation.emit({
      type: 'CHANGE_RELATIONSHIP_ROUTE',
      relationshipId,
      from: this.layout().relationships?.[relationshipId],
      to: {},
    });
  }

  protected changeRelationshipType(
    event: PointerEvent,
    relationshipId: string,
    sourceCardinality: 'zero' | 'one' | 'many',
    targetCardinality: 'zero' | 'one' | 'many',
  ): void {
    event.preventDefault();
    event.stopPropagation();
    const type: RelationshipSchema['type'] =
      sourceCardinality === 'many'
        ? 'many-to-one'
        : targetCardinality === 'many'
          ? 'one-to-many'
          : 'one-to-one';
    this.relationshipTypeChanged.emit({
      relationshipId,
      type,
      sourceCardinality,
      targetCardinality,
    });
  }

  protected deleteRelationship(event: PointerEvent, relationshipId: string): void {
    event.preventDefault();
    event.stopPropagation();
    this.relationshipDeleted.emit(relationshipId);
    this.relationshipToolboxId.set(null);
  }

  protected toggleRelationshipToolbox(event: PointerEvent, relationshipId: string): void {
    event.preventDefault();
    event.stopPropagation();
    this.relationshipToolboxId.update((current) =>
      current === relationshipId ? null : relationshipId,
    );
  }

  protected toggleRelationshipSide(
    event: PointerEvent,
    relationshipId: string,
    endpoint: 'sourceSide' | 'targetSide',
    currentSide: 'left' | 'right',
  ): void {
    event.preventDefault();
    event.stopPropagation();
    const from = this.layout().relationships?.[relationshipId];
    this.diagramOperation.emit({
      type: 'CHANGE_RELATIONSHIP_ROUTE',
      relationshipId,
      from,
      to: {
        sourceSide: from?.sourceSide,
        targetSide: from?.targetSide,
        [endpoint]: currentSide === 'left' ? 'right' : 'left',
      },
    });
  }

  @HostListener('document:pointerdown', ['$event'])
  protected closeRelationshipToolbox(event: PointerEvent): void {
    const target = event.target as Element | null;
    if (!target?.closest('.relationship-toolbox, .route-actions')) {
      this.relationshipToolboxId.set(null);
    }
  }

  protected symbolTransform(point: { x: number; y: number }, towardX: number): string {
    const direction = towardX >= point.x ? 1 : -1;
    return `translate(${point.x + direction * 14} ${point.y})`;
  }

  protected startSegmentDrag(
    event: PointerEvent,
    edge: RenderedRelationship,
    handle: RouteSegmentHandle,
  ): void {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    this.relationshipSelected.emit(edge.relationship.id);
    this.interaction = {
      kind: 'segment',
      pointerId: event.pointerId,
      relationshipId: edge.relationship.id,
      from: this.layout().relationships?.[edge.relationship.id],
      segmentIndex: handle.segmentIndex,
      orientation: handle.orientation,
      points: edge.points,
    };
    (event.target as Element).setPointerCapture(event.pointerId);
  }

  protected hoverRelationshipSegment(event: PointerEvent, edge: RenderedRelationship): void {
    if (this.interaction) return;
    const bounds = this.viewportElement().nativeElement.getBoundingClientRect();
    const cursor = screenToWorld(
      { x: event.clientX - bounds.left, y: event.clientY - bounds.top },
      this.layout().viewport,
    );
    const nearest = edge.pullCandidates
      .map((candidate) => ({
        candidate,
        distance: Math.hypot(candidate.point.x - cursor.x, candidate.point.y - cursor.y),
      }))
      .sort((left, right) => left.distance - right.distance)[0];
    if (!nearest || nearest.distance > 12 / this.layout().viewport.zoom) {
      this.hoveredSegment.set(null);
      return;
    }
    this.hoveredSegment.set({
      relationshipId: edge.relationship.id,
      point: nearest.candidate.point,
      segmentIndex: nearest.candidate.segmentIndex,
      orientation: nearest.candidate.orientation,
    });
  }

  protected clearHoveredSegment(event: PointerEvent, relationshipId: string): void {
    if ((event.relatedTarget as Element | null)?.classList.contains('route-handle')) return;
    if (this.hoveredSegment()?.relationshipId === relationshipId && !this.interaction) {
      this.hoveredSegment.set(null);
    }
  }

  protected startHoveredSegment(event: PointerEvent, edge: RenderedRelationship): void {
    const hovered = this.hoveredSegment();
    if (!hovered || hovered.relationshipId !== edge.relationship.id) return;
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const pulled = pullOrthogonalSegment(edge.points, hovered.segmentIndex, hovered.point);
    this.relationshipSelected.emit(edge.relationship.id);
    this.interaction = {
      kind: 'segment',
      pointerId: event.pointerId,
      relationshipId: edge.relationship.id,
      from: this.layout().relationships?.[edge.relationship.id],
      segmentIndex: pulled.segmentIndex,
      orientation: hovered.orientation,
      points: pulled.points,
    };
    (event.target as Element).setPointerCapture(event.pointerId);
    this.hoveredSegment.set(null);
  }

  protected setHoveredColumn(column: { tableId: string; columnId: string } | null): void {
    this.hoveredColumn.set(column);
  }

  fitDiagram(): void {
    const element = this.viewportElement().nativeElement;
    const from = this.layout().viewport;
    const to = fitToScreen(this.schema(), this.layout(), {
      width: element.clientWidth,
      height: element.clientHeight,
    });
    this.diagramOperation.emit({ type: 'CHANGE_VIEWPORT', from, to });
  }

  focusTable(tableId: string): void {
    const table = this.schema().tables.find(({ id }) => id === tableId);
    if (!table) return;
    const element = this.viewportElement().nativeElement;
    const position = tableLayout(this.layout(), tableId);
    const from = this.layout().viewport;
    const width = position.width ?? DEFAULT_TABLE_METRICS.width;
    const height = this.visualTableHeight(table);
    const to: ViewportState = {
      ...from,
      x: element.clientWidth / 2 - (position.x + width / 2) * from.zoom,
      y: element.clientHeight / 2 - (position.y + height / 2) * from.zoom,
    };
    this.diagramOperation.emit({ type: 'CHANGE_VIEWPORT', from, to });
  }

  focusArea(areaId: string): void {
    const area = this.layout().areas?.[areaId];
    if (!area) return;
    const width = area.collapsed ? 180 : area.width;
    const height = area.collapsed ? 30 : area.height;
    const element = this.viewportElement().nativeElement;
    const from = this.layout().viewport;
    const zoom = Math.min(
      from.zoom,
      1,
      (element.clientWidth - 80) / width,
      (element.clientHeight - 80) / height,
    );
    const to: ViewportState = {
      x: element.clientWidth / 2 - (area.x + width / 2) * zoom,
      y: element.clientHeight / 2 - (area.y + height / 2) * zoom,
      zoom,
    };
    this.diagramOperation.emit({ type: 'CHANGE_VIEWPORT', from, to });
  }

  tableIdsInArea(areaId: string): string[] {
    const area = this.layout().areas?.[areaId];
    return area ? this.tablesInArea(area) : [];
  }

  private tablesInArea(area: DiagramAreaLayout): string[] {
    if (area.tableIds) return area.tableIds;
    return this.schema().tables.flatMap((table) => {
      const position = tableLayout(this.layout(), table.id);
      const width = position.width ?? DEFAULT_TABLE_METRICS.width;
      const height = this.visualTableHeight(table);
      const centerX = position.x + width / 2;
      const centerY = position.y + height / 2;
      return centerX >= area.x &&
        centerX <= area.x + area.width &&
        centerY >= area.y &&
        centerY <= area.y + area.height
        ? [table.id]
        : [];
    });
  }

  private endpointAt(
    clientX: number,
    clientY: number,
    source: RelationshipEndpoint,
  ): RelationshipEndpoint | null {
    const row = document
      .elementFromPoint(clientX, clientY)
      ?.closest<HTMLElement>('[data-table-id][data-column-id]');
    const tableId = row?.dataset['tableId'];
    const columnId = row?.dataset['columnId'];
    if (!tableId || !columnId || (tableId === source.tableId && columnId === source.columnId)) {
      return null;
    }
    const bounds = row.getBoundingClientRect();
    const side = clientX < bounds.left + bounds.width / 2 ? 'left' : 'right';
    return { tableId, columnId, side };
  }

  private clearTemporaryRelationship(): void {
    this.temporaryRelationship.set(null);
    this.relationshipTarget.set(null);
  }
}

function routeSegmentHandles(points: Point[]): RouteSegmentHandle[] {
  const handles: RouteSegmentHandle[] = [];
  for (let index = 1; index < points.length - 2; index += 1) {
    const start = points[index]!;
    const end = points[index + 1]!;
    const horizontal = Math.abs(start.y - end.y) < 0.01;
    const vertical = Math.abs(start.x - end.x) < 0.01;
    if (!horizontal && !vertical) continue;
    handles.push({
      segmentIndex: index,
      point: { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 },
      orientation: horizontal ? 'horizontal' : 'vertical',
    });
  }
  return handles;
}

function routePullCandidates(points: Point[], preferredSpacing = 56): RouteSegmentHandle[] {
  const candidates: RouteSegmentHandle[] = [];
  for (let index = 1; index < points.length - 2; index += 1) {
    const start = points[index]!;
    const end = points[index + 1]!;
    const horizontal = Math.abs(start.y - end.y) < 0.01;
    const vertical = Math.abs(start.x - end.x) < 0.01;
    if (!horizontal && !vertical) continue;
    const length = Math.hypot(end.x - start.x, end.y - start.y);
    const usableLength = length - MIN_ROUTE_POINT_DISTANCE * 2;
    if (usableLength < 0) continue;
    const count = Math.max(1, Math.floor(usableLength / preferredSpacing) + 1);
    for (let step = 0; step < count; step += 1) {
      const distanceAlongSegment =
        count === 1 ? length / 2 : MIN_ROUTE_POINT_DISTANCE + (usableLength * step) / (count - 1);
      const ratio = distanceAlongSegment / length;
      candidates.push({
        segmentIndex: index,
        point: {
          x: start.x + (end.x - start.x) * ratio,
          y: start.y + (end.y - start.y) * ratio,
        },
        orientation: horizontal ? 'horizontal' : 'vertical',
      });
    }
  }
  return candidates;
}

function routeActionPoint(points: Point[]): Point {
  let longest = { start: points[0]!, end: points[1]!, length: -1 };
  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index]!;
    const end = points[index + 1]!;
    const length = Math.hypot(end.x - start.x, end.y - start.y);
    if (length > longest.length) longest = { start, end, length };
  }
  return {
    x: (longest.start.x + longest.end.x) / 2,
    y: (longest.start.y + longest.end.y) / 2,
  };
}

function isOrthogonalPolyline(points: Point[]): boolean {
  return points.slice(0, -1).every((point, index) => {
    const next = points[index + 1]!;
    return Math.abs(point.x - next.x) < 0.01 || Math.abs(point.y - next.y) < 0.01;
  });
}

function samePolyline(left: Point[], right: Point[], tolerance = 0.01): boolean {
  const normalizedLeft = normalizeOrthogonalPolyline(left);
  const normalizedRight = normalizeOrthogonalPolyline(right);
  return (
    normalizedLeft.length === normalizedRight.length &&
    normalizedLeft.every(
      (point, index) =>
        Math.abs(point.x - normalizedRight[index]!.x) < tolerance &&
        Math.abs(point.y - normalizedRight[index]!.y) < tolerance,
    )
  );
}

function outwardLaneX(anchorX: number, requestedX: number, side: 'left' | 'right'): number {
  return side === 'left'
    ? Math.min(requestedX, anchorX - ENDPOINT_LANE_DISTANCE)
    : Math.max(requestedX, anchorX + ENDPOINT_LANE_DISTANCE);
}

function collapsedAreaAnchor(area: DiagramAreaLayout, side: 'left' | 'right'): Point {
  return { x: side === 'left' ? area.x : area.x + 180, y: area.y + 15 };
}

function routeExitsOutward(
  points: Point[],
  sourceSide: 'left' | 'right',
  targetSide: 'left' | 'right',
): boolean {
  const source = points[0];
  const afterSource = points[1];
  const beforeTarget = points.at(-2);
  const target = points.at(-1);
  if (!source || !afterSource || !beforeTarget || !target) return false;
  const sourceExitsOutward =
    sourceSide === 'left' ? afterSource.x < source.x : afterSource.x > source.x;
  const targetExitsOutward =
    targetSide === 'left' ? beforeTarget.x < target.x : beforeTarget.x > target.x;
  return sourceExitsOutward && targetExitsOutward;
}

function keepSegmentOutsideTables(
  points: Point[],
  segmentIndex: number,
  orientation: 'horizontal' | 'vertical',
  requestedCoordinate: number,
  schema: DatabaseSchema,
  layout: DiagramLayout,
  preview: Record<string, TableLayout>,
): number {
  const start = points[segmentIndex];
  const end = points[segmentIndex + 1];
  if (!start || !end) return requestedCoordinate;

  let coordinate = requestedCoordinate;
  for (const table of schema.tables) {
    const position = preview[table.id] ?? tableLayout(layout, table.id);
    const left = position.x - ENDPOINT_LANE_DISTANCE;
    const right =
      position.x + (position.width ?? DEFAULT_TABLE_METRICS.width) + ENDPOINT_LANE_DISTANCE;
    const top = position.y - ENDPOINT_LANE_DISTANCE;
    const bottom =
      position.y +
      DEFAULT_TABLE_METRICS.headerHeight +
      visibleColumnCount(schema, layout, table) * DEFAULT_TABLE_METRICS.rowHeight +
      ENDPOINT_LANE_DISTANCE;

    if (orientation === 'vertical') {
      const overlapsVertically =
        Math.max(start.y, end.y) >= top && Math.min(start.y, end.y) <= bottom;
      if (overlapsVertically && coordinate > left && coordinate < right) {
        coordinate = coordinate - left <= right - coordinate ? left : right;
      }
    } else {
      const overlapsHorizontally =
        Math.max(start.x, end.x) >= left && Math.min(start.x, end.x) <= right;
      if (overlapsHorizontally && coordinate > top && coordinate < bottom) {
        coordinate = coordinate - top <= bottom - coordinate ? top : bottom;
      }
    }
  }
  return coordinate;
}

function visibleColumnCount(
  schema: DatabaseSchema,
  layout: DiagramLayout,
  table: TableSchema,
): number {
  const level = layout.detailLevel ?? 'all';
  if (level === 'names') return 0;
  if (level === 'all') return table.columns.length;
  return table.columns.filter(
    ({ id, primaryKey }) =>
      primaryKey ||
      table.indexes.some((index) => index.primaryKey && index.columns.includes(id)) ||
      schema.relationships.some(
        ({ sourceColumnId, targetColumnId }) => sourceColumnId === id || targetColumnId === id,
      ),
  ).length;
}
