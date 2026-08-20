import {
  ColumnSchema,
  createEmptySchema,
  createEntityId,
  DatabaseSchema,
  EnumSchema,
  RelationshipSchema,
  TableSchema,
  TableGroupSchema,
} from '../../schema';
import { DbmlParseError, DbmlParseResult, DbmlParser } from '../dbml.models';

type Block =
  | { kind: 'table'; value: TableSchema; section: 'columns' | 'indexes' | 'checks' }
  | { kind: 'enum'; value: EnumSchema }
  | { kind: 'tableGroup'; value: TableGroupSchema; tableNames: string[] }
  | { kind: 'reference'; expression?: string; line: number };

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
          if (block.kind === 'table' && block.section !== 'columns') {
            block.section = 'columns';
            continue;
          }
          if (block.kind === 'table') schema.tables.push(block.value);
          else if (block.kind === 'enum') schema.enums.push(block.value);
          else if (block.kind === 'tableGroup') (schema.tableGroups ??= []).push(block.value);
          else if (block.expression)
            references.push({ expression: block.expression, line: block.line });
          else errors.push({ message: 'Empty Ref block', line: block.line });
          block = undefined;
          continue;
        }

        if (block.kind === 'reference') {
          if (block.expression) {
            errors.push({
              message: 'A Ref block can only contain one relationship',
              line: lineNumber,
            });
          } else {
            block.expression = line;
            block.line = lineNumber;
          }
        } else if (block.kind === 'table') {
          const noteMatch = line.match(/^Note\s*:\s*('(?:\\.|[^'])*'|"(?:\\.|[^"])*")\s*$/i);
          if (noteMatch?.[1]) {
            block.value.note = unquote(noteMatch[1]);
            continue;
          }
          if (/^indexes\s*\{$/i.test(line)) {
            block.section = 'indexes';
            continue;
          }
          if (/^checks\s*\{$/i.test(line)) {
            block.section = 'checks';
            continue;
          }
          if (block.section === 'indexes') {
            const indexSchema = parseIndex(line, lineNumber, block.value, errors);
            if (indexSchema) block.value.indexes.push(indexSchema);
            continue;
          }
          if (block.section === 'checks') {
            const checkMatch = line.match(/^`((?:\\`|[^`])+)`(?:\s*\[.*\])?$/);
            if (!checkMatch?.[1]) {
              errors.push({ message: `Invalid check expression: ${line}`, line: lineNumber });
            } else {
              block.value.checks ??= [];
              block.value.checks.push({
                id: createEntityId('chk'),
                expression: checkMatch[1].replaceAll('\\`', '`'),
              });
            }
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
        } else if (block.kind === 'enum') {
          const enumValue = unquote(line.replace(/,$/, '').trim());
          if (enumValue) block.value.values.push(enumValue);
        } else {
          const noteMatch = line.match(/^Note\s*:\s*('(?:\\.|[^'])*'|"(?:\\.|[^"])*")\s*$/i);
          if (noteMatch?.[1]) {
            block.value.note = unquote(noteMatch[1]);
            continue;
          }
          block.tableNames.push(unquote(line.replace(/,$/, '').trim()));
        }
        continue;
      }

      const tableMatch = line.match(
        /^Table\s+((?:"[^"]+"|[\w-]+)(?:\.(?:"[^"]+"|[\w-]+))?)(?:\s*\[(.*)\])?\s*\{$/i,
      );
      if (tableMatch?.[1]) {
        const qualifiedName = splitQualifiedName(tableMatch[1]);
        const tableSettings = splitSettings(tableMatch[2] ?? '');
        const color = tableSettings
          .find((setting) => setting.toLowerCase().startsWith('color:'))
          ?.slice('color:'.length)
          .trim();
        block = {
          kind: 'table',
          value: {
            id: createEntityId('tbl'),
            name: qualifiedName.name,
            ...(qualifiedName.schema ? { schema: qualifiedName.schema } : {}),
            ...(color && /^#[0-9a-f]{6}$/i.test(color) ? { color } : {}),
            columns: [],
            indexes: [],
          },
          section: 'columns',
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

      const tableGroupMatch = line.match(/^TableGroup\s+("[^"]+"|[\w-]+)(?:\s*\[(.*)\])?\s*\{$/i);
      if (tableGroupMatch?.[1]) {
        const settings = splitSettings(tableGroupMatch[2] ?? '');
        const valueOf = (setting: string): string | undefined =>
          settings
            .find((value) => value.toLowerCase().startsWith(`${setting}:`))
            ?.slice(setting.length + 1)
            .trim();
        const color = valueOf('color');
        const note = valueOf('note');
        block = {
          kind: 'tableGroup',
          value: {
            id: createEntityId('area'),
            name: unquote(tableGroupMatch[1]),
            tableIds: [],
            ...(color && /^#[0-9a-f]{6}$/i.test(color) ? { color } : {}),
            ...(note ? { note: unquote(note) } : {}),
          },
          tableNames: [],
        };
        continue;
      }

      const refMatch = line.match(/^Ref(?:\s+[^:]+)?\s*:\s*(.+)$/i);
      if (refMatch?.[1]) {
        references.push({ expression: refMatch[1], line: lineNumber });
        continue;
      }

      if (/^Ref(?:\s+(?:"[^"]+"|[\w-]+))?\s*\{$/i.test(line)) {
        block = { kind: 'reference', line: lineNumber };
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

    // Table groups are parsed after tables so their members can use stable table IDs.
    // Re-scan the compact blocks to resolve names without coupling groups to declaration order.
    const groupBlocks = parseTableGroupMembers(source);
    for (const [index, group] of (schema.tableGroups ?? []).entries()) {
      const names = groupBlocks[index] ?? [];
      group.tableIds = names.flatMap((name) => {
        const table = schema.tables.find(
          (candidate) => qualifiedTableName(candidate) === name || candidate.name === name,
        );
        if (!table) {
          errors.push({ message: `TableGroup ${group.name} references unknown table ${name}` });
          return [];
        }
        return [table.id];
      });
    }

    return errors.length ? { errors } : { schema, errors: [] };
  }
}

function parseTableGroupMembers(source: string): string[][] {
  const groups: string[][] = [];
  let current: string[] | undefined;
  for (const rawLine of source.split(/\r?\n/)) {
    const line = stripComment(rawLine).trim();
    if (!current && /^TableGroup\s+/i.test(line) && /\{$/.test(line)) {
      current = [];
    } else if (current && line === '}') {
      groups.push(current);
      current = undefined;
    } else if (current && line && !/^Note\s*:/i.test(line)) {
      current.push(unquote(line.replace(/,$/, '').trim()));
    }
  }
  return groups;
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
      nullable: primaryKey || !has('not null'),
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
  const match = line.match(/^(?:\(([^)]+)\)|("[^"]+"|[\w-]+))(?:\s*\[(.*)\])?\s*$/);
  const columnList = match?.[1] ?? match?.[2];
  if (!columnList) {
    errors.push({ message: `Invalid index definition: ${line}`, line: lineNumber, column: 1 });
    return undefined;
  }
  const columnNames = columnList.split(',').map((name) => unquote(name.trim()));
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
  const settings = splitSettings(match?.[3] ?? '').map((setting) => setting.toLowerCase());
  const nameSetting = splitSettings(match?.[3] ?? '').find((setting) =>
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
  const unwrapped = value.replace(/^(?:"([\s\S]*)"|'([\s\S]*)')$/, '$1$2');
  return unwrapped.replace(/\\([\\'"n])/g, (_match, escaped: string) =>
    escaped === 'n' ? '\n' : escaped,
  );
}

function error(message: string, line: number, sourceLine: string): DbmlParseError {
  return { message, line, column: Math.max(1, sourceLine.search(/\S/) + 1) };
}
