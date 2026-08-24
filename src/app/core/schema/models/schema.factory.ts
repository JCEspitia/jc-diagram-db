import { ColumnSchema, DatabaseSchema, EntityId, TableSchema } from './schema.models';

export function createEntityId(
  prefix: 'sch' | 'tbl' | 'col' | 'rel' | 'idx' | 'enm' | 'chk' | 'area',
): EntityId {
  return `${prefix}_${createUuid()}`;
}

let fallbackSequence = 0;

/** Generates UUIDs in localhost, HTTPS, and non-secure local-network HTTP contexts. */
export function createUuid(): string {
  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi?.randomUUID === 'function') return cryptoApi.randomUUID();

  if (typeof cryptoApi?.getRandomValues === 'function') {
    const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6]! & 0x0f) | 0x40;
    bytes[8] = (bytes[8]! & 0x3f) | 0x80;
    const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0'));
    return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10).join('')}`;
  }

  // Last-resort compatibility for older embedded browsers without Web Crypto.
  fallbackSequence += 1;
  const seed =
    `${Date.now().toString(16)}${fallbackSequence.toString(16)}${Math.random().toString(16).slice(2)}`
      .padEnd(32, '0')
      .slice(0, 32);
  return `${seed.slice(0, 8)}-${seed.slice(8, 12)}-4${seed.slice(13, 16)}-a${seed.slice(17, 20)}-${seed.slice(20, 32)}`;
}

export function createEmptySchema(name: string): DatabaseSchema {
  return {
    id: createEntityId('sch'),
    name,
    tables: [],
    relationships: [],
    enums: [],
    tableGroups: [],
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
