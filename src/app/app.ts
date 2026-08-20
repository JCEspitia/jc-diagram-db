import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { ReferentialAction, RelationshipSchema, TableSchema } from './core/schema';
import { AutoLayoutMode } from './core/diagram/auto-layout/auto-layout';
import { DiagramCanvas } from './features/diagram/diagram-canvas/diagram-canvas';
import { DbmlEditor } from './features/editor/dbml-editor/dbml-editor';
import { DiagramStore } from './state/diagram.store';

@Component({
  selector: 'app-root',
  imports: [DiagramCanvas, DbmlEditor],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  protected readonly store = inject(DiagramStore);
  private readonly canvas = viewChild(DiagramCanvas);
  protected readonly dbmlCollapsed = signal(false);
  protected readonly activeSidebar = signal<'dbml' | 'inspector'>('dbml');
  protected readonly tableFilter = signal('');
  protected readonly expandedTableIds = signal<Set<string>>(new Set());
  protected readonly tableMenuId = signal<string | null>(null);
  protected readonly columnMenuId = signal<string | null>(null);
  protected readonly editingTableId = signal<string | null>(null);
  protected readonly relationshipMode = signal(false);
  protected readonly autoLayoutMenu = signal(false);
  protected readonly editorTheme = signal<'dark' | 'light'>('light');
  protected readonly dbmlPanelWidth = signal(340);
  private panelResize?: { startX: number; startWidth: number };

  constructor() {
    const firstTable = this.store.schema().tables[0]!;
    this.store.selectTable(firstTable.id);
    this.expandedTableIds.set(new Set([firstTable.id]));
  }

  protected filteredTables() {
    const filter = this.tableFilter().trim().toLocaleLowerCase();
    return filter
      ? this.store.schema().tables.filter(({ name }) => name.toLocaleLowerCase().includes(filter))
      : this.store.schema().tables;
  }

  protected toggleTable(tableId: string): void {
    this.expandedTableIds.update((current) => {
      const next = new Set(current);
      next.has(tableId) ? next.delete(tableId) : next.add(tableId);
      return next;
    });
  }

  protected createManagedTable(): void {
    this.store.createTable();
    const tableId = this.store.selection()?.tableId;
    if (tableId) this.expandedTableIds.update((ids) => new Set([...ids, tableId]));
  }

  protected selectManagedTable(tableId: string): void {
    this.store.selectTable(tableId);
    this.tableMenuId.set(null);
  }

  protected columnName(table: TableSchema, columnId: string): string {
    return table.columns.find(({ id }) => id === columnId)?.name ?? 'Unknown field';
  }

  protected renameTable(tableId: string, event: Event): void {
    this.store.renameTable(tableId, inputValue(event));
  }

  protected updateColumnText(
    tableId: string,
    columnId: string,
    property: 'name' | 'type',
    event: Event,
  ): void {
    const value = inputValue(event).trim();
    if (value) this.store.updateColumn(tableId, columnId, { [property]: value });
  }

  protected updateColumnFlag(
    tableId: string,
    columnId: string,
    property: 'primaryKey' | 'unique' | 'increment',
    event: Event,
  ): void {
    this.store.updateColumn(tableId, columnId, { [property]: checkboxValue(event) });
  }

  protected updateNotNull(tableId: string, columnId: string, event: Event): void {
    this.store.updateColumn(tableId, columnId, { nullable: !checkboxValue(event) });
  }

  protected fitDiagram(): void {
    this.canvas()?.fitDiagram();
  }

  protected applyAutoLayout(mode: AutoLayoutMode): void {
    this.store.autoLayout(mode);
    this.autoLayoutMenu.set(false);
    requestAnimationFrame(() => this.fitDiagram());
  }

  protected startPanelResize(event: PointerEvent): void {
    event.preventDefault();
    this.panelResize = { startX: event.clientX, startWidth: this.dbmlPanelWidth() };
    (event.currentTarget as Element).setPointerCapture(event.pointerId);
  }

  protected endpointLabel(relationship: RelationshipSchema, side: 'source' | 'target'): string {
    const tableId = side === 'source' ? relationship.sourceTableId : relationship.targetTableId;
    const columnId = side === 'source' ? relationship.sourceColumnId : relationship.targetColumnId;
    const table = this.store.schema().tables.find(({ id }) => id === tableId);
    return `${table?.name ?? 'Unknown'}.${table?.columns.find(({ id }) => id === columnId)?.name ?? 'unknown'}`;
  }

  protected createRelationship(event: {
    sourceTableId: string;
    sourceColumnId: string;
    targetTableId: string;
    targetColumnId: string;
    sourceSide: 'left' | 'right';
    targetSide: 'left' | 'right';
  }): void {
    this.store.createRelationship(
      event.sourceTableId,
      event.sourceColumnId,
      event.targetTableId,
      event.targetColumnId,
      event.sourceSide,
      event.targetSide,
    );
  }

  protected updateRelationshipType(relationshipId: string, event: Event): void {
    this.store.updateRelationship(relationshipId, {
      type: inputValue(event) as RelationshipSchema['type'],
    });
  }

  protected updateReferentialAction(
    relationshipId: string,
    property: 'onDelete' | 'onUpdate',
    event: Event,
  ): void {
    const value = inputValue(event);
    this.store.updateRelationship(relationshipId, {
      [property]: value || undefined,
    } as { onDelete?: ReferentialAction; onUpdate?: ReferentialAction });
  }

  protected updateRelationshipSide(
    relationshipId: string,
    property: 'sourceSide' | 'targetSide',
    event: Event,
  ): void {
    const value = inputValue(event);
    this.store.updateRelationshipRoute(relationshipId, {
      [property]: value || undefined,
    });
  }

  @HostListener('document:keydown', ['$event'])
  protected handleShortcut(event: KeyboardEvent): void {
    const target = event.target as Element | null;
    const editing = Boolean(target?.closest('input, textarea, select, .monaco-editor'));
    const modifier = event.ctrlKey || event.metaKey;
    if (modifier && event.key === '0') {
      event.preventDefault();
      this.fitDiagram();
    } else if (!editing && modifier && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      event.shiftKey ? this.store.redo() : this.store.undo();
    } else if (!editing && event.key === 'Delete') {
      this.store.deleteSelection();
    } else if (!editing && event.key === 'Escape') {
      this.store.clearSelection();
    }
  }

  @HostListener('document:pointermove', ['$event'])
  protected resizePanel(event: PointerEvent): void {
    if (!this.panelResize) return;
    const width = this.panelResize.startWidth + event.clientX - this.panelResize.startX;
    this.dbmlPanelWidth.set(Math.min(600, Math.max(260, width)));
  }

  @HostListener('document:pointerup')
  protected stopPanelResize(): void {
    this.panelResize = undefined;
  }
}

function inputValue(event: Event): string {
  return (event.target as HTMLInputElement).value;
}

function checkboxValue(event: Event): boolean {
  return (event.target as HTMLInputElement).checked;
}
