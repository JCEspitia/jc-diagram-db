import { ColumnSchema, DatabaseSchema, EntityId, TableSchema } from './schema.models';

export function createEntityId(prefix: 'sch' | 'tbl' | 'col' | 'rel' | 'idx' | 'enm'): EntityId {
  return `${prefix}_${crypto.randomUUID()}`;
}

export function createEmptySchema(name: string): DatabaseSchema {
  return {
    id: createEntityId('sch'),
    name,
    tables: [],
    relationships: [],
    enums: [],
  };
}

export function createColumn(overrides: Partial<ColumnSchema> = {}): ColumnSchema {
  return {
    id: createEntityId('col'),
    name: 'new_column',
    type: 'varchar',
    primaryKey: false,
    nullable: true,
    unique: false,
    increment: false,
    ...overrides,
  };
}

export function createTable(overrides: Partial<TableSchema> = {}): TableSchema {
  return {
    id: createEntityId('tbl'),
    name: 'new_table',
    columns: [],
    indexes: [],
    ...overrides,
  };
}
