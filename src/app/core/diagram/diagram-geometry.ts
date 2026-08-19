import { DatabaseSchema, DiagramLayout, TableLayout, ViewportState } from '../schema';

export interface Point {
  x: number;
  y: number;
}

export interface TableMetrics {
  width: number;
  headerHeight: number;
  rowHeight: number;
}

export const DEFAULT_TABLE_METRICS: TableMetrics = {
  width: 300,
  headerHeight: 45,
  rowHeight: 38,
};

export function worldToScreen(point: Point, viewport: ViewportState): Point {
  return {
    x: point.x * viewport.zoom + viewport.x,
    y: point.y * viewport.zoom + viewport.y,
  };
}

export function screenToWorld(point: Point, viewport: ViewportState): Point {
  return {
    x: (point.x - viewport.x) / viewport.zoom,
    y: (point.y - viewport.y) / viewport.zoom,
  };
}

export function zoomAtPoint(
  viewport: ViewportState,
  screenPoint: Point,
  requestedZoom: number,
  minZoom = 0.25,
  maxZoom = 2,
): ViewportState {
  const zoom = Math.min(maxZoom, Math.max(minZoom, requestedZoom));
  const worldPoint = screenToWorld(screenPoint, viewport);
  return {
    x: screenPoint.x - worldPoint.x * zoom,
    y: screenPoint.y - worldPoint.y * zoom,
    zoom,
  };
}

export function columnAnchor(
  table: TableLayout,
  columnIndex: number,
  side: 'left' | 'right',
  metrics = DEFAULT_TABLE_METRICS,
): Point {
  const width = table.width ?? metrics.width;
  return {
    x: table.x + (side === 'right' ? width : 0),
    y: table.y + metrics.headerHeight + columnIndex * metrics.rowHeight + metrics.rowHeight / 2,
  };
}

export function relationshipPath(source: Point, target: Point): string {
  const direction = target.x >= source.x ? 1 : -1;
  const controlDistance = Math.max(70, Math.abs(target.x - source.x) * 0.45);
  return `M ${source.x} ${source.y} C ${source.x + controlDistance * direction} ${source.y}, ${target.x - controlDistance * direction} ${target.y}, ${target.x} ${target.y}`;
}

export function orthogonalRelationshipPath(
  source: Point,
  target: Point,
  routeX = (source.x + target.x) / 2,
): string {
  return `M ${source.x} ${source.y} H ${routeX} V ${target.y} H ${target.x}`;
}

export interface OrthogonalRoute {
  sourceX: number;
  targetX: number;
  routeY: number;
}

export function editableOrthogonalPath(
  source: Point,
  target: Point,
  route: OrthogonalRoute,
): string {
  return `M ${source.x} ${source.y} H ${route.sourceX} V ${route.routeY} H ${route.targetX} V ${target.y} H ${target.x}`;
}

export function defaultOrthogonalRoute(source: Point, target: Point): OrthogonalRoute {
  const sourceDirection = target.x >= source.x ? 1 : -1;
  return {
    sourceX: source.x + sourceDirection * 44,
    targetX: target.x - sourceDirection * 44,
    routeY: (source.y + target.y) / 2,
  };
}

export function tableLayout(layout: DiagramLayout, tableId: string): TableLayout {
  return layout.tables[tableId] ?? { x: 0, y: 0 };
}

export function fitToScreen(
  schema: DatabaseSchema,
  layout: DiagramLayout,
  size: { width: number; height: number },
  padding = 60,
): ViewportState {
  if (!schema.tables.length || size.width <= 0 || size.height <= 0) {
    return { x: 0, y: 0, zoom: 1 };
  }
  const bounds = schema.tables.map((table) => {
    const position = tableLayout(layout, table.id);
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
  const left = Math.min(...bounds.map((bound) => bound.left));
  const top = Math.min(...bounds.map((bound) => bound.top));
  const right = Math.max(...bounds.map((bound) => bound.right));
  const bottom = Math.max(...bounds.map((bound) => bound.bottom));
  const contentWidth = Math.max(1, right - left);
  const contentHeight = Math.max(1, bottom - top);
  const zoom = Math.min(
    2,
    Math.max(
      0.25,
      Math.min(
        (size.width - padding * 2) / contentWidth,
        (size.height - padding * 2) / contentHeight,
      ),
    ),
  );
  return {
    x: (size.width - contentWidth * zoom) / 2 - left * zoom,
    y: (size.height - contentHeight * zoom) / 2 - top * zoom,
    zoom,
  };
}
