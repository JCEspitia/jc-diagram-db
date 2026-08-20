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

export interface Rectangle {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export function editableOrthogonalPath(
  source: Point,
  target: Point,
  route: OrthogonalRoute,
): string {
  return `M ${source.x} ${source.y} H ${route.sourceX} V ${route.routeY} H ${route.targetX} V ${target.y} H ${target.x}`;
}

export function orthogonalRoutePoints(
  source: Point,
  target: Point,
  route: OrthogonalRoute,
): Point[] {
  return [
    source,
    { x: route.sourceX, y: source.y },
    { x: route.sourceX, y: route.routeY },
    { x: route.targetX, y: route.routeY },
    { x: route.targetX, y: target.y },
    target,
  ];
}

export function roundedPolylinePath(points: Point[], radius = 12): string {
  if (points.length < 2) return '';
  let path = `M ${points[0]!.x} ${points[0]!.y}`;
  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = points[index - 1]!;
    const current = points[index]!;
    const next = points[index + 1]!;
    const incoming = distance(previous, current);
    const outgoing = distance(current, next);
    const cornerRadius = Math.min(radius, incoming / 2, outgoing / 2);
    const before = pointToward(current, previous, cornerRadius);
    const after = pointToward(current, next, cornerRadius);
    path += ` L ${before.x} ${before.y} Q ${current.x} ${current.y} ${after.x} ${after.y}`;
  }
  const last = points.at(-1)!;
  return `${path} L ${last.x} ${last.y}`;
}

export function nearestPointOnPolyline(
  point: Point,
  points: Point[],
): { point: Point; segmentIndex: number; distance: number } | null {
  if (points.length < 2) return null;
  let nearest: { point: Point; segmentIndex: number; distance: number } | null = null;
  for (let index = 0; index < points.length - 1; index += 1) {
    const candidate = nearestPointOnSegment(point, points[index]!, points[index + 1]!);
    const candidateDistance = distance(point, candidate);
    if (!nearest || candidateDistance < nearest.distance) {
      nearest = { point: candidate, segmentIndex: index, distance: candidateDistance };
    }
  }
  return nearest;
}

export function pullOrthogonalSegment(
  points: Point[],
  segmentIndex: number,
  at: Point,
  requestedHalfLength = 64,
): { points: Point[]; segmentIndex: number } {
  const start = points[segmentIndex];
  const end = points[segmentIndex + 1];
  if (!start || !end) return { points, segmentIndex };
  const horizontal = Math.abs(start.y - end.y) < 0.01;
  const direction = horizontal ? Math.sign(end.x - start.x) : Math.sign(end.y - start.y);
  const distanceFromStart = distance(start, at);
  const distanceToEnd = distance(at, end);
  const before = Math.min(requestedHalfLength, distanceFromStart);
  const after = Math.min(requestedHalfLength, distanceToEnd);
  const first = horizontal
    ? { x: at.x - direction * before, y: start.y }
    : { x: start.x, y: at.y - direction * before };
  const second = horizontal
    ? { x: at.x + direction * after, y: start.y }
    : { x: start.x, y: at.y + direction * after };
  return {
    points: [
      ...points.slice(0, segmentIndex + 1),
      first,
      { ...first },
      { ...second },
      second,
      ...points.slice(segmentIndex + 1),
    ],
    segmentIndex: segmentIndex + 2,
  };
}

export function moveOrthogonalSegment(
  points: Point[],
  segmentIndex: number,
  orientation: 'horizontal' | 'vertical',
  coordinate: number,
): Point[] {
  const moved = points.map((point) => ({ ...point }));
  const start = moved[segmentIndex];
  const end = moved[segmentIndex + 1];
  if (!start || !end) return moved;
  if (orientation === 'horizontal') {
    start.y = coordinate;
    end.y = coordinate;
  } else {
    start.x = coordinate;
    end.x = coordinate;
  }
  return moved;
}

export function normalizeOrthogonalPolyline(points: Point[]): Point[] {
  const normalized: Point[] = [];
  for (const point of points) {
    const previous = normalized.at(-1);
    if (previous && distance(previous, point) < 0.01) continue;
    normalized.push({ ...point });
    while (normalized.length >= 3) {
      const first = normalized.at(-3)!;
      const middle = normalized.at(-2)!;
      const last = normalized.at(-1)!;
      const collinearX = Math.abs(first.x - middle.x) < 0.01 && Math.abs(middle.x - last.x) < 0.01;
      const collinearY = Math.abs(first.y - middle.y) < 0.01 && Math.abs(middle.y - last.y) < 0.01;
      if (!collinearX && !collinearY) break;
      normalized.splice(-2, 1);
    }
  }
  return normalized;
}

function nearestPointOnSegment(point: Point, start: Point, end: Point): Point {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (!lengthSquared) return start;
  const ratio = Math.max(
    0,
    Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared),
  );
  return { x: start.x + ratio * dx, y: start.y + ratio * dy };
}

function pointToward(from: Point, to: Point, amount: number): Point {
  const length = distance(from, to);
  if (!length) return from;
  return {
    x: from.x + ((to.x - from.x) / length) * amount,
    y: from.y + ((to.y - from.y) / length) * amount,
  };
}

function distance(left: Point, right: Point): number {
  return Math.hypot(right.x - left.x, right.y - left.y);
}

export function defaultOrthogonalRoute(source: Point, target: Point): OrthogonalRoute {
  const sourceDirection = target.x >= source.x ? 1 : -1;
  return {
    sourceX: source.x + sourceDirection * 44,
    targetX: target.x - sourceDirection * 44,
    routeY: (source.y + target.y) / 2,
  };
}

export function routeAroundObstacles(
  source: Point,
  target: Point,
  route: OrthogonalRoute,
  obstacles: Rectangle[],
  clearance = 28,
): OrthogonalRoute {
  const blocking = obstacles
    .map((rectangle) => ({
      left: rectangle.left - clearance,
      right: rectangle.right + clearance,
      top: rectangle.top - clearance,
      bottom: rectangle.bottom + clearance,
    }))
    .filter(
      (rectangle) =>
        horizontalIntersects(route.sourceX, route.targetX, route.routeY, rectangle) ||
        verticalIntersects(route.sourceX, source.y, route.routeY, rectangle) ||
        verticalIntersects(route.targetX, route.routeY, target.y, rectangle),
    );
  if (!blocking.length) return route;
  const above = Math.min(...blocking.map(({ top }) => top)) - clearance;
  const below = Math.max(...blocking.map(({ bottom }) => bottom)) + clearance;
  return {
    ...route,
    routeY: Math.abs(route.routeY - above) <= Math.abs(route.routeY - below) ? above : below,
  };
}

function horizontalIntersects(
  fromX: number,
  toX: number,
  y: number,
  rectangle: Rectangle,
): boolean {
  return (
    y >= rectangle.top &&
    y <= rectangle.bottom &&
    Math.max(fromX, toX) >= rectangle.left &&
    Math.min(fromX, toX) <= rectangle.right
  );
}

function verticalIntersects(x: number, fromY: number, toY: number, rectangle: Rectangle): boolean {
  return (
    x >= rectangle.left &&
    x <= rectangle.right &&
    Math.max(fromY, toY) >= rectangle.top &&
    Math.min(fromY, toY) <= rectangle.bottom
  );
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
