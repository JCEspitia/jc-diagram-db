import {
  ColumnSchema,
  DatabaseSchema,
  RelationshipSchema,
  TableSchema,
} from '../models/schema.models';

export interface SchemaReconciler {
  reconcile(current: DatabaseSchema, parsed: DatabaseSchema): DatabaseSchema;
}

export class DefaultSchemaReconciler implements SchemaReconciler {
  reconcile(current: DatabaseSchema, parsed: DatabaseSchema): DatabaseSchema {
    const usedTableIds = new Set<string>();
    const tableIdMap = new Map<string, string>();
    const columnIdMap = new Map<string, string>();

    const tables = parsed.tables.map((parsedTable) => {
      const existing = findTableMatch(parsedTable, current.tables, usedTableIds);
      if (!existing) return parsedTable;

      usedTableIds.add(existing.id);
      tableIdMap.set(parsedTable.id, existing.id);
      const columns = reconcileColumns(existing, parsedTable, columnIdMap);
      const indexes = parsedTable.indexes.map((index) => ({
        ...index,
        id:
          existing.indexes.find((candidate) =>
            sameIndex(
              candidate,
              index.columns.map((columnId) => columnIdMap.get(columnId) ?? columnId),
              index,
            ),
          )?.id ?? index.id,
        columns: index.columns.map((columnId) => columnIdMap.get(columnId) ?? columnId),
      }));
      const checks = parsedTable.checks?.map((check, index) => ({
        ...check,
        id:
          existing.checks?.find(({ expression }) => expression === check.expression)?.id ??
          existing.checks?.[index]?.id ??
          check.id,
      }));
      return { ...parsedTable, id: existing.id, columns, indexes, ...(checks ? { checks } : {}) };
    });

    const relationships = parsed.relationships.map((relationship) => {
      const remapped = remapRelationship(relationship, tableIdMap, columnIdMap);
      const existing = current.relationships.find((candidate) =>
        sameRelationship(candidate, remapped),
      );
      return existing
        ? {
            ...remapped,
            id: existing.id,
            sourceCardinality: existing.sourceCardinality,
            targetCardinality: existing.targetCardinality,
          }
        : remapped;
    });

    return {
      ...parsed,
      id: current.id,
      name: current.name,
      tables,
      relationships,
      enums: parsed.enums.map((parsedEnum) => {
        const existing = current.enums.find(
          ({ name, values }) =>
            name === parsedEnum.name || values.join('|') === parsedEnum.values.join('|'),
        );
        return existing ? { ...parsedEnum, id: existing.id } : parsedEnum;
      }),
    };
  }
}

function sameIndex(
  existing: TableSchema['indexes'][number],
  remappedColumns: string[],
  parsed: TableSchema['indexes'][number],
): boolean {
  return (
    existing.columns.join('|') === remappedColumns.join('|') &&
    Boolean(existing.unique) === Boolean(parsed.unique) &&
    Boolean(existing.primaryKey) === Boolean(parsed.primaryKey) &&
    existing.name === parsed.name
  );
}

function findTableMatch(
  parsed: TableSchema,
  existingTables: TableSchema[],
  usedIds: Set<string>,
): TableSchema | undefined {
  const available = existingTables.filter(({ id }) => !usedIds.has(id));
  const exact = available.find(
    (candidate) => candidate.name === parsed.name && candidate.schema === parsed.schema,
  );
  if (exact) return exact;

  const ranked = available
    .map((candidate) => ({ candidate, score: tableSimilarity(candidate, parsed) }))
    .sort((left, right) => right.score - left.score);
  return ranked[0] && ranked[0].score >= 0.65 ? ranked[0].candidate : undefined;
}

function tableSimilarity(left: TableSchema, right: TableSchema): number {
  if (!left.columns.length && !right.columns.length) return 0;
  const rightSignatures = new Set(right.columns.map(columnSignature));
  const matching = left.columns.filter((column) =>
    rightSignatures.has(columnSignature(column)),
  ).length;
  const union = left.columns.length + right.columns.length - matching;
  return union === 0 ? 0 : matching / union;
}

function reconcileColumns(
  existingTable: TableSchema,
  parsedTable: TableSchema,
  columnIdMap: Map<string, string>,
): ColumnSchema[] {
  const usedIds = new Set<string>();
  return parsedTable.columns.map((parsedColumn) => {
    const available = existingTable.columns.filter(({ id }) => !usedIds.has(id));
    const exact = available.find(({ name }) => name === parsedColumn.name);
    const structural = available.find(
      (candidate) => columnSignature(candidate) === columnSignature(parsedColumn),
    );
    const existing = exact ?? structural;
    if (!existing) return parsedColumn;
    usedIds.add(existing.id);
    columnIdMap.set(parsedColumn.id, existing.id);
    return { ...parsedColumn, id: existing.id };
  });
}

function columnSignature(column: ColumnSchema): string {
  return [
    column.type.toLowerCase(),
    column.primaryKey,
    column.nullable,
    column.unique,
    column.increment,
  ].join('|');
}

function remapRelationship(
  relationship: RelationshipSchema,
  tableIds: Map<string, string>,
  columnIds: Map<string, string>,
): RelationshipSchema {
  return {
    ...relationship,
    sourceTableId: tableIds.get(relationship.sourceTableId) ?? relationship.sourceTableId,
    sourceColumnId: columnIds.get(relationship.sourceColumnId) ?? relationship.sourceColumnId,
    targetTableId: tableIds.get(relationship.targetTableId) ?? relationship.targetTableId,
    targetColumnId: columnIds.get(relationship.targetColumnId) ?? relationship.targetColumnId,
  };
}

function sameRelationship(left: RelationshipSchema, right: RelationshipSchema): boolean {
  return (
    left.sourceTableId === right.sourceTableId &&
    left.sourceColumnId === right.sourceColumnId &&
    left.targetTableId === right.targetTableId &&
    left.targetColumnId === right.targetColumnId &&
    left.type === right.type
  );
}
