import { computed, Injectable, signal } from '@angular/core';
import {
  DbmlParseError,
  preserveDbmlComments,
  SimpleDbmlGenerator,
  SimpleDbmlParser,
} from '../core/dbml';
import { zoomAtPoint } from '../core/diagram/diagram-geometry';
import { DEFAULT_TABLE_METRICS } from '../core/diagram/diagram-geometry';
import { AutoLayoutMode, calculateAutoLayout } from '../core/diagram/auto-layout/auto-layout';
import { executeDiagramOperation } from '../core/diagram/operations/diagram-operation.executor';
import { DiagramOperation } from '../core/diagram/operations/diagram.operations';
import {
  DefaultSchemaReconciler,
  createColumn,
  createEntityId,
  createUuid,
  createTable,
  DatabaseSchema,
  DiagramAreaLayout,
  DiagramDetailLevel,
  DiagramLayout,
  DiagramProject,
  DiagramSelection,
  executeSchemaOperation,
  SchemaOperation,
  RelationshipLayout,
  validateSchema,
  ViewportState,
} from '../core/schema';
import {
  IndexedDbProjectRepository,
  ProjectRepository,
} from '../core/persistence/project.repository';

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
  private readonly repository: ProjectRepository;
  private readonly parser = new SimpleDbmlParser();
  private readonly generator = new SimpleDbmlGenerator();
  private readonly reconciler = new DefaultSchemaReconciler();
  private parseTimer?: ReturnType<typeof setTimeout>;
  private saveTimer?: ReturnType<typeof setTimeout>;
  private persistenceReady = false;
  private readonly undoStack = signal<DiagramProject[]>([]);
  private readonly redoStack = signal<DiagramProject[]>([]);
  readonly project = signal<DiagramProject>(createExampleProject());
  readonly selection = signal<DiagramSelection | null>(null);
  readonly dbmlErrors = signal<DbmlParseError[]>([]);
  readonly changeOrigin = signal<'editor' | 'canvas' | 'import' | 'system'>('system');
  readonly persistenceState = signal<'loading' | 'saving' | 'saved' | 'error'>('loading');
  readonly persistenceError = signal<string | null>(null);
  readonly projects = signal<DiagramProject[]>([]);
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

  async createProject(name = 'Untitled diagram'): Promise<void> {
    await this.flushSave();
    const project = createBlankProject(name);
    await this.repository.saveProject(project);
    this.activateProject(project);
    await this.refreshProjects();
  }

  async openProject(projectId: string): Promise<void> {
    if (projectId === this.project().id) return;
    await this.flushSave();
    const project = await this.repository.loadProject(projectId);
    if (!project) return;
    this.activateProject(project);
    await this.repository.saveProject(project);
    await this.refreshProjects();
  }

  async renameProject(projectId: string, name: string): Promise<void> {
    const normalized = name.trim();
    if (!normalized) return;
    const source =
      projectId === this.project().id
        ? this.project()
        : await this.repository.loadProject(projectId);
    if (!source) return;
    const project = { ...source, name: normalized, updatedAt: new Date().toISOString() };
    await this.repository.saveProject(project);
    if (projectId === this.project().id) this.project.set(project);
    await this.refreshProjects();
  }

  async duplicateProject(projectId: string): Promise<void> {
    await this.flushSave();
    const source =
      projectId === this.project().id
        ? this.project()
        : await this.repository.loadProject(projectId);
    if (!source) return;
    const now = new Date().toISOString();
    const duplicate: DiagramProject = {
      ...structuredClone(source),
      id: createUuid(),
      name: `${source.name} copy`,
      createdAt: now,
      updatedAt: now,
    };
    await this.repository.saveProject(duplicate);
    this.activateProject(duplicate);
    await this.refreshProjects();
  }

  async deleteProject(projectId: string): Promise<void> {
    await this.repository.deleteProject(projectId);
    if (projectId === this.project().id) {
      const remaining = await this.repository.listProjects();
      const replacement = remaining[0] ?? createBlankProject();
      this.activateProject(replacement);
      await this.repository.saveProject(replacement);
    }
    await this.refreshProjects();
  }

  constructor(repository: IndexedDbProjectRepository = new IndexedDbProjectRepository()) {
    this.repository = repository;
    const initialProject = this.project();
    void this.restoreProject(initialProject);
  }

  applyDiagramOperation(operation: DiagramOperation): void {
    this.changeOrigin.set('canvas');
    const project = this.project();
    let rawLayout = executeDiagramOperation(project.layout, operation);
    if (operation.type === 'CHANGE_DETAIL_LEVEL') {
      rawLayout = fitAllAreas(project.schema, rawLayout);
    } else if (operation.type === 'MOVE_TABLE') {
      rawLayout = expandMemberAreas(project.schema, rawLayout, operation.tableId);
    } else if (operation.type === 'RESIZE_AREA') {
      rawLayout = fitAreaToMembers(project.schema, rawLayout, operation.areaId);
    }
    const schema = synchroniseTableGroups(
      project.schema,
      rawLayout,
      operation.type === 'MOVE_AREA',
    );
    const layout = synchronizeLayout(rawLayout, schema);
    const changesDbml = !sameTableGroups(
      project.schema.tableGroups ?? [],
      schema.tableGroups ?? [],
    );
    const next = {
      ...project,
      schema,
      layout,
      ...(changesDbml
        ? { dbml: preserveDbmlComments(project.dbml, this.generator.generate(schema)) }
        : {}),
      updatedAt: new Date().toISOString(),
    };
    this.commit(next, operation.type !== 'CHANGE_VIEWPORT');
  }

  setDetailLevel(level: DiagramDetailLevel): void {
    const from = this.layout().detailLevel ?? 'all';
    if (from !== level)
      this.applyDiagramOperation({ type: 'CHANGE_DETAIL_LEVEL', from, to: level });
  }

  setDbml(source: string): void {
    this.changeOrigin.set('editor');
    this.updateProject((project) => ({
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
      this.updateProject((project) => ({
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
    const generatedDbml = this.generator.generate(schema);
    this.commit(
      {
        ...project,
        schema,
        layout: synchronizeLayout(project.layout, schema),
        dbml: preserveDbmlComments(project.dbml, generatedDbml),
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
          nullable: true,
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

  addTableCheck(tableId: string): void {
    const table = this.schema().tables.find(({ id }) => id === tableId);
    if (!table) return;
    this.applySchemaOperation({
      type: 'UPDATE_TABLE',
      tableId,
      changes: {
        checks: [...(table.checks ?? []), { id: createEntityId('chk'), expression: '' }],
      },
    });
  }

  updateTableCheck(tableId: string, checkId: string, expression: string): void {
    const table = this.schema().tables.find(({ id }) => id === tableId);
    if (!table?.checks?.some(({ id }) => id === checkId)) return;
    this.applySchemaOperation({
      type: 'UPDATE_TABLE',
      tableId,
      changes: {
        checks: table.checks.map((check) =>
          check.id === checkId ? { ...check, expression } : check,
        ),
      },
    });
  }

  deleteTableCheck(tableId: string, checkId: string): void {
    const table = this.schema().tables.find(({ id }) => id === tableId);
    if (!table) return;
    this.applySchemaOperation({
      type: 'UPDATE_TABLE',
      tableId,
      changes: { checks: (table.checks ?? []).filter(({ id }) => id !== checkId) },
    });
  }

  deleteTable(tableId: string): void {
    this.applySchemaOperation({ type: 'DELETE_TABLE', tableId });
  }

  createEnum(): string {
    const enumSchema = {
      id: createEntityId('enm'),
      name: nextName(
        'new_enum',
        this.schema().enums.map(({ name }) => name),
      ),
      values: ['new_value'],
    };
    this.applySchemaOperation({ type: 'ADD_ENUM', enumSchema });
    return enumSchema.id;
  }

  renameEnum(enumId: string, name: string): void {
    const normalized = name.trim();
    if (
      !normalized ||
      this.schema().enums.some(({ id, name }) => id !== enumId && name === normalized)
    )
      return;
    this.applySchemaOperation({ type: 'UPDATE_ENUM', enumId, changes: { name: normalized } });
  }

  addEnumValue(enumId: string): void {
    const enumSchema = this.schema().enums.find(({ id }) => id === enumId);
    if (!enumSchema) return;
    this.applySchemaOperation({
      type: 'UPDATE_ENUM',
      enumId,
      changes: { values: [...enumSchema.values, nextName('new_value', enumSchema.values)] },
    });
  }

  updateEnumValue(enumId: string, index: number, value: string): void {
    const enumSchema = this.schema().enums.find(({ id }) => id === enumId);
    const normalized = value.trim();
    if (
      !enumSchema ||
      !normalized ||
      enumSchema.values.some(
        (candidate, candidateIndex) => candidateIndex !== index && candidate === normalized,
      )
    )
      return;
    this.applySchemaOperation({
      type: 'UPDATE_ENUM',
      enumId,
      changes: {
        values: enumSchema.values.map((candidate, candidateIndex) =>
          candidateIndex === index ? normalized : candidate,
        ),
      },
    });
  }

  deleteEnumValue(enumId: string, index: number): void {
    const enumSchema = this.schema().enums.find(({ id }) => id === enumId);
    if (!enumSchema || enumSchema.values.length <= 1) return;
    this.applySchemaOperation({
      type: 'UPDATE_ENUM',
      enumId,
      changes: {
        values: enumSchema.values.filter((_value, candidateIndex) => candidateIndex !== index),
      },
    });
  }

  deleteEnum(enumId: string): void {
    this.applySchemaOperation({ type: 'DELETE_ENUM', enumId });
  }

  createArea(): string {
    const areaId = createEntityId('area');
    const index = Object.keys(this.layout().areas ?? {}).length;
    this.applyDiagramOperation({
      type: 'ADD_AREA',
      areaId,
      area: {
        name: nextName(
          'New area',
          Object.values(this.layout().areas ?? {}).map(({ name }) => name),
        ),
        color: '#6d8cff',
        x: 60 + index * 30,
        y: 60 + index * 30,
        width: 520,
        height: 360,
      },
    });
    return areaId;
  }

  updateArea(areaId: string, changes: Partial<DiagramAreaLayout>): void {
    const from = this.layout().areas?.[areaId];
    if (!from) return;
    this.applyDiagramOperation({ type: 'UPDATE_AREA', areaId, from, to: { ...from, ...changes } });
  }

  assignTableToArea(tableId: string, areaId: string | null): void {
    if (!this.schema().tables.some(({ id }) => id === tableId)) return;
    const project = this.project();
    if (areaId && !project.layout.areas?.[areaId]) return;
    const areas = Object.fromEntries(
      Object.entries(project.layout.areas ?? {}).map(([id, area]) => [
        id,
        {
          ...area,
          tableIds: [
            ...(area.tableIds ?? []).filter((candidate) => candidate !== tableId),
            ...(id === areaId ? [tableId] : []),
          ],
        },
      ]),
    );
    let layout: DiagramLayout = { ...project.layout, areas };
    if (areaId) {
      const area = areas[areaId]!;
      const wasMember = project.layout.areas?.[areaId]?.tableIds?.includes(tableId);
      if (!wasMember) {
        const existingBounds = memberBounds(
          project.schema,
          project.layout,
          area.tableIds?.filter((id) => id !== tableId) ?? [],
        );
        layout = {
          ...layout,
          tables: {
            ...layout.tables,
            [tableId]: {
              ...layout.tables[tableId],
              x: existingBounds?.left ?? area.x + AREA_PADDING,
              y: existingBounds
                ? existingBounds.bottom + AREA_PADDING
                : area.y + AREA_HEADER_HEIGHT,
            },
          },
        };
      }
      layout = fitAreaToMembers(project.schema, layout, areaId);
    }
    const schema = synchroniseTableGroups(project.schema, layout, true);
    this.commit(
      {
        ...project,
        schema,
        layout: synchronizeLayout(layout, schema),
        dbml: preserveDbmlComments(project.dbml, this.generator.generate(schema)),
        updatedAt: new Date().toISOString(),
      },
      true,
    );
  }

  compactArea(areaId: string): void {
    const project = this.project();
    const area = project.layout.areas?.[areaId];
    if (!area) return;
    const bounds = memberBounds(project.schema, project.layout, area.tableIds ?? []);
    if (!bounds) return;
    this.updateArea(areaId, areaAroundBounds(area, bounds));
  }

  toggleAreaCollapsed(areaId: string): void {
    const area = this.layout().areas?.[areaId];
    if (area) this.updateArea(areaId, { collapsed: !area.collapsed });
  }

  deleteArea(areaId: string): void {
    const area = this.layout().areas?.[areaId];
    if (area) this.applyDiagramOperation({ type: 'DELETE_AREA', areaId, area });
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
    const column = this.schema()
      .tables.find(({ id }) => id === tableId)
      ?.columns.find(({ id }) => id === columnId);
    if (!column) return;
    if (
      changes.name &&
      this.schema()
        .tables.find(({ id }) => id === tableId)
        ?.columns.some(({ id, name }) => id !== columnId && name === changes.name)
    )
      return;
    const normalized = { ...changes };
    if (normalized.primaryKey === true) {
      normalized.nullable = true;
      normalized.unique = false;
    }
    if (normalized.nullable === false) normalized.primaryKey = false;
    if (normalized.unique === true && column.primaryKey && normalized.primaryKey !== false) return;
    const resultingType = normalized.type ?? column.type;
    if (normalized.increment === true) {
      if (!supportsAutoIncrement(resultingType)) return;
      normalized.defaultValue = undefined;
    } else if (normalized.type && !supportsAutoIncrement(normalized.type)) {
      normalized.increment = false;
    }
    if (normalized.defaultValue !== undefined) normalized.increment = false;
    this.applySchemaOperation({ type: 'UPDATE_COLUMN', tableId, columnId, changes: normalized });
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
      this.updateProject((project) => ({
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
    this.replaceProject(previous);
    this.clearInvalidSelection();
  }

  redo(): void {
    const next = this.redoStack().at(-1);
    if (!next) return;
    this.redoStack.update((stack) => stack.slice(0, -1));
    this.undoStack.update((stack) => [...stack, this.project()]);
    this.replaceProject(next);
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
    this.replaceProject(project);
  }

  private updateProject(update: (project: DiagramProject) => DiagramProject): void {
    this.replaceProject(update(this.project()));
  }

  private replaceProject(project: DiagramProject): void {
    this.project.set(project);
    if (this.persistenceReady) this.scheduleSave(project);
  }

  private async restoreProject(initialProject: DiagramProject): Promise<void> {
    try {
      const saved = await this.repository.loadLastProject();
      this.persistenceReady = true;
      if (saved && this.project() === initialProject) {
        this.project.set(saved);
        this.undoStack.set([]);
        this.redoStack.set([]);
        this.dbmlErrors.set([]);
        this.clearSelection();
      } else if (saved) {
        // The user edited the initial project before IndexedDB finished
        // loading. Their in-memory work wins over the older saved snapshot.
        this.scheduleSave(this.project());
        return;
      } else if (!saved) {
        this.scheduleSave(this.project());
        return;
      }
      this.persistenceState.set('saved');
      await this.refreshProjects();
    } catch (error) {
      this.persistenceReady = true;
      this.persistenceState.set('error');
      this.persistenceError.set(errorMessage(error));
    }
  }

  private scheduleSave(project: DiagramProject): void {
    clearTimeout(this.saveTimer);
    this.persistenceState.set('saving');
    this.persistenceError.set(null);
    this.saveTimer = setTimeout(() => void this.save(project), 700);
  }

  private async save(project: DiagramProject): Promise<void> {
    try {
      await this.repository.saveProject(project);
      await this.refreshProjects();
      if (this.project().updatedAt === project.updatedAt) this.persistenceState.set('saved');
    } catch (error) {
      this.persistenceState.set('error');
      this.persistenceError.set(errorMessage(error));
    }
  }

  private async flushSave(): Promise<void> {
    clearTimeout(this.saveTimer);
    if (this.persistenceReady) await this.save(this.project());
  }

  private activateProject(project: DiagramProject): void {
    clearTimeout(this.parseTimer);
    clearTimeout(this.saveTimer);
    this.project.set(project);
    this.undoStack.set([]);
    this.redoStack.set([]);
    this.dbmlErrors.set([]);
    this.clearSelection();
    this.persistenceState.set('saved');
  }

  private async refreshProjects(): Promise<void> {
    this.projects.set(await this.repository.listProjects());
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'The project could not be saved.';
}

function nextName(base: string, existingNames: string[]): string {
  const names = new Set(existingNames);
  if (!names.has(base)) return base;
  let suffix = 2;
  while (names.has(`${base}_${suffix}`)) suffix += 1;
  return `${base}_${suffix}`;
}

function sameTableGroups(
  left: NonNullable<DatabaseSchema['tableGroups']>,
  right: NonNullable<DatabaseSchema['tableGroups']>,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function supportsAutoIncrement(type: string): boolean {
  const normalized = type
    .trim()
    .toLocaleLowerCase()
    .replace(/\([^)]*\)$/, '');
  return ['smallint', 'integer', 'int', 'bigint', 'smallserial', 'serial', 'bigserial'].includes(
    normalized,
  );
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
  const existingAreas = layout.areas ?? {};
  const areas = Object.fromEntries(
    (schema.tableGroups ?? []).map((group, index) => {
      const existing = existingAreas[group.id];
      return [
        group.id,
        {
          name: group.name,
          note: group.note,
          color: group.color ?? '#6d8cff',
          x: existing?.x ?? 50 + index * 35,
          y: existing?.y ?? 50 + index * 35,
          width: existing?.width ?? 520,
          height: existing?.height ?? 360,
          tableIds: group.tableIds,
          ...(existing?.collapsed ? { collapsed: true } : {}),
        },
      ];
    }),
  );
  return fitAllAreas(schema, { ...layout, tables, relationships, areas });
}

function synchroniseTableGroups(
  schema: DatabaseSchema,
  layout: DiagramLayout,
  preserveMembership: boolean,
): DatabaseSchema {
  const tableGroups = Object.entries(layout.areas ?? {}).map(([id, area]) => ({
    id,
    name: area.name,
    color: area.color,
    ...(area.note ? { note: area.note } : {}),
    tableIds:
      area.tableIds ??
      (preserveMembership
        ? ((schema.tableGroups ?? []).find((group) => group.id === id)?.tableIds ?? [])
        : []),
  }));
  return { ...schema, tableGroups };
}

interface Bounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const AREA_PADDING = 24;
const AREA_HEADER_HEIGHT = 42;

function tableBounds(
  schema: DatabaseSchema,
  layout: DiagramLayout,
  tableId: string,
): Bounds | undefined {
  const table = schema.tables.find(({ id }) => id === tableId);
  const position = layout.tables[tableId];
  if (!table || !position) return undefined;
  return {
    left: position.x,
    top: position.y,
    right: position.x + (position.width ?? DEFAULT_TABLE_METRICS.width),
    bottom: position.y + tableVisualHeight(schema, layout, table.id),
  };
}

function memberBounds(
  schema: DatabaseSchema,
  layout: DiagramLayout,
  tableIds: string[],
): Bounds | undefined {
  const bounds = tableIds.flatMap((id) => {
    const value = tableBounds(schema, layout, id);
    return value ? [value] : [];
  });
  if (!bounds.length) return undefined;
  return {
    left: Math.min(...bounds.map(({ left }) => left)),
    top: Math.min(...bounds.map(({ top }) => top)),
    right: Math.max(...bounds.map(({ right }) => right)),
    bottom: Math.max(...bounds.map(({ bottom }) => bottom)),
  };
}

function areaAroundBounds(area: DiagramAreaLayout, bounds: Bounds): Partial<DiagramAreaLayout> {
  const x = bounds.left - AREA_PADDING;
  const y = bounds.top - AREA_HEADER_HEIGHT;
  return {
    x,
    y,
    width: Math.max(240, bounds.right + AREA_PADDING - x),
    height: Math.max(160, bounds.bottom + AREA_PADDING - y),
  };
}

function containAreaMembers(
  schema: DatabaseSchema,
  layout: DiagramLayout,
  areaId: string,
): DiagramLayout {
  const area = layout.areas?.[areaId];
  if (!area) return layout;
  const bounds = memberBounds(schema, layout, area.tableIds ?? []);
  if (!bounds) return layout;
  const left = Math.min(area.x, bounds.left - AREA_PADDING);
  const top = Math.min(area.y, bounds.top - AREA_HEADER_HEIGHT);
  const right = Math.max(area.x + area.width, bounds.right + AREA_PADDING);
  const bottom = Math.max(area.y + area.height, bounds.bottom + AREA_PADDING);
  return {
    ...layout,
    areas: {
      ...layout.areas,
      [areaId]: { ...area, x: left, y: top, width: right - left, height: bottom - top },
    },
  };
}

function expandMemberAreas(
  schema: DatabaseSchema,
  layout: DiagramLayout,
  tableId: string,
): DiagramLayout {
  return (schema.tableGroups ?? [])
    .filter(({ tableIds }) => tableIds.includes(tableId))
    .reduce((current, group) => fitAreaToMembers(schema, current, group.id), layout);
}

function fitAreaToMembers(
  schema: DatabaseSchema,
  layout: DiagramLayout,
  areaId: string,
): DiagramLayout {
  const area = layout.areas?.[areaId];
  if (!area) return layout;
  const bounds = memberBounds(schema, layout, area.tableIds ?? []);
  if (!bounds) return layout;
  return {
    ...layout,
    areas: { ...layout.areas, [areaId]: { ...area, ...areaAroundBounds(area, bounds) } },
  };
}

function fitAllAreas(schema: DatabaseSchema, layout: DiagramLayout): DiagramLayout {
  return Object.keys(layout.areas ?? {}).reduce(
    (current, areaId) => fitAreaToMembers(schema, current, areaId),
    layout,
  );
}

function tableVisualHeight(schema: DatabaseSchema, layout: DiagramLayout, tableId: string): number {
  const table = schema.tables.find(({ id }) => id === tableId);
  if (!table) return DEFAULT_TABLE_METRICS.headerHeight;
  const level = layout.detailLevel ?? 'all';
  if (level === 'names') return DEFAULT_TABLE_METRICS.headerHeight;
  const count =
    level === 'all'
      ? table.columns.length
      : table.columns.filter(
          (column) =>
            column.primaryKey ||
            table.indexes.some((index) => index.primaryKey && index.columns.includes(column.id)) ||
            schema.relationships.some(
              (relationship) =>
                relationship.sourceColumnId === column.id ||
                relationship.targetColumnId === column.id,
            ),
        ).length;
  return DEFAULT_TABLE_METRICS.headerHeight + count * DEFAULT_TABLE_METRICS.rowHeight;
}

function createExampleProject(): DiagramProject {
  const schema = new SimpleDbmlParser().parse(EXAMPLE_DBML).schema!;
  const now = new Date().toISOString();
  return {
    format: 'diagramdb',
    formatVersion: 1,
    id: createUuid(),
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

function createBlankProject(name = 'Untitled diagram'): DiagramProject {
  const dbml = `Table new_table {\n  id integer [pk]\n}`;
  const schema = new SimpleDbmlParser().parse(dbml).schema!;
  const now = new Date().toISOString();
  return {
    format: 'diagramdb',
    formatVersion: 1,
    id: createUuid(),
    name,
    schema,
    layout: {
      tables: { [schema.tables[0]!.id]: { x: 120, y: 100 } },
      viewport: { x: 35, y: 20, zoom: 1 },
    },
    dbml,
    createdAt: now,
    updatedAt: now,
  };
}
