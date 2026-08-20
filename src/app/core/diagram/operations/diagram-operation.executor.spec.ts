import { describe, expect, it } from 'vitest';
import { DiagramLayout } from '../../schema';
import { executeDiagramOperation } from './diagram-operation.executor';

const layout: DiagramLayout = {
  tables: { tbl_users: { x: 10, y: 20 } },
  viewport: { x: 0, y: 0, zoom: 1 },
};

describe('executeDiagramOperation', () => {
  it('moves a table without mutating the previous layout', () => {
    const result = executeDiagramOperation(layout, {
      type: 'MOVE_TABLE',
      tableId: 'tbl_users',
      from: { x: 10, y: 20 },
      to: { x: 80, y: 120 },
    });
    expect(layout.tables['tbl_users']).toEqual({ x: 10, y: 20 });
    expect(result.tables['tbl_users']).toEqual({ x: 80, y: 120 });
  });

  it('changes viewport without altering table positions', () => {
    const result = executeDiagramOperation(layout, {
      type: 'CHANGE_VIEWPORT',
      from: layout.viewport,
      to: { x: 30, y: 40, zoom: 1.5 },
    });
    expect(result.tables).toBe(layout.tables);
    expect(result.viewport).toEqual({ x: 30, y: 40, zoom: 1.5 });
  });

  it('stores relationship routing separately from schema and tables', () => {
    const result = executeDiagramOperation(layout, {
      type: 'CHANGE_RELATIONSHIP_ROUTE',
      relationshipId: 'rel_1',
      to: { routeX: 320 },
    });
    expect(result.relationships?.['rel_1']).toEqual({ routeX: 320 });
    expect(result.tables).toBe(layout.tables);
  });

  it('moves an area and its contained tables atomically', () => {
    const area = { name: 'Core', color: '#6d8cff', x: 0, y: 0, width: 400, height: 300 };
    const result = executeDiagramOperation(
      { ...layout, areas: { area_core: area } },
      {
        type: 'MOVE_AREA',
        areaId: 'area_core',
        from: area,
        to: { ...area, x: 100, y: 80 },
        tables: [
          {
            tableId: 'tbl_users',
            from: { x: 10, y: 20 },
            to: { x: 110, y: 100 },
          },
        ],
      },
    );

    expect(result.areas?.['area_core']).toMatchObject({ x: 100, y: 80 });
    expect(result.tables['tbl_users']).toEqual({ x: 110, y: 100 });
  });
});
