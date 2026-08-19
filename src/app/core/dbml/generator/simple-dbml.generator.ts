import { ColumnSchema, DatabaseSchema, RelationshipSchema, TableSchema } from '../../schema';
import { DbmlGenerator } from '../dbml.models';

export class SimpleDbmlGenerator implements DbmlGenerator {
  generate(schema: DatabaseSchema): string {
    const sections = [
      ...schema.enums.map(generateEnum),
      ...schema.tables.map(generateTable),
      ...schema.relationships.map((relationship) => generateRelationship(schema, relationship)),
    ];
    return `${sections.join('\n\n')}\n`;
  }
}

function generateTable(table: TableSchema): string {
  const name = table.schema
    ? `${escapeIdentifier(table.schema)}.${escapeIdentifier(table.name)}`
    : escapeIdentifier(table.name);
  return `Table ${name} {\n${table.columns.map((column) => `  ${generateColumn(column)}`).join('\n')}\n}`;
}

function generateColumn(column: ColumnSchema): string {
  const settings: string[] = [];
  if (column.primaryKey) settings.push('pk');
  if (!column.nullable && !column.primaryKey) settings.push('not null');
  if (column.unique) settings.push('unique');
  if (column.increment) settings.push('increment');
  if (column.defaultValue !== undefined) settings.push(`default: ${column.defaultValue}`);
  if (column.note !== undefined) settings.push(`note: '${column.note.replaceAll("'", "\\'")}'`);
  const suffix = settings.length ? ` [${settings.join(', ')}]` : '';
  return `${escapeIdentifier(column.name)} ${column.type}${suffix}`;
}

function generateRelationship(schema: DatabaseSchema, relationship: RelationshipSchema): string {
  const source = endpoint(schema, relationship.sourceTableId, relationship.sourceColumnId);
  const target = endpoint(schema, relationship.targetTableId, relationship.targetColumnId);
  const operator =
    relationship.type === 'many-to-one' ? '>' : relationship.type === 'one-to-many' ? '<' : '-';
  const settings: string[] = [];
  if (relationship.onDelete) settings.push(`delete: ${relationship.onDelete.toLowerCase()}`);
  if (relationship.onUpdate) settings.push(`update: ${relationship.onUpdate.toLowerCase()}`);
  return `Ref: ${source} ${operator} ${target}${settings.length ? ` [${settings.join(', ')}]` : ''}`;
}

function endpoint(schema: DatabaseSchema, tableId: string, columnId: string): string {
  const table = schema.tables.find(({ id }) => id === tableId);
  const column = table?.columns.find(({ id }) => id === columnId);
  if (!table || !column)
    throw new Error(`Cannot generate DBML for invalid endpoint ${tableId}.${columnId}`);
  const tableName = table.schema
    ? `${escapeIdentifier(table.schema)}.${escapeIdentifier(table.name)}`
    : escapeIdentifier(table.name);
  return `${tableName}.${escapeIdentifier(column.name)}`;
}

function generateEnum(enumSchema: DatabaseSchema['enums'][number]): string {
  return `Enum ${escapeIdentifier(enumSchema.name)} {\n${enumSchema.values.map((value) => `  ${escapeIdentifier(value)}`).join('\n')}\n}`;
}

function escapeIdentifier(value: string): string {
  return /^[A-Za-z_][\w-]*$/.test(value) ? value : `"${value.replaceAll('"', '\\"')}"`;
}
