import { describe, expect, it } from 'vitest';
import { columnAnchor, relationshipPath, screenToWorld, worldToScreen } from './diagram-geometry';

describe('diagram geometry', () => {
  it('converts between world and screen coordinates', () => {
    const viewport = { x: 100, y: 40, zoom: 1.5 };
    const world = { x: 20, y: 30 };
    expect(screenToWorld(worldToScreen(world, viewport), viewport)).toEqual(world);
  });

  it('locates a column anchor from table layout and row index', () => {
    expect(columnAnchor({ x: 100, y: 80 }, 1, 'right')).toEqual({ x: 364, y: 182 });
  });

  it('generates a cubic bezier path', () => {
    expect(relationshipPath({ x: 10, y: 20 }, { x: 200, y: 80 })).toBe(
      'M 10 20 C 95.5 20, 114.5 80, 200 80',
    );
  });
});
