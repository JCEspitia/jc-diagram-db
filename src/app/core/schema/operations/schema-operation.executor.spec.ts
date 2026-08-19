import { describe, expect, it } from 'vitest';
import {
  ColumnSchema,
  DatabaseSchema,
  RelationshipSchema,
  TableSchema,
} from '../models/schema.models';
import { executeSchemaOperation } from './schema-operation.executor';
import { SchemaOperationError } from './schema.operations';

const idColumn: ColumnSchema = {
  id: 'col_users_id',
  name: 'id',
  type: 'uuid',
  primaryKey: true,
  nullable: false,
  unique: true,
  increment: false,
};

const users: TableSchema = {
  id: 'tbl_users',
  name: 'users',
  columns: [idColumn],
  indexes: [],
};

function emptySchema(): DatabaseSchema {
  return { id: 'sch_test', name: 'Test', tables: [], relationships: [], enums: [] };
}

describe('executeSchemaOperation', () => {
  it('adds a table without mutating the previous schema', () => {
    const original = emptySchema();
    const result = executeSchemaOperation(original, { type: 'ADD_TABLE', table: users });

    expect(original.tables).toEqual([]);
    expect(result.tables).toEqual([users]);
    expect(result).not.toBe(original);
  });

  it('updates a table while preserving its stable ID', () => {
    const schema = { ...emptySchema(), tables: [users] };
    const result = executeSchemaOperation(schema, {
      type: 'UPDATE_TABLE',
      tableId: users.id,
      changes: { name: 'customers' },
    });

    expect(result.tables[0]).toMatchObject({ id: 'tbl_users', name: 'customers' });
  });

  it('deletes a table and all relationships connected to it', () => {
    const postUserId = { ...idColumn, id: 'col_posts_user_id', name: 'user_id', primaryKey: false };
    const posts = { ...users, id: 'tbl_posts', name: 'posts', columns: [postUserId] };
    const relationship: RelationshipSchema = {
      id: 'rel_posts_users',
      sourceTableId: posts.id,
      sourceColumnId: postUserId.id,
      targetTableId: users.id,
      targetColumnId: idColumn.id,
      type: 'many-to-one',
    };
    const schema = { ...emptySchema(), tables: [users, posts], relationships: [relationship] };

    const result = executeSchemaOperation(schema, { type: 'DELETE_TABLE', tableId: users.id });

    expect(result.tables.map(({ id }) => id)).toEqual(['tbl_posts']);
    expect(result.relationships).toEqual([]);
  });

  it('deletes relationships connected to a deleted column', () => {
    const otherColumn = { ...idColumn, id: 'col_other' };
    const otherTable = { ...users, id: 'tbl_other', columns: [otherColumn] };
    const relationship: RelationshipSchema = {
      id: 'rel_test',
      sourceTableId: users.id,
      sourceColumnId: idColumn.id,
      targetTableId: otherTable.id,
      targetColumnId: otherColumn.id,
      type: 'one-to-one',
    };
    const schema = { ...emptySchema(), tables: [users, otherTable], relationships: [relationship] };

    const result = executeSchemaOperation(schema, {
      type: 'DELETE_COLUMN',
      tableId: users.id,
      columnId: idColumn.id,
    });

    expect(result.tables[0]?.columns).toEqual([]);
    expect(result.relationships).toEqual([]);
  });

  it('rejects relationships whose endpoints do not exist', () => {
    const invalidRelationship: RelationshipSchema = {
      id: 'rel_invalid',
      sourceTableId: users.id,
      sourceColumnId: idColumn.id,
      targetTableId: 'tbl_missing',
      targetColumnId: 'col_missing',
      type: 'many-to-one',
    };

    expect(() =>
      executeSchemaOperation(
        { ...emptySchema(), tables: [users] },
        {
          type: 'ADD_RELATIONSHIP',
          relationship: invalidRelationship,
        },
      ),
    ).toThrow(SchemaOperationError);
  });
});
