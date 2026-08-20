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
  const columns = table.columns.map((column) => `  ${generateColumn(column)}`).join('\n');
  const note = table.note ? `\n\n  Note: '${escapeNote(table.note)}'` : '';
  const indexes = table.indexes.length
    ? `\n\n  indexes {\n${table.indexes.map((index) => `    ${generateIndex(table, index)}`).join('\n')}\n  }`
    : '';
  return `Table ${name} {\n${columns}${note}${indexes}\n}`;
}

function generateIndex(table: TableSchema, index: TableSchema['indexes'][number]): string {
  const columns = index.columns.map((columnId) => {
    const column = table.columns.find(({ id }) => id === columnId);
    if (!column) throw new Error(`Cannot generate index ${index.id}: missing column ${columnId}`);
    return escapeIdentifier(column.name);
  });
  const settings: string[] = [];
  if (index.primaryKey) settings.push('pk');
  if (index.unique) settings.push('unique');
  if (index.name) settings.push(`name: '${index.name.replaceAll("'", "\\'")}'`);
  return `(${columns.join(', ')})${settings.length ? ` [${settings.join(', ')}]` : ''}`;
}

function generateColumn(column: ColumnSchema): string {
  const settings: string[] = [];
  if (column.primaryKey) settings.push('pk');
  if (!column.nullable && !column.primaryKey) settings.push('not null');
  if (column.unique) settings.push('unique');
  if (column.increment) settings.push('increment');
  if (column.defaultValue !== undefined) settings.push(`default: ${column.defaultValue}`);
  if (column.note !== undefined) settings.push(`note: '${escapeNote(column.note)}'`);
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

function escapeNote(value: string): string {
  return value
    .replaceAll('\\', '\\\\')
    .replaceAll("'", "\\'")
    .replaceAll('\r\n', '\\n')
    .replaceAll('\n', '\\n')
    .replaceAll('\r', '\\n');
}
