import { DatabaseSchema, RelationshipSchema } from '../models/schema.models';
import { SchemaOperation, SchemaOperationError } from './schema.operations';

export function executeSchemaOperation(
  schema: DatabaseSchema,
  operation: SchemaOperation,
): DatabaseSchema {
  switch (operation.type) {
    case 'ADD_TABLE':
      assert(
        !schema.tables.some(({ id }) => id === operation.table.id),
        `Table ID already exists: ${operation.table.id}`,
      );
      return { ...schema, tables: [...schema.tables, operation.table] };

    case 'UPDATE_TABLE':
      assertTableExists(schema, operation.tableId);
      return {
        ...schema,
        tables: schema.tables.map((table) =>
          table.id === operation.tableId ? { ...table, ...operation.changes, id: table.id } : table,
        ),
      };

    case 'DELETE_TABLE':
      assertTableExists(schema, operation.tableId);
      return {
        ...schema,
        tables: schema.tables.filter(({ id }) => id !== operation.tableId),
        relationships: schema.relationships.filter(
          ({ sourceTableId, targetTableId }) =>
            sourceTableId !== operation.tableId && targetTableId !== operation.tableId,
        ),
      };

    case 'ADD_COLUMN':
      assertTableExists(schema, operation.tableId);
      assert(
        !hasColumnId(schema, operation.column.id),
        `Column ID already exists: ${operation.column.id}`,
      );
      return {
        ...schema,
        tables: schema.tables.map((table) =>
          table.id === operation.tableId
            ? { ...table, columns: [...table.columns, operation.column] }
            : table,
        ),
      };

    case 'UPDATE_COLUMN':
      assertColumnExists(schema, operation.tableId, operation.columnId);
      return {
        ...schema,
        tables: schema.tables.map((table) =>
          table.id === operation.tableId
            ? {
                ...table,
                columns: table.columns.map((column) =>
                  column.id === operation.columnId
                    ? { ...column, ...operation.changes, id: column.id }
                    : column,
                ),
              }
            : table,
        ),
      };

    case 'DELETE_COLUMN':
      assertColumnExists(schema, operation.tableId, operation.columnId);
      return {
        ...schema,
        tables: schema.tables.map((table) =>
          table.id === operation.tableId
            ? { ...table, columns: table.columns.filter(({ id }) => id !== operation.columnId) }
            : table,
        ),
        relationships: schema.relationships.filter(
          ({ sourceColumnId, targetColumnId }) =>
            sourceColumnId !== operation.columnId && targetColumnId !== operation.columnId,
        ),
      };

    case 'ADD_RELATIONSHIP':
      assert(
        !schema.relationships.some(({ id }) => id === operation.relationship.id),
        `Relationship ID already exists: ${operation.relationship.id}`,
      );
      assertRelationshipEndpoints(schema, operation.relationship);
      return { ...schema, relationships: [...schema.relationships, operation.relationship] };

    case 'UPDATE_RELATIONSHIP': {
      const current = schema.relationships.find(({ id }) => id === operation.relationshipId);
      assert(current, `Relationship does not exist: ${operation.relationshipId}`);
      const updated = { ...current, ...operation.changes, id: current.id };
      assertRelationshipEndpoints(schema, updated);
      return {
        ...schema,
        relationships: schema.relationships.map((relationship) =>
          relationship.id === operation.relationshipId ? updated : relationship,
        ),
      };
    }

    case 'DELETE_RELATIONSHIP':
      assert(
        schema.relationships.some(({ id }) => id === operation.relationshipId),
        `Relationship does not exist: ${operation.relationshipId}`,
      );
      return {
        ...schema,
        relationships: schema.relationships.filter(({ id }) => id !== operation.relationshipId),
      };
  }
}

function assertRelationshipEndpoints(
  schema: DatabaseSchema,
  relationship: RelationshipSchema,
): void {
  assertColumnExists(schema, relationship.sourceTableId, relationship.sourceColumnId);
  assertColumnExists(schema, relationship.targetTableId, relationship.targetColumnId);
}

function assertTableExists(schema: DatabaseSchema, tableId: string): void {
  assert(
    schema.tables.some(({ id }) => id === tableId),
    `Table does not exist: ${tableId}`,
  );
}

function assertColumnExists(schema: DatabaseSchema, tableId: string, columnId: string): void {
  const table = schema.tables.find(({ id }) => id === tableId);
  assert(table, `Table does not exist: ${tableId}`);
  assert(
    table.columns.some(({ id }) => id === columnId),
    `Column ${columnId} does not exist in table ${tableId}`,
  );
}

function hasColumnId(schema: DatabaseSchema, columnId: string): boolean {
  return schema.tables.some(({ columns }) => columns.some(({ id }) => id === columnId));
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new SchemaOperationError(message);
}
