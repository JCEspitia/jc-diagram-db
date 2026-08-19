import { describe, expect, it } from 'vitest';
import {
  columnAnchor,
  fitToScreen,
  relationshipPath,
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
