import { describe, expect, it } from 'vitest';
import { DefaultSchemaReconciler } from '../schema';
import { SimpleDbmlGenerator } from './generator/simple-dbml.generator';
import { SimpleDbmlParser } from './parser/simple-dbml.parser';

const ecommerceDbml = `Table users {
  id uuid [pk]
  email varchar [not null, unique]
}

Table posts {
  id uuid [pk]
  user_id uuid
  title varchar
}

Ref: posts.user_id > users.id [delete: cascade]
`;

describe('DBML adapters', () => {
  const parser = new SimpleDbmlParser();
  const generator = new SimpleDbmlGenerator();

  it('parses tables, columns, constraints, and relationships', () => {
    const result = parser.parse(ecommerceDbml);
    expect(result.errors).toEqual([]);
    expect(result.schema?.tables).toHaveLength(2);
    expect(result.schema?.tables[0]?.columns[1]).toMatchObject({
      name: 'email',
      nullable: false,
      unique: true,
    });
    expect(result.schema?.relationships[0]).toMatchObject({
      type: 'many-to-one',
      onDelete: 'CASCADE',
    });
  });

  it('round trips DBML through the canonical schema', () => {
    const first = parser.parse(ecommerceDbml);
    const generated = generator.generate(first.schema!);
    const second = parser.parse(generated);
    expect(second.errors).toEqual([]);
    expect(normalize(second.schema)).toEqual(normalize(first.schema));
  });

  it('returns diagnostics and no schema for invalid DBML', () => {
    const result = parser.parse('Table users {\n  invalid_column\n');
    expect(result.schema).toBeUndefined();
    expect(result.errors).toEqual([
      expect.objectContaining({ line: 2, message: expect.stringContaining('Invalid column') }),
      expect.objectContaining({ line: 3, message: expect.stringContaining('Unclosed table') }),
    ]);
  });

  it('parses inline references and composite indexes', () => {
    const result = parser.parse(`Table sites {
  id uuid [pk]
}

Table service_units {
  id uuid [pk]
  site_id uuid [not null, ref: > sites.id]
  external_id varchar [not null]

  indexes {
    (site_id, external_id) [unique]
    (id, site_id) [pk]
  }
}`);

    expect(result.errors).toEqual([]);
    expect(result.schema?.relationships).toHaveLength(1);
    expect(result.schema?.relationships[0]).toMatchObject({ type: 'many-to-one' });
    expect(result.schema?.tables[1]?.indexes).toHaveLength(2);
    expect(result.schema?.tables[1]?.indexes[0]).toMatchObject({ unique: true });
    expect(result.schema?.tables[1]?.indexes[1]).toMatchObject({ primaryKey: true });

    const generated = generator.generate(result.schema!);
    expect(generated).toContain('(site_id, external_id) [unique]');
    expect(parser.parse(generated).errors).toEqual([]);
  });

  it('parses single-column indexes without parentheses', () => {
    const result = parser.parse(`Table products {
  codigo varchar

  indexes {
    codigo [unique]
  }
}`);

    expect(result.errors).toEqual([]);
    expect(result.schema?.tables[0]?.indexes[0]).toMatchObject({ unique: true });
    expect(result.schema?.tables[0]?.indexes[0]?.columns).toEqual([
      result.schema?.tables[0]?.columns[0]?.id,
    ]);
  });

  it('round trips table and multiline column comments', () => {
    const result = parser.parse(`Table users {
  id uuid [pk, note: 'Public\\nidentifier']

  Note: 'Application users'
}`);

    expect(result.errors).toEqual([]);
    expect(result.schema?.tables[0]).toMatchObject({
      note: 'Application users',
      columns: [expect.objectContaining({ note: 'Public\nidentifier' })],
    });

    const generated = generator.generate(result.schema!);
    expect(generated).toContain("Note: 'Application users'");
    expect(generated).toContain("note: 'Public\\nidentifier'");
    expect(parser.parse(generated).schema?.tables[0]).toMatchObject({
      note: 'Application users',
      columns: [expect.objectContaining({ note: 'Public\nidentifier' })],
    });
  });

  it('round trips table header colors', () => {
    const result = parser.parse(`Table users [color: #db4f72] {
  id uuid [pk]
}`);

    expect(result.errors).toEqual([]);
    expect(result.schema?.tables[0]?.color).toBe('#db4f72');
    const generated = generator.generate(result.schema!);
    expect(generated).toContain('Table users [color: #db4f72] {');
    expect(parser.parse(generated).schema?.tables[0]?.color).toBe('#db4f72');
  });

  it('round trips multiple table check constraints', () => {
    const result = parser.parse(`Table products {
  id uuid [pk]
  price decimal
  stock integer

  checks {
    \`price > 0\`
    \`stock >= 0 and stock < 10000\`
  }
}`);

    expect(result.errors).toEqual([]);
    expect(result.schema?.tables[0]?.checks?.map(({ expression }) => expression)).toEqual([
      'price > 0',
      'stock >= 0 and stock < 10000',
    ]);
    const generated = generator.generate(result.schema!);
    expect(generated).toContain('checks {');
    expect(parser.parse(generated).schema?.tables[0]?.checks).toHaveLength(2);
  });
});

describe('Schema reconciliation', () => {
  it('preserves IDs across compatible editor changes', () => {
    const parser = new SimpleDbmlParser();
    const current = parser.parse(ecommerceDbml).schema!;
    current.name = 'Ecommerce';
    const changed = parser.parse(
      ecommerceDbml.replace('users {', 'customers {').replace('users.id', 'customers.id'),
    ).schema!;
    const reconciled = new DefaultSchemaReconciler().reconcile(current, changed);
    const previousUsers = current.tables.find(({ name }) => name === 'users')!;
    const customers = reconciled.tables.find(({ name }) => name === 'customers')!;

    expect(reconciled.name).toBe('Ecommerce');
    expect(customers.id).toBe(previousUsers.id);
    expect(customers.columns[0]?.id).toBe(previousUsers.columns[0]?.id);
    expect(reconciled.relationships[0]?.id).toBe(current.relationships[0]?.id);
  });

  it('preserves composite index IDs during reconciliation', () => {
    const parser = new SimpleDbmlParser();
    const source = `Table events {
  id uuid [pk]
  code varchar
  indexes {
    (id, code) [unique]
  }
}`;
    const current = parser.parse(source).schema!;
    const parsed = parser.parse(source.replace('code varchar', 'code varchar [not null]')).schema!;
    const reconciled = new DefaultSchemaReconciler().reconcile(current, parsed);
    expect(reconciled.tables[0]?.indexes[0]?.id).toBe(current.tables[0]?.indexes[0]?.id);
  });
});

function normalize(schema: ReturnType<SimpleDbmlParser['parse']>['schema']): unknown {
  return {
    tables: schema?.tables.map((table) => ({
      name: table.name,
      schema: table.schema,
      columns: table.columns.map(({ id: _id, ...column }) => column),
    })),
    relationships: schema?.relationships.map(
      ({ id: _id, sourceTableId, sourceColumnId, targetTableId, targetColumnId, ...rest }) => ({
        source: endpointName(schema, sourceTableId, sourceColumnId),
        target: endpointName(schema, targetTableId, targetColumnId),
        ...rest,
      }),
    ),
  };
}

function endpointName(
  schema: ReturnType<SimpleDbmlParser['parse']>['schema'],
  tableId: string,
  columnId: string,
): string {
  const table = schema?.tables.find(({ id }) => id === tableId);
  return `${table?.name}.${table?.columns.find(({ id }) => id === columnId)?.name}`;
}
