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
import { DiagramStore, supportsAutoIncrement } from './state/diagram.store';
import { TooltipDirective } from './shared/tooltip/tooltip.directive';
import { DEFAULT_TABLE_COLOR, TABLE_COLORS } from './shared/table-colors';
import {
  LucideChevronRight,
  LucideCode2,
  LucideEllipsis,
  LucideGripVertical,
  LucideGrid2x2,
  LucideKeyRound,
  LucideLink2,
  LucideLocateFixed,
  LucideMoon,
  LucidePanelLeftClose,
  LucidePencil,
  LucidePlus,
  LucideRedo2,
  LucideScan,
  LucideSearch,
  LucideSun,
  LucideSnowflake,
  LucideTable2,
  LucideTrash2,
  LucideUndo2,
  LucideWorkflow,
  LucideX,
  LucideZoomIn,
  LucideZoomOut,
} from '@lucide/angular';

@Component({
  selector: 'app-root',
  imports: [
    DiagramCanvas,
    DbmlEditor,
    LucideChevronRight,
    LucideCode2,
    LucideEllipsis,
    LucideGripVertical,
    LucideGrid2x2,
    LucideKeyRound,
    LucideLink2,
    LucideLocateFixed,
    LucideMoon,
    LucidePanelLeftClose,
    LucidePencil,
    LucidePlus,
    LucideRedo2,
    LucideScan,
    LucideSearch,
    LucideSun,
    LucideSnowflake,
    LucideTable2,
    LucideTrash2,
    LucideUndo2,
    LucideWorkflow,
    LucideX,
    LucideZoomIn,
    LucideZoomOut,
    TooltipDirective,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  protected readonly store = inject(DiagramStore);
  protected readonly tableColors = TABLE_COLORS;
  protected readonly defaultTableColor = DEFAULT_TABLE_COLOR;
  private readonly canvas = viewChild(DiagramCanvas);
  protected readonly dbmlCollapsed = signal(false);
  protected readonly activeSidebar = signal<'dbml' | 'inspector'>('dbml');
  protected readonly tableFilter = signal('');
  protected readonly expandedTableIds = signal<Set<string>>(new Set());
  protected readonly tableMenuId = signal<string | null>(null);
  protected readonly columnMenuId = signal<string | null>(null);
  protected readonly editingTableId = signal<string | null>(null);
  protected readonly draggedTableId = signal<string | null>(null);
  protected readonly draggedColumn = signal<{ tableId: string; columnId: string } | null>(null);
  protected readonly tableDropTargetId = signal<string | null>(null);
  protected readonly columnDropTargetId = signal<string | null>(null);
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
      return current.has(tableId) ? new Set() : new Set([tableId]);
    });
  }

  protected createManagedTable(): void {
    this.store.createTable();
    const tableId = this.store.selection()?.tableId;
    if (tableId) this.expandedTableIds.set(new Set([tableId]));
  }

  protected selectManagedTable(tableId: string): void {
    this.store.selectTable(tableId);
    this.tableMenuId.set(null);
    requestAnimationFrame(() => this.canvas()?.focusTable(tableId));
  }

  protected editManagedTable(tableId: string): void {
    this.activeSidebar.set('inspector');
    this.dbmlCollapsed.set(false);
    this.expandedTableIds.set(new Set([tableId]));
    this.selectManagedTable(tableId);
  }

  protected columnName(table: TableSchema, columnId: string): string {
    return table.columns.find(({ id }) => id === columnId)?.name ?? 'Unknown field';
  }

  protected startTableReorder(event: DragEvent, tableId: string): void {
    this.draggedTableId.set(tableId);
    event.dataTransfer?.setData('text/plain', tableId);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
  }

  protected dropTable(event: DragEvent, targetTableId: string): void {
    event.preventDefault();
    const tableId = this.draggedTableId();
    if (tableId) this.store.moveTable(tableId, targetTableId, dropPosition(event));
    this.finishReorder();
  }

  protected startColumnReorder(event: DragEvent, tableId: string, columnId: string): void {
    event.stopPropagation();
    this.draggedColumn.set({ tableId, columnId });
    event.dataTransfer?.setData('text/plain', columnId);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
  }

  protected dropColumn(event: DragEvent, tableId: string, targetColumnId: string): void {
    event.preventDefault();
    event.stopPropagation();
    const dragged = this.draggedColumn();
    if (dragged?.tableId === tableId) {
      this.store.moveColumn(tableId, dragged.columnId, targetColumnId, dropPosition(event));
    }
    this.finishReorder();
  }

  protected finishReorder(): void {
    this.draggedTableId.set(null);
    this.draggedColumn.set(null);
    this.tableDropTargetId.set(null);
    this.columnDropTargetId.set(null);
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

  protected updateColumnNote(tableId: string, columnId: string, event: Event): void {
    const note = inputValue(event).trim();
    this.store.updateColumn(tableId, columnId, { note: note || undefined });
  }

  protected updateTableNote(tableId: string, event: Event): void {
    this.store.updateTableNote(tableId, inputValue(event));
  }

  protected updateColumnFlag(
    tableId: string,
    columnId: string,
    property: 'primaryKey' | 'unique' | 'increment',
    event: Event,
  ): void {
    this.store.updateColumn(tableId, columnId, { [property]: checkboxValue(event) });
  }

  protected canAutoIncrement(type: string): boolean {
    return supportsAutoIncrement(type);
  }

  protected updateNotNull(tableId: string, columnId: string, event: Event): void {
    this.store.updateColumn(tableId, columnId, { nullable: !checkboxValue(event) });
  }

  protected toggleColumnFlag(
    tableId: string,
    columnId: string,
    property: 'primaryKey' | 'nullable',
    current: boolean,
  ): void {
    this.store.updateColumn(tableId, columnId, { [property]: !current });
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

  @HostListener('document:pointerdown', ['$event'])
  protected closeFloatingMenus(event: PointerEvent): void {
    const target = event.target as Element | null;
    if (!target?.closest('.auto-layout-control')) this.autoLayoutMenu.set(false);
    if (!target?.closest('.table-menu, .managed-table-header .more')) {
      this.tableMenuId.set(null);
    }
    if (!target?.closest('.column-menu, .managed-column > .more')) {
      this.columnMenuId.set(null);
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

function dropPosition(event: DragEvent): 'before' | 'after' {
  const bounds = (event.currentTarget as HTMLElement).getBoundingClientRect();
  return event.clientY < bounds.top + bounds.height / 2 ? 'before' : 'after';
}
