import { computed, Injectable, signal } from '@angular/core';
import { DbmlParseError, SimpleDbmlGenerator, SimpleDbmlParser } from '../core/dbml';
import { zoomAtPoint } from '../core/diagram/diagram-geometry';
import { AutoLayoutMode, calculateAutoLayout } from '../core/diagram/auto-layout/auto-layout';
import { executeDiagramOperation } from '../core/diagram/operations/diagram-operation.executor';
import { DiagramOperation } from '../core/diagram/operations/diagram.operations';
import {
  DefaultSchemaReconciler,
  createColumn,
  createEntityId,
  createTable,
  DatabaseSchema,
  DiagramLayout,
  DiagramProject,
  DiagramSelection,
  executeSchemaOperation,
  SchemaOperation,
  RelationshipLayout,
  validateSchema,
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
  private readonly undoStack = signal<DiagramProject[]>([]);
  private readonly redoStack = signal<DiagramProject[]>([]);
  readonly project = signal<DiagramProject>(createExampleProject());
  readonly selection = signal<DiagramSelection | null>(null);
  readonly dbmlErrors = signal<DbmlParseError[]>([]);
  readonly changeOrigin = signal<'editor' | 'canvas' | 'import' | 'system'>('system');
  readonly schema = computed(() => this.project().schema);
  readonly layout = computed(() => this.project().layout);
  readonly dbml = computed(() => this.project().dbml);
  readonly zoomPercent = computed(() => Math.round(this.layout().viewport.zoom * 100));
  readonly canUndo = computed(() => this.undoStack().length > 0);
  readonly canRedo = computed(() => this.redoStack().length > 0);
  readonly selectedTable = computed(() => {
    const tableId = this.selection()?.tableId;
    return this.schema().tables.find(({ id }) => id === tableId) ?? null;
  });
  readonly selectedRelationship = computed(() => {
    const relationshipId = this.selection()?.relationshipId;
    return this.schema().relationships.find(({ id }) => id === relationshipId) ?? null;
  });

  applyDiagramOperation(operation: DiagramOperation): void {
    this.changeOrigin.set('canvas');
    const project = this.project();
    const next = {
      ...project,
      layout: executeDiagramOperation(project.layout, operation),
      updatedAt: new Date().toISOString(),
    };
    this.commit(next, operation.type !== 'CHANGE_VIEWPORT');
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
      const reconciled = this.reconciler.reconcile(this.project().schema, result.schema);
      const validationErrors = validateSchema(reconciled);
      if (validationErrors.length) {
        this.dbmlErrors.set(validationErrors.map(({ message }) => ({ message })));
        return;
      }
      this.project.update((project) => ({
        ...project,
        schema: reconciled,
        layout: synchronizeLayout(project.layout, reconciled),
        updatedAt: new Date().toISOString(),
      }));
      this.clearInvalidSelection();
    }, 350);
  }

  applySchemaOperation(operation: SchemaOperation): void {
    clearTimeout(this.parseTimer);
    this.changeOrigin.set('canvas');
    const project = this.project();
    const schema = executeSchemaOperation(project.schema, operation);
    const errors = validateSchema(schema);
    if (errors.length) throw new Error(errors.map(({ message }) => message).join('\n'));
    this.commit(
      {
        ...project,
        schema,
        layout: synchronizeLayout(project.layout, schema),
        dbml: this.generator.generate(schema),
        updatedAt: new Date().toISOString(),
      },
      true,
    );
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
    if (this.schema().tables.some((table) => table.id !== tableId && table.name === normalized))
      return;
    this.applySchemaOperation({ type: 'UPDATE_TABLE', tableId, changes: { name: normalized } });
  }

  updateTableNote(tableId: string, note: string): void {
    this.applySchemaOperation({
      type: 'UPDATE_TABLE',
      tableId,
      changes: { note: note.trim() || undefined },
    });
  }

  updateTableColor(tableId: string, color: string): void {
    if (!/^#[0-9a-f]{6}$/i.test(color)) return;
    this.applySchemaOperation({ type: 'UPDATE_TABLE', tableId, changes: { color } });
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
    if (
      changes.name &&
      this.schema()
        .tables.find(({ id }) => id === tableId)
        ?.columns.some(({ id, name }) => id !== columnId && name === changes.name)
    )
      return;
    this.applySchemaOperation({ type: 'UPDATE_COLUMN', tableId, columnId, changes });
  }

  deleteColumn(tableId: string, columnId: string): void {
    this.applySchemaOperation({ type: 'DELETE_COLUMN', tableId, columnId });
  }

  addIndex(tableId: string): void {
    const table = this.schema().tables.find(({ id }) => id === tableId);
    const firstColumn = table?.columns[0];
    if (!table || !firstColumn) return;
    this.applySchemaOperation({
      type: 'UPDATE_TABLE',
      tableId,
      changes: {
        indexes: [
          ...table.indexes,
          { id: createEntityId('idx'), columns: [firstColumn.id], unique: false },
        ],
      },
    });
  }

  deleteIndex(tableId: string, indexId: string): void {
    const table = this.schema().tables.find(({ id }) => id === tableId);
    if (!table) return;
    this.applySchemaOperation({
      type: 'UPDATE_TABLE',
      tableId,
      changes: { indexes: table.indexes.filter(({ id }) => id !== indexId) },
    });
  }

  moveTable(tableId: string, targetTableId: string, position: 'before' | 'after'): void {
    if (tableId === targetTableId) return;
    this.applySchemaOperation({ type: 'MOVE_TABLE', tableId, targetTableId, position });
  }

  moveColumn(
    tableId: string,
    columnId: string,
    targetColumnId: string,
    position: 'before' | 'after',
  ): void {
    if (columnId === targetColumnId) return;
    this.applySchemaOperation({
      type: 'MOVE_COLUMN',
      tableId,
      columnId,
      targetColumnId,
      position,
    });
  }

  createRelationship(
    sourceTableId: string,
    sourceColumnId: string,
    targetTableId: string,
    targetColumnId: string,
    sourceSide?: 'left' | 'right',
    targetSide?: 'left' | 'right',
  ): void {
    const duplicate = this.schema().relationships.some(
      (relationship) =>
        relationship.sourceTableId === sourceTableId &&
        relationship.sourceColumnId === sourceColumnId &&
        relationship.targetTableId === targetTableId &&
        relationship.targetColumnId === targetColumnId,
    );
    if (duplicate) return;
    const relationshipId = createEntityId('rel');
    this.applySchemaOperation({
      type: 'ADD_RELATIONSHIP',
      relationship: {
        id: relationshipId,
        sourceTableId,
        sourceColumnId,
        targetTableId,
        targetColumnId,
        type: 'many-to-one',
      },
    });
    if (sourceSide || targetSide) {
      this.project.update((project) => ({
        ...project,
        layout: executeDiagramOperation(project.layout, {
          type: 'CHANGE_RELATIONSHIP_ROUTE',
          relationshipId,
          to: { sourceSide, targetSide },
        }),
      }));
    }
    this.selectRelationship(relationshipId);
  }

  updateRelationship(
    relationshipId: string,
    changes: Extract<SchemaOperation, { type: 'UPDATE_RELATIONSHIP' }>['changes'],
  ): void {
    this.applySchemaOperation({
      type: 'UPDATE_RELATIONSHIP',
      relationshipId,
      changes,
    });
  }

  updateRelationshipRoute(relationshipId: string, changes: RelationshipLayout): void {
    const from = this.layout().relationships?.[relationshipId];
    this.applyDiagramOperation({
      type: 'CHANGE_RELATIONSHIP_ROUTE',
      relationshipId,
      from,
      to: { ...from, ...changes },
    });
  }

  deleteRelationship(relationshipId: string): void {
    this.applySchemaOperation({ type: 'DELETE_RELATIONSHIP', relationshipId });
  }

  selectTable(tableId: string): void {
    this.selection.set({ tableId });
  }

  selectColumn(tableId: string, columnId: string): void {
    this.selection.set({ tableId, columnId });
  }

  selectRelationship(relationshipId: string): void {
    this.selection.set({ relationshipId });
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

  autoLayout(mode: AutoLayoutMode = 'compact'): void {
    const project = this.project();
    this.commit(
      {
        ...project,
        layout: calculateAutoLayout(project.schema, project.layout, mode),
        updatedAt: new Date().toISOString(),
      },
      true,
    );
  }

  deleteSelection(): void {
    const selection = this.selection();
    if (selection?.relationshipId) {
      this.applySchemaOperation({
        type: 'DELETE_RELATIONSHIP',
        relationshipId: selection.relationshipId,
      });
    } else if (selection?.columnId && selection.tableId) {
      this.deleteColumn(selection.tableId, selection.columnId);
    } else if (selection?.tableId) {
      this.deleteTable(selection.tableId);
    }
  }

  undo(): void {
    const previous = this.undoStack().at(-1);
    if (!previous) return;
    this.undoStack.update((stack) => stack.slice(0, -1));
    this.redoStack.update((stack) => [...stack, this.project()]);
    this.project.set(previous);
    this.clearInvalidSelection();
  }

  redo(): void {
    const next = this.redoStack().at(-1);
    if (!next) return;
    this.redoStack.update((stack) => stack.slice(0, -1));
    this.undoStack.update((stack) => [...stack, this.project()]);
    this.project.set(next);
    this.clearInvalidSelection();
  }

  private clearInvalidSelection(): void {
    const selection = this.selection();
    const table = this.schema().tables.find(({ id }) => id === selection?.tableId);
    const invalid =
      (selection?.tableId && !table) ||
      (selection?.columnId && !table?.columns.some(({ id }) => id === selection.columnId)) ||
      (selection?.relationshipId &&
        !this.schema().relationships.some(({ id }) => id === selection.relationshipId));
    if (invalid) {
      this.clearSelection();
    }
  }

  private commit(project: DiagramProject, recordHistory: boolean): void {
    if (recordHistory) {
      this.undoStack.update((stack) => [...stack.slice(-99), this.project()]);
      this.redoStack.set([]);
    }
    this.project.set(project);
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
  const relationshipIds = new Set(schema.relationships.map(({ id }) => id));
  const relationships = Object.fromEntries(
    Object.entries(layout.relationships ?? {}).filter(([relationshipId]) =>
      relationshipIds.has(relationshipId),
    ),
  );
  return { ...layout, tables, relationships };
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
