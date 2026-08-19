import { DatabaseSchema, EntityId } from '../models/schema.models';

export type SchemaValidationCode =
  | 'DUPLICATE_ID'
  | 'DUPLICATE_TABLE_NAME'
  | 'DUPLICATE_COLUMN_NAME'
  | 'INVALID_INDEX_COLUMN'
  | 'INVALID_RELATIONSHIP_ENDPOINT';

export interface SchemaValidationError {
  code: SchemaValidationCode;
  message: string;
  entityId?: EntityId;
}

export function validateSchema(schema: DatabaseSchema): SchemaValidationError[] {
  const errors: SchemaValidationError[] = [];
  const ids = new Set<EntityId>();

  registerId(schema.id, 'schema', ids, errors);
  for (const enumSchema of schema.enums) registerId(enumSchema.id, 'enum', ids, errors);

  const tableNames = new Set<string>();
  for (const table of schema.tables) {
    registerId(table.id, 'table', ids, errors);
    const qualifiedName = `${table.schema ?? ''}.${table.name}`;
    if (tableNames.has(qualifiedName)) {
      errors.push({
        code: 'DUPLICATE_TABLE_NAME',
        message: `Duplicate table name: ${qualifiedName}`,
        entityId: table.id,
      });
    }
    tableNames.add(qualifiedName);

    const columnNames = new Set<string>();
    for (const column of table.columns) {
      registerId(column.id, 'column', ids, errors);
      if (columnNames.has(column.name)) {
        errors.push({
          code: 'DUPLICATE_COLUMN_NAME',
          message: `Duplicate column ${column.name} in table ${table.name}`,
          entityId: column.id,
        });
      }
      columnNames.add(column.name);
    }
    for (const index of table.indexes) {
      registerId(index.id, 'index', ids, errors);
      if (index.columns.some((columnId) => !table.columns.some(({ id }) => id === columnId))) {
        errors.push({
          code: 'INVALID_INDEX_COLUMN',
          message: `Index ${index.id} references a missing column in table ${table.name}`,
          entityId: index.id,
        });
      }
    }
  }

  for (const relationship of schema.relationships) {
    registerId(relationship.id, 'relationship', ids, errors);
    if (
      !hasEndpoint(schema, relationship.sourceTableId, relationship.sourceColumnId) ||
      !hasEndpoint(schema, relationship.targetTableId, relationship.targetColumnId)
    ) {
      errors.push({
        code: 'INVALID_RELATIONSHIP_ENDPOINT',
        message: `Relationship ${relationship.id} references a missing table or column`,
        entityId: relationship.id,
      });
    }
  }

  return errors;
}

function registerId(
  id: EntityId,
  entity: string,
  ids: Set<EntityId>,
  errors: SchemaValidationError[],
): void {
  if (ids.has(id)) {
    errors.push({ code: 'DUPLICATE_ID', message: `Duplicate ${entity} ID: ${id}`, entityId: id });
  }
  ids.add(id);
}

function hasEndpoint(schema: DatabaseSchema, tableId: EntityId, columnId: EntityId): boolean {
  return schema.tables.some(
    (table) => table.id === tableId && table.columns.some((column) => column.id === columnId),
  );
}
