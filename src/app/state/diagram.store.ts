import { computed, Injectable, signal } from '@angular/core';
import { DbmlParseError, SimpleDbmlGenerator, SimpleDbmlParser } from '../core/dbml';
import { zoomAtPoint } from '../core/diagram/diagram-geometry';
import { executeDiagramOperation } from '../core/diagram/operations/diagram-operation.executor';
import { DiagramOperation } from '../core/diagram/operations/diagram.operations';
import {
  DefaultSchemaReconciler,
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
        dbml: this.generator.generate(schema),
        updatedAt: new Date().toISOString(),
      };
    });
    this.dbmlErrors.set([]);
    this.clearInvalidSelection();
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
