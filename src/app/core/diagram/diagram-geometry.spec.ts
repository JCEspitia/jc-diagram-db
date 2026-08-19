import { describe, expect, it } from 'vitest';
import {
  columnAnchor,
  defaultOrthogonalRoute,
  editableOrthogonalPath,
  fitToScreen,
  relationshipPath,
  routeAroundObstacles,
  nearestPointOnPolyline,
  moveOrthogonalSegment,
  normalizeOrthogonalPolyline,
  pullOrthogonalSegment,
  roundedPolylinePath,
  orthogonalRelationshipPath,
  screenToWorld,
  worldToScreen,
  zoomAtPoint,
} from './diagram-geometry';

describe('diagram geometry', () => {
  it('converts between world and screen coordinates', () => {
    const viewport = { x: 100, y: 40, zoom: 1.5 };
    const world = { x: 20, y: 30 };
    expect(screenToWorld(worldToScreen(world, viewport), viewport)).toEqual(world);
  });

  it('pulls a new movable lane from an existing segment', () => {
    const route = pullOrthogonalSegment(
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
      0,
      { x: 50, y: 0 },
      10,
    );
    const moved = moveOrthogonalSegment(route.points, route.segmentIndex, 'horizontal', 30);

    expect(moved).toEqual([
      { x: 0, y: 0 },
      { x: 40, y: 0 },
      { x: 40, y: 30 },
      { x: 60, y: 30 },
      { x: 60, y: 0 },
      { x: 100, y: 0 },
    ]);
  });

  it('removes zero-length and collinear route points', () => {
    expect(
      normalizeOrthogonalPolyline([
        { x: 0, y: 0 },
        { x: 20, y: 0 },
        { x: 20, y: 0 },
        { x: 40, y: 0 },
        { x: 40, y: 30 },
      ]),
    ).toEqual([
      { x: 0, y: 0 },
      { x: 40, y: 0 },
      { x: 40, y: 30 },
    ]);
  });

  it('locates a column anchor from table layout and row index', () => {
    expect(columnAnchor({ x: 100, y: 80 }, 1, 'right')).toEqual({ x: 400, y: 182 });
  });

  it('generates a cubic bezier path', () => {
    expect(relationshipPath({ x: 10, y: 20 }, { x: 200, y: 80 })).toBe(
      'M 10 20 C 95.5 20, 114.5 80, 200 80',
    );
  });

  it('generates an editable orthogonal route', () => {
    expect(orthogonalRelationshipPath({ x: 10, y: 20 }, { x: 200, y: 80 }, 120)).toBe(
      'M 10 20 H 120 V 80 H 200',
    );
  });

  it('generates a multi-point orthogonal route', () => {
    const source = { x: 10, y: 20 };
    const target = { x: 200, y: 100 };
    const route = defaultOrthogonalRoute(source, target);
    expect(route).toEqual({ sourceX: 54, targetX: 156, routeY: 60 });
    expect(editableOrthogonalPath(source, target, route)).toBe(
      'M 10 20 H 54 V 60 H 156 V 100 H 200',
    );
  });

  it('moves an automatic route outside blocking tables', () => {
    const source = { x: 0, y: 100 };
    const target = { x: 500, y: 100 };
    const route = { sourceX: 44, targetX: 456, routeY: 100 };
    const result = routeAroundObstacles(source, target, route, [
      { left: 180, top: 50, right: 320, bottom: 160 },
    ]);
    expect(result.routeY).toBeLessThan(50);
  });

  it('rounds corners and finds insertion points on route segments', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
    ];
    expect(roundedPolylinePath(points, 10)).toBe('M 0 0 L 90 0 Q 100 0 100 10 L 100 100');
    expect(nearestPointOnPolyline({ x: 48, y: 6 }, points)).toEqual({
      point: { x: 48, y: 0 },
      segmentIndex: 0,
      distance: 6,
    });
  });

  it('keeps the world point under the cursor fixed while zooming', () => {
    const cursor = { x: 300, y: 200 };
    const before = { x: 40, y: 20, zoom: 1 };
    const after = zoomAtPoint(before, cursor, 1.5);
    expect(worldToScreen(screenToWorld(cursor, before), after)).toEqual(cursor);
  });

  it('fits all tables inside the viewport', () => {
    const schema = {
      id: 'schema',
      name: 'test',
      relationships: [],
      enums: [],
      tables: [
        { id: 'a', name: 'a', columns: [], indexes: [] },
        { id: 'b', name: 'b', columns: [], indexes: [] },
      ],
    };
    const layout = {
      tables: { a: { x: 0, y: 0 }, b: { x: 600, y: 300 } },
      viewport: { x: 0, y: 0, zoom: 1 },
    };
    const viewport = fitToScreen(schema, layout, { width: 1000, height: 600 });
    expect(viewport.zoom).toBeLessThanOrEqual(1.25);
    expect(viewport.x).toBeGreaterThanOrEqual(0);
    expect(viewport.y).toBeGreaterThanOrEqual(0);
  });
});
