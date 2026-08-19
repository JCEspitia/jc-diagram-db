import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
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
  DatabaseSchema,
  DiagramLayout,
  RelationshipLayout,
  RelationshipSchema,
  TableLayout,
  ViewportState,
} from '../../../core/schema';
import { TableNode } from '../table-node/table-node';

interface RenderedRelationship {
  relationship: RelationshipSchema;
  path: string;
  source: { x: number; y: number };
  target: { x: number; y: number };
  route: OrthogonalRoute;
  points: Point[];
  handles: RouteSegmentHandle[];
  pullCandidates: RouteSegmentHandle[];
  sourceCardinality: 'one' | 'many';
  targetCardinality: 'one' | 'many';
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

const MIN_ROUTE_POINT_DISTANCE = 36;
const MIN_PULL_OFFSET = 24;

@Component({
  selector: 'app-diagram-canvas',
  imports: [TableNode],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './diagram-canvas.html',
  styleUrl: './diagram-canvas.scss',
})
export class DiagramCanvas {
  readonly schema = input.required<DatabaseSchema>();
  readonly layout = input.required<DiagramLayout>();
  readonly selectedTableId = input<string>();
  readonly selectedColumnId = input<string>();
  readonly selectedRelationshipId = input<string>();
  readonly relationshipMode = input(false);
  readonly diagramOperation = output<DiagramOperation>();
  readonly tableSelected = output<string>();
  readonly columnSelected = output<{ tableId: string; columnId: string }>();
  readonly relationshipSelected = output<string>();
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
        tableId: string;
        startX: number;
        startY: number;
        from: TableLayout;
      }
    | { kind: 'pan'; pointerId: number; startX: number; startY: number; from: ViewportState }
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
        pullOrigin?: number;
      }
    | undefined;
  private readonly tablePreview = signal<{ tableId: string; layout: TableLayout } | null>(null);
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
  private readonly viewportElement = viewChild.required<ElementRef<HTMLElement>>('viewport');

  protected readonly transform = computed(() => {
    const viewport = this.viewportPreview() ?? this.layout().viewport;
    return `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`;
  });

  protected readonly edges = computed<RenderedRelationship[]>(() =>
    this.schema().relationships.flatMap((relationship, relationshipIndex) => {
      const preview = this.tablePreview();
      const sourceTable = this.schema().tables.find(({ id }) => id === relationship.sourceTableId);
      const targetTable = this.schema().tables.find(({ id }) => id === relationship.targetTableId);
      const sourceIndex =
        sourceTable?.columns.findIndex(({ id }) => id === relationship.sourceColumnId) ?? -1;
      const targetIndex =
        targetTable?.columns.findIndex(({ id }) => id === relationship.targetColumnId) ?? -1;
      if (!sourceTable || !targetTable || sourceIndex < 0 || targetIndex < 0) return [];
      const sourceLayout =
        preview?.tableId === sourceTable.id
          ? preview.layout
          : tableLayout(this.layout(), sourceTable.id);
      const targetLayout =
        preview?.tableId === targetTable.id
          ? preview.layout
          : tableLayout(this.layout(), targetTable.id);
      const sourceOnLeft = sourceLayout.x > targetLayout.x;
      const routeLayout = this.layout().relationships?.[relationship.id];
      const source = columnAnchor(
        sourceLayout,
        sourceIndex,
        routeLayout?.sourceSide ?? (sourceOnLeft ? 'left' : 'right'),
      );
      const target = columnAnchor(
        targetLayout,
        targetIndex,
        routeLayout?.targetSide ?? (sourceOnLeft ? 'right' : 'left'),
      );
      const routePreview = this.routePreview();
      const previewLayout =
        routePreview?.relationshipId === relationship.id ? routePreview.layout : routeLayout;
      const defaults = defaultOrthogonalRoute(source, target);
      let route: OrthogonalRoute = {
        sourceX: previewLayout?.sourceX ?? previewLayout?.routeX ?? defaults.sourceX,
        targetX: previewLayout?.targetX ?? previewLayout?.routeX ?? defaults.targetX,
        routeY: previewLayout?.routeY ?? defaults.routeY + ((relationshipIndex % 5) - 2) * 10,
      };
      const manuallyRouted = Boolean(
        previewLayout?.sourceX !== undefined ||
        previewLayout?.targetX !== undefined ||
        previewLayout?.routeY !== undefined ||
        previewLayout?.routeX !== undefined ||
        previewLayout?.waypoints?.length,
      );
      if (!manuallyRouted) {
        const obstacles = this.schema()
          .tables.filter(({ id }) => id !== sourceTable.id && id !== targetTable.id)
          .map((table) => {
            const position =
              preview?.tableId === table.id ? preview.layout : tableLayout(this.layout(), table.id);
            return {
              left: position.x,
              top: position.y,
              right: position.x + (position.width ?? DEFAULT_TABLE_METRICS.width),
              bottom:
                position.y +
                DEFAULT_TABLE_METRICS.headerHeight +
                table.columns.length * DEFAULT_TABLE_METRICS.rowHeight,
            };
          });
        route = routeAroundObstacles(source, target, route, obstacles);
      }
      const selectedTableId = this.selectedTableId();
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
        savedPoints && isOrthogonalPolyline(savedPoints)
          ? savedPoints
          : orthogonalRoutePoints(source, target, route);
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
          sourceCardinality: relationship.type === 'many-to-one' ? 'many' : 'one',
          targetCardinality: relationship.type === 'one-to-many' ? 'many' : 'one',
          connected: columnFocus
            ? sourceFocused || targetFocused
            : !selectedTableId ||
              relationship.sourceTableId === selectedTableId ||
              relationship.targetTableId === selectedTableId,
          flow: columnFocus
            ? sourceFocused
              ? 'forward'
              : targetFocused
                ? 'reverse'
                : null
            : !selectedTableId
              ? null
              : relationship.sourceTableId === selectedTableId
                ? 'forward'
                : relationship.targetTableId === selectedTableId
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
    const preview = this.tablePreview();
    return preview?.tableId === tableId ? preview.layout : tableLayout(this.layout(), tableId);
  }

  protected startTableDrag({ tableId, event }: { tableId: string; event: PointerEvent }): void {
    this.tableSelected.emit(tableId);
    this.interaction = {
      kind: 'table',
      pointerId: event.pointerId,
      tableId,
      startX: event.clientX,
      startY: event.clientY,
      from: tableLayout(this.layout(), tableId),
    };
    (event.target as Element).setPointerCapture(event.pointerId);
  }

  protected startPan(event: PointerEvent): void {
    if (event.button !== 0 && event.button !== 1) return;
    if ((event.target as Element).closest('app-table-node')) return;
    event.preventDefault();
    if (event.button === 0) this.selectionCleared.emit();
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
    const columnIndex = table?.columns.findIndex(({ id }) => id === columnId) ?? -1;
    if (!table || columnIndex < 0) return;
    const source = columnAnchor(tableLayout(this.layout(), tableId), columnIndex, sourceSide);
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
      this.tablePreview.set({
        tableId: interaction.tableId,
        layout: {
          ...interaction.from,
          x: interaction.from.x + deltaX / zoom,
          y: interaction.from.y + deltaY / zoom,
        },
      });
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
      const coordinate =
        interaction.pullOrigin !== undefined &&
        Math.abs(requestedCoordinate - interaction.pullOrigin) < MIN_PULL_OFFSET
          ? interaction.pullOrigin
          : requestedCoordinate;
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
    }
  }

  protected endPointer(event: PointerEvent): void {
    const interaction = this.interaction;
    if (!interaction || interaction.pointerId !== event.pointerId) return;
    if (interaction.kind === 'table') {
      const preview = this.tablePreview();
      if (preview)
        this.diagramOperation.emit({
          type: 'MOVE_TABLE',
          tableId: interaction.tableId,
          from: interaction.from,
          to: preview.layout,
        });
      this.tablePreview.set(null);
    } else if (interaction.kind === 'pan') {
      const preview = this.viewportPreview();
      if (preview)
        this.diagramOperation.emit({
          type: 'CHANGE_VIEWPORT',
          from: interaction.from,
          to: preview,
        });
      this.viewportPreview.set(null);
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
    } else {
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
    }
    this.interaction = undefined;
  }

  protected cancelPointer(event: PointerEvent): void {
    if (this.interaction?.pointerId !== event.pointerId) return;
    this.tablePreview.set(null);
    this.viewportPreview.set(null);
    this.routePreview.set(null);
    this.clearTemporaryRelationship();
    this.interaction = undefined;
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

  protected symbolTransform(point: { x: number; y: number }, towardX: number): string {
    return `translate(${point.x} ${point.y}) scale(${towardX >= point.x ? 1 : -1} 1)`;
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
    const endpointSegment =
      handle.segmentIndex === 0 || handle.segmentIndex === edge.points.length - 2;
    const prepared = endpointSegment
      ? pullOrthogonalSegment(edge.points, handle.segmentIndex, handle.point)
      : { points: edge.points, segmentIndex: handle.segmentIndex };
    this.interaction = {
      kind: 'segment',
      pointerId: event.pointerId,
      relationshipId: edge.relationship.id,
      from: this.layout().relationships?.[edge.relationship.id],
      segmentIndex: prepared.segmentIndex,
      orientation: handle.orientation,
      points: prepared.points,
      pullOrigin: endpointSegment
        ? handle.orientation === 'horizontal'
          ? handle.point.y
          : handle.point.x
        : undefined,
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
      pullOrigin: hovered.orientation === 'horizontal' ? hovered.point.y : hovered.point.x,
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
  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index]!;
    const end = points[index + 1]!;
    const horizontal = Math.abs(start.y - end.y) < 0.01;
    const vertical = Math.abs(start.x - end.x) < 0.01;
    if (!horizontal && !vertical) continue;
    const endpointSegment = index === 0 || index === points.length - 2;
    if (
      endpointSegment &&
      Math.hypot(end.x - start.x, end.y - start.y) < MIN_ROUTE_POINT_DISTANCE * 2
    ) {
      continue;
    }
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
  for (let index = 0; index < points.length - 1; index += 1) {
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

function isOrthogonalPolyline(points: Point[]): boolean {
  return points.slice(0, -1).every((point, index) => {
    const next = points[index + 1]!;
    return Math.abs(point.x - next.x) < 0.01 || Math.abs(point.y - next.y) < 0.01;
  });
}
