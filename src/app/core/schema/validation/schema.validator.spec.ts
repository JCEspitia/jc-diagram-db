import { describe, expect, it } from 'vitest';
import { DatabaseSchema } from '../models/schema.models';
import { validateSchema } from './schema.validator';

describe('validateSchema', () => {
  it('reports duplicate names, IDs, and invalid relationship endpoints', () => {
    const schema: DatabaseSchema = {
      id: 'duplicate',
      name: 'Invalid',
      enums: [],
      tables: [
        {
          id: 'duplicate',
          name: 'users',
          indexes: [],
          columns: [
            {
              id: 'col_1',
              name: 'id',
              type: 'uuid',
              primaryKey: true,
              nullable: false,
              unique: true,
              increment: false,
            },
            {
              id: 'col_2',
              name: 'id',
              type: 'uuid',
              primaryKey: false,
              nullable: true,
              unique: false,
              increment: false,
            },
          ],
        },
        { id: 'tbl_2', name: 'users', indexes: [], columns: [] },
      ],
      relationships: [
        {
          id: 'rel_1',
          sourceTableId: 'duplicate',
          sourceColumnId: 'col_1',
          targetTableId: 'tbl_missing',
          targetColumnId: 'col_missing',
          type: 'many-to-one',
        },
      ],
    };

    expect(validateSchema(schema).map(({ code }) => code)).toEqual([
      'DUPLICATE_ID',
      'DUPLICATE_COLUMN_NAME',
      'DUPLICATE_TABLE_NAME',
      'INVALID_RELATIONSHIP_ENDPOINT',
    ]);
  });

  it('accepts a valid schema', () => {
    const schema: DatabaseSchema = {
      id: 'sch_1',
      name: 'Valid',
      enums: [],
      relationships: [],
      tables: [{ id: 'tbl_1', name: 'users', indexes: [], columns: [] }],
    };

    expect(validateSchema(schema)).toEqual([]);
  });
});
