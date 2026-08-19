import { DEFAULT_TABLE_METRICS } from '../diagram-geometry';
import { DatabaseSchema, DiagramLayout, TableLayout } from '../../schema';

export type AutoLayoutMode = 'left-to-right' | 'pipeline' | 'snowflake' | 'compact';

const HORIZONTAL_GAP = 100;
const VERTICAL_GAP = 64;

export function calculateAutoLayout(
  schema: DatabaseSchema,
  current: DiagramLayout,
  mode: AutoLayoutMode,
): DiagramLayout {
  const positions =
    mode === 'snowflake'
      ? snowflake(schema)
      : mode === 'compact'
        ? compact(schema)
        : layered(schema, mode === 'pipeline');
  return {
    ...current,
    tables: Object.fromEntries(
      schema.tables.map((table) => [
        table.id,
        { ...current.tables[table.id], ...positions[table.id] },
      ]),
    ),
  };
}

function layered(schema: DatabaseSchema, centerStages: boolean): Record<string, TableLayout> {
  const levels = dependencyLevels(schema);
  const groups = new Map<number, DatabaseSchema['tables']>();
  for (const table of schema.tables) {
    const level = levels.get(table.id) ?? 0;
    groups.set(level, [...(groups.get(level) ?? []), table]);
  }
  const stageHeights = [...groups.values()].map((tables) =>
    tables.reduce((sum, table) => sum + tableHeight(table) + VERTICAL_GAP, 0),
  );
  const maxHeight = Math.max(...stageHeights, 0);
  const result: Record<string, TableLayout> = {};
  for (const [level, tables] of groups) {
    let y = 80 + (centerStages ? (maxHeight - (stageHeights[level] ?? 0)) / 2 : 0);
    for (const table of tables) {
      result[table.id] = {
        x: 80 + level * (DEFAULT_TABLE_METRICS.width + HORIZONTAL_GAP),
        y,
      };
      y += tableHeight(table) + VERTICAL_GAP;
    }
  }
  return result;
}

function dependencyLevels(schema: DatabaseSchema): Map<string, number> {
  const adjacency = new Map<string, Set<string>>();
  const indegree = new Map(schema.tables.map((table) => [table.id, 0]));
  for (const relationship of schema.relationships) {
    const parent = relationship.targetTableId;
    const child = relationship.sourceTableId;
    if (parent === child) continue;
    const children = adjacency.get(parent) ?? new Set<string>();
    if (!children.has(child)) {
      children.add(child);
      indegree.set(child, (indegree.get(child) ?? 0) + 1);
    }
    adjacency.set(parent, children);
  }
  const queue = [...indegree].filter(([, degree]) => degree === 0).map(([id]) => id);
  const levels = new Map<string, number>(queue.map((id) => [id, 0]));
  while (queue.length) {
    const parent = queue.shift()!;
    for (const child of adjacency.get(parent) ?? []) {
      levels.set(child, Math.max(levels.get(child) ?? 0, (levels.get(parent) ?? 0) + 1));
      indegree.set(child, (indegree.get(child) ?? 1) - 1);
      if (indegree.get(child) === 0) queue.push(child);
    }
  }
  for (const table of schema.tables) if (!levels.has(table.id)) levels.set(table.id, 0);
  return levels;
}

function compact(schema: DatabaseSchema): Record<string, TableLayout> {
  const columns = Math.max(1, Math.ceil(Math.sqrt(schema.tables.length)));
  const rowHeights: number[] = [];
  schema.tables.forEach((table, index) => {
    const row = Math.floor(index / columns);
    rowHeights[row] = Math.max(rowHeights[row] ?? 0, tableHeight(table));
  });
  const result: Record<string, TableLayout> = {};
  schema.tables.forEach((table, index) => {
    const row = Math.floor(index / columns);
    const y = 70 + rowHeights.slice(0, row).reduce((sum, height) => sum + height + VERTICAL_GAP, 0);
    result[table.id] = {
      x: 70 + (index % columns) * (DEFAULT_TABLE_METRICS.width + 60),
      y,
    };
  });
  return result;
}

function snowflake(schema: DatabaseSchema): Record<string, TableLayout> {
  if (!schema.tables.length) return {};
  const neighbors = new Map<string, Set<string>>();
  for (const relationship of schema.relationships) {
    addNeighbor(neighbors, relationship.sourceTableId, relationship.targetTableId);
    addNeighbor(neighbors, relationship.targetTableId, relationship.sourceTableId);
  }
  const center = [...schema.tables].sort(
    (left, right) => (neighbors.get(right.id)?.size ?? 0) - (neighbors.get(left.id)?.size ?? 0),
  )[0]!;
  const rings = new Map<number, string[]>([[0, [center.id]]]);
  const visited = new Set([center.id]);
  let frontier = [center.id];
  let depth = 1;
  while (frontier.length) {
    const next = [...new Set(frontier.flatMap((id) => [...(neighbors.get(id) ?? [])]))].filter(
      (id) => !visited.has(id),
    );
    if (!next.length) break;
    next.forEach((id) => visited.add(id));
    rings.set(depth++, next);
    frontier = next;
  }
  const remaining = schema.tables.map(({ id }) => id).filter((id) => !visited.has(id));
  if (remaining.length) rings.set(depth, remaining);

  const result: Record<string, TableLayout> = {};
  for (const [ring, ids] of rings) {
    if (ring === 0) {
      result[ids[0]!] = { x: 650, y: 420 };
      continue;
    }
    const radius = 280 * ring;
    ids.forEach((id, index) => {
      const angle = (index / ids.length) * Math.PI * 2 - Math.PI / 2;
      result[id] = { x: 650 + Math.cos(angle) * radius, y: 420 + Math.sin(angle) * radius };
    });
  }
  return result;
}

function addNeighbor(map: Map<string, Set<string>>, from: string, to: string): void {
  const values = map.get(from) ?? new Set<string>();
  values.add(to);
  map.set(from, values);
}

function tableHeight(table: DatabaseSchema['tables'][number]): number {
  return (
    DEFAULT_TABLE_METRICS.headerHeight + table.columns.length * DEFAULT_TABLE_METRICS.rowHeight
  );
}
