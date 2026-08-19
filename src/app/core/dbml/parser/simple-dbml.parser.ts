import {
  ColumnSchema,
  createEmptySchema,
  createEntityId,
  DatabaseSchema,
  EnumSchema,
  RelationshipSchema,
  TableSchema,
} from '../../schema';
import { DbmlParseError, DbmlParseResult, DbmlParser } from '../dbml.models';

type Block =
  | { kind: 'table'; value: TableSchema; parsingIndexes: boolean }
  | { kind: 'enum'; value: EnumSchema };

export class SimpleDbmlParser implements DbmlParser {
  parse(source: string): DbmlParseResult {
    const schema = createEmptySchema('Untitled diagram');
    const errors: DbmlParseError[] = [];
    const references: { expression: string; line: number }[] = [];
    let block: Block | undefined;

    for (const [index, rawLine] of source.split(/\r?\n/).entries()) {
      const lineNumber = index + 1;
      const line = stripComment(rawLine).trim();
      if (!line) continue;

      if (block) {
        if (line === '}') {
          if (block.kind === 'table' && block.parsingIndexes) {
            block.parsingIndexes = false;
            continue;
          }
          if (block.kind === 'table') schema.tables.push(block.value);
          else schema.enums.push(block.value);
          block = undefined;
          continue;
        }

        if (block.kind === 'table') {
          if (/^indexes\s*\{$/i.test(line)) {
            block.parsingIndexes = true;
            continue;
          }
          if (block.parsingIndexes) {
            const indexSchema = parseIndex(line, lineNumber, block.value, errors);
            if (indexSchema) block.value.indexes.push(indexSchema);
            continue;
          }
          const parsedColumn = parseColumn(line, lineNumber, errors);
          if (parsedColumn) {
            block.value.columns.push(parsedColumn.column);
            if (parsedColumn.inlineReference) {
              references.push({
                expression: `${qualifiedTableName(block.value)}.${quoteIfNeeded(parsedColumn.column.name)} ${parsedColumn.inlineReference}`,
                line: lineNumber,
              });
            }
          }
        } else {
          const enumValue = unquote(line.replace(/,$/, '').trim());
          if (enumValue) block.value.values.push(enumValue);
        }
        continue;
      }

      const tableMatch = line.match(
        /^Table\s+((?:"[^"]+"|[\w-]+)(?:\.(?:"[^"]+"|[\w-]+))?)\s*\{$/i,
      );
      if (tableMatch?.[1]) {
        const qualifiedName = splitQualifiedName(tableMatch[1]);
        block = {
          kind: 'table',
          value: {
            id: createEntityId('tbl'),
            name: qualifiedName.name,
            ...(qualifiedName.schema ? { schema: qualifiedName.schema } : {}),
            columns: [],
            indexes: [],
          },
          parsingIndexes: false,
        };
        continue;
      }

      const enumMatch = line.match(/^Enum\s+("[^"]+"|[\w-]+)\s*\{$/i);
      if (enumMatch?.[1]) {
        block = {
          kind: 'enum',
          value: { id: createEntityId('enm'), name: unquote(enumMatch[1]), values: [] },
        };
        continue;
      }

      const refMatch = line.match(/^Ref(?:\s+[^:]+)?\s*:\s*(.+)$/i);
      if (refMatch?.[1]) {
        references.push({ expression: refMatch[1], line: lineNumber });
        continue;
      }

      errors.push(error(`Unsupported or invalid DBML statement: ${line}`, lineNumber, rawLine));
    }

    if (block)
      errors.push({ message: `Unclosed ${block.kind} block`, line: source.split(/\r?\n/).length });

    for (const reference of references) {
      const relationship = parseReference(reference.expression, reference.line, schema, errors);
      if (relationship) schema.relationships.push(relationship);
    }

    return errors.length ? { errors } : { schema, errors: [] };
  }
}

function parseColumn(
  line: string,
  lineNumber: number,
  errors: DbmlParseError[],
): { column: ColumnSchema; inlineReference?: string } | undefined {
  const match = line.match(/^("[^"]+"|[\w-]+)\s+([^\s\[]+)(?:\s*\[(.*)\])?\s*$/);
  if (!match?.[1] || !match[2]) {
    errors.push({ message: `Invalid column definition: ${line}`, line: lineNumber, column: 1 });
    return undefined;
  }

  const settings = splitSettings(match[3] ?? '');
  const has = (setting: string): boolean =>
    settings.some((value) => value.toLowerCase() === setting);
  const valueOf = (setting: string): string | undefined =>
    settings
      .find((value) => value.toLowerCase().startsWith(`${setting}:`))
      ?.slice(setting.length + 1)
      .trim();
  const primaryKey = has('pk') || has('primary key');

  return {
    column: {
      id: createEntityId('col'),
      name: unquote(match[1]),
      type: match[2],
      primaryKey,
      nullable: !primaryKey && !has('not null'),
      unique: has('unique'),
      increment: has('increment'),
      ...(valueOf('default') ? { defaultValue: valueOf('default') } : {}),
      ...(valueOf('note') ? { note: unquote(valueOf('note')!) } : {}),
    },
    ...(valueOf('ref') ? { inlineReference: valueOf('ref') } : {}),
  };
}

function parseIndex(
  line: string,
  lineNumber: number,
  table: TableSchema,
  errors: DbmlParseError[],
): TableSchema['indexes'][number] | undefined {
  const match = line.match(/^\(([^)]+)\)(?:\s*\[(.*)\])?\s*$/);
  if (!match?.[1]) {
    errors.push({ message: `Invalid index definition: ${line}`, line: lineNumber, column: 1 });
    return undefined;
  }
  const columnNames = match[1].split(',').map((name) => unquote(name.trim()));
  const columns = columnNames.map((name) => table.columns.find((column) => column.name === name));
  const missingIndex = columns.findIndex((column) => !column);
  if (missingIndex >= 0) {
    errors.push({
      message: `Index references unknown column ${columnNames[missingIndex]} in table ${table.name}`,
      line: lineNumber,
      column: 1,
    });
    return undefined;
  }
  const settings = splitSettings(match[2] ?? '').map((setting) => setting.toLowerCase());
  const nameSetting = splitSettings(match[2] ?? '').find((setting) =>
    setting.toLowerCase().startsWith('name:'),
  );
  return {
    id: createEntityId('idx'),
    columns: columns.map((column) => column!.id),
    ...(settings.includes('unique') ? { unique: true } : {}),
    ...(settings.includes('pk') || settings.includes('primary key') ? { primaryKey: true } : {}),
    ...(nameSetting ? { name: unquote(nameSetting.slice(5).trim()) } : {}),
  };
}

function parseReference(
  expression: string,
  line: number,
  schema: DatabaseSchema,
  errors: DbmlParseError[],
): RelationshipSchema | undefined {
  const match = expression.match(
    /^((?:"[^"]+"|[\w-]+)(?:\.(?:"[^"]+"|[\w-]+)){1,2})\s*([><-])\s*((?:"[^"]+"|[\w-]+)(?:\.(?:"[^"]+"|[\w-]+)){1,2})(?:\s*\[(.*)\])?$/,
  );
  if (!match?.[1] || !match[2] || !match[3]) {
    errors.push({ message: `Invalid relationship: ${expression}`, line, column: 1 });
    return undefined;
  }

  const source = resolveEndpoint(match[1], schema);
  const target = resolveEndpoint(match[3], schema);
  if (!source || !target) {
    errors.push({
      message: `Relationship references an unknown table or column: ${expression}`,
      line,
      column: 1,
    });
    return undefined;
  }

  const settings = splitSettings(match[4] ?? '');
  const action = (name: string): RelationshipSchema['onDelete'] => {
    const raw = settings.find((setting) => setting.toLowerCase().startsWith(`${name}:`));
    return raw
      ?.slice(name.length + 1)
      .trim()
      .toUpperCase() as RelationshipSchema['onDelete'];
  };

  return {
    id: createEntityId('rel'),
    sourceTableId: source.tableId,
    sourceColumnId: source.columnId,
    targetTableId: target.tableId,
    targetColumnId: target.columnId,
    type: match[2] === '>' ? 'many-to-one' : match[2] === '<' ? 'one-to-many' : 'one-to-one',
    ...(action('delete') ? { onDelete: action('delete') } : {}),
    ...(action('update') ? { onUpdate: action('update') } : {}),
  };
}

function resolveEndpoint(
  value: string,
  schema: DatabaseSchema,
): { tableId: string; columnId: string } | undefined {
  const parts = value.match(/"[^"]+"|[^.]+/g)?.map(unquote) ?? [];
  const columnName = parts.pop();
  const tableName = parts.pop();
  const schemaName = parts.pop();
  const table = schema.tables.find(
    (candidate) => candidate.name === tableName && (!schemaName || candidate.schema === schemaName),
  );
  const column = table?.columns.find((candidate) => candidate.name === columnName);
  return table && column ? { tableId: table.id, columnId: column.id } : undefined;
}

function splitQualifiedName(value: string): { schema?: string; name: string } {
  const parts = value.match(/"[^"]+"|[^.]+/g)?.map(unquote) ?? [value];
  return parts.length > 1 ? { schema: parts[0], name: parts[1]! } : { name: parts[0]! };
}

function qualifiedTableName(table: TableSchema): string {
  return table.schema
    ? `${quoteIfNeeded(table.schema)}.${quoteIfNeeded(table.name)}`
    : quoteIfNeeded(table.name);
}

function quoteIfNeeded(value: string): string {
  return /^[A-Za-z_][\w-]*$/.test(value) ? value : `"${value.replaceAll('"', '\\"')}"`;
}

function splitSettings(value: string): string[] {
  return (
    value
      .match(/(?:'[^']*'|"[^"]*"|[^,])+/g)
      ?.map((part) => part.trim())
      .filter(Boolean) ?? []
  );
}

function stripComment(line: string): string {
  return line.replace(/\/\/.*$/, '');
}

function unquote(value: string): string {
  return value.replace(/^(?:"([\s\S]*)"|'([\s\S]*)')$/, '$1$2');
}

function error(message: string, line: number, sourceLine: string): DbmlParseError {
  return { message, line, column: Math.max(1, sourceLine.search(/\S/) + 1) };
}
