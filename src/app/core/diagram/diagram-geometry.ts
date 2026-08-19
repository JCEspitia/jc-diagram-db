import { DiagramLayout, TableLayout, ViewportState } from '../schema';

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
  width: 264,
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

export function tableLayout(layout: DiagramLayout, tableId: string): TableLayout {
  return layout.tables[tableId] ?? { x: 0, y: 0 };
}
