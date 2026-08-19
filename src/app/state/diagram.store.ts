import { computed, Injectable, signal } from '@angular/core';
import { DbmlParseError, SimpleDbmlGenerator, SimpleDbmlParser } from '../core/dbml';
import { zoomAtPoint } from '../core/diagram/diagram-geometry';
import { executeDiagramOperation } from '../core/diagram/operations/diagram-operation.executor';
import { DiagramOperation } from '../core/diagram/operations/diagram.operations';
import {
  DefaultSchemaReconciler,
  createColumn,
  createTable,
  DatabaseSchema,
  DiagramLayout,
  DiagramProject,
  DiagramSelection,
  executeSchemaOperation,
  SchemaOperation,
  ViewportState,
} from '../core/schema';

export const EXAMPLE_DBML = `Table users {
  id uuid [pk]
  email varchar [unique]
}

Table posts {
  id uuid [pk]
  user_id uuid
  title varchar
}

Ref: posts.user_id > users.id`;

@Injectable({ providedIn: 'root' })
export class DiagramStore {
  private readonly parser = new SimpleDbmlParser();
  private readonly generator = new SimpleDbmlGenerator();
  private readonly reconciler = new DefaultSchemaReconciler();
  private parseTimer?: ReturnType<typeof setTimeout>;
  readonly project = signal<DiagramProject>(createExampleProject());
  readonly selection = signal<DiagramSelection | null>(null);
  readonly dbmlErrors = signal<DbmlParseError[]>([]);
  readonly changeOrigin = signal<'editor' | 'canvas' | 'import' | 'system'>('system');
  readonly schema = computed(() => this.project().schema);
  readonly layout = computed(() => this.project().layout);
  readonly dbml = computed(() => this.project().dbml);
  readonly zoomPercent = computed(() => Math.round(this.layout().viewport.zoom * 100));
  readonly selectedTable = computed(() => {
    const tableId = this.selection()?.tableId;
    return this.schema().tables.find(({ id }) => id === tableId) ?? null;
  });

  applyDiagramOperation(operation: DiagramOperation): void {
    this.changeOrigin.set('canvas');
    this.project.update((project) => ({
      ...project,
      layout: executeDiagramOperation(project.layout, operation),
      updatedAt: new Date().toISOString(),
    }));
  }

  setDbml(source: string): void {
    this.changeOrigin.set('editor');
    this.project.update((project) => ({
      ...project,
      dbml: source,
      updatedAt: new Date().toISOString(),
    }));
    clearTimeout(this.parseTimer);
    this.parseTimer = setTimeout(() => {
      const result = this.parser.parse(source);
      this.dbmlErrors.set(result.errors);
      if (!result.schema) return;
      this.project.update((project) => ({
        ...project,
        schema: this.reconciler.reconcile(project.schema, result.schema!),
        updatedAt: new Date().toISOString(),
      }));
      this.clearInvalidSelection();
    }, 350);
  }

  applySchemaOperation(operation: SchemaOperation): void {
    clearTimeout(this.parseTimer);
    this.changeOrigin.set('canvas');
    this.project.update((project) => {
      const schema = executeSchemaOperation(project.schema, operation);
      return {
        ...project,
        schema,
        layout: synchronizeLayout(project.layout, schema),
        dbml: this.generator.generate(schema),
        updatedAt: new Date().toISOString(),
      };
    });
    this.dbmlErrors.set([]);
    this.clearInvalidSelection();
  }

  createTable(): void {
    const table = createTable({
      name: nextName(
        'new_table',
        this.schema().tables.map(({ name }) => name),
      ),
      columns: [
        createColumn({
          name: 'id',
          type: 'integer',
          primaryKey: true,
          nullable: false,
        }),
      ],
    });
    this.applySchemaOperation({ type: 'ADD_TABLE', table });
    this.selectTable(table.id);
  }

  renameTable(tableId: string, name: string): void {
    const normalized = name.trim();
    if (!normalized) return;
    this.applySchemaOperation({ type: 'UPDATE_TABLE', tableId, changes: { name: normalized } });
  }

  deleteTable(tableId: string): void {
    this.applySchemaOperation({ type: 'DELETE_TABLE', tableId });
  }

  addColumn(tableId: string): void {
    const table = this.schema().tables.find(({ id }) => id === tableId);
    if (!table) return;
    this.applySchemaOperation({
      type: 'ADD_COLUMN',
      tableId,
      column: createColumn({
        name: nextName(
          'new_column',
          table.columns.map(({ name }) => name),
        ),
      }),
    });
  }

  updateColumn(
    tableId: string,
    columnId: string,
    changes: Extract<SchemaOperation, { type: 'UPDATE_COLUMN' }>['changes'],
  ): void {
    this.applySchemaOperation({ type: 'UPDATE_COLUMN', tableId, columnId, changes });
  }

  deleteColumn(tableId: string, columnId: string): void {
    this.applySchemaOperation({ type: 'DELETE_COLUMN', tableId, columnId });
  }

  selectTable(tableId: string): void {
    this.selection.set({ tableId });
  }

  clearSelection(): void {
    this.selection.set(null);
  }

  setViewport(viewport: ViewportState): void {
    const from = this.layout().viewport;
    this.applyDiagramOperation({ type: 'CHANGE_VIEWPORT', from, to: viewport });
  }

  zoomBy(factor: number, point = { x: 400, y: 300 }): void {
    const viewport = this.layout().viewport;
    this.setViewport(zoomAtPoint(viewport, point, viewport.zoom * factor));
  }

  resetViewport(): void {
    this.setViewport({ x: 35, y: 20, zoom: 1 });
  }

  private clearInvalidSelection(): void {
    const selection = this.selection();
    if (selection?.tableId && !this.schema().tables.some(({ id }) => id === selection.tableId)) {
      this.clearSelection();
    }
  }
}

function nextName(base: string, existingNames: string[]): string {
  const names = new Set(existingNames);
  if (!names.has(base)) return base;
  let suffix = 2;
  while (names.has(`${base}_${suffix}`)) suffix += 1;
  return `${base}_${suffix}`;
}

function synchronizeLayout(layout: DiagramLayout, schema: DatabaseSchema): DiagramLayout {
  const tableIds = new Set(schema.tables.map(({ id }) => id));
  const tables = Object.fromEntries(
    Object.entries(layout.tables).filter(([tableId]) => tableIds.has(tableId)),
  );
  for (const [index, table] of schema.tables.entries()) {
    tables[table.id] ??= {
      x: 80 + (index % 3) * 320,
      y: 90 + Math.floor(index / 3) * 260,
    };
  }
  return { ...layout, tables };
}

function createExampleProject(): DiagramProject {
  const schema = new SimpleDbmlParser().parse(EXAMPLE_DBML).schema!;
  const now = new Date().toISOString();
  return {
    format: 'diagramdb',
    formatVersion: 1,
    id: crypto.randomUUID(),
    name: 'Ecommerce',
    schema,
    layout: {
      tables: Object.fromEntries(
        schema.tables.map((table) => [
          table.id,
          table.name === 'users' ? { x: 440, y: 150 } : { x: 70, y: 300 },
        ]),
      ),
      viewport: { x: 35, y: 20, zoom: 1 },
    },
    dbml: EXAMPLE_DBML,
    createdAt: now,
    updatedAt: now,
  };
}
