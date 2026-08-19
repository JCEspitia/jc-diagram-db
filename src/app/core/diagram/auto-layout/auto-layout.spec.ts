import { describe, expect, it } from 'vitest';
import { DatabaseSchema, DiagramLayout } from '../../schema';
import { calculateAutoLayout } from './auto-layout';

const schema: DatabaseSchema = {
  id: 'schema',
  name: 'test',
  enums: [],
  tables: [
    { id: 'parent', name: 'parent', columns: [], indexes: [] },
    { id: 'child', name: 'child', columns: [], indexes: [] },
    { id: 'leaf', name: 'leaf', columns: [], indexes: [] },
  ],
  relationships: [
    {
      id: 'rel',
      sourceTableId: 'child',
      sourceColumnId: 'unused',
      targetTableId: 'parent',
      targetColumnId: 'unused',
      type: 'many-to-one',
    },
  ],
};
const layout: DiagramLayout = { tables: {}, viewport: { x: 0, y: 0, zoom: 1 } };

describe('auto layout', () => {
  it('places dependencies from left to right', () => {
    const result = calculateAutoLayout(schema, layout, 'left-to-right');
    expect(result.tables['parent']!.x).toBeLessThan(result.tables['child']!.x);
  });

  it.each(['pipeline', 'snowflake', 'compact'] as const)(
    'positions every table with %s',
    (mode) => {
      const result = calculateAutoLayout(schema, layout, mode);
      expect(Object.keys(result.tables)).toHaveLength(schema.tables.length);
      expect(
        Object.values(result.tables).every(({ x, y }) => Number.isFinite(x) && Number.isFinite(y)),
      ).toBe(true);
    },
  );
});
