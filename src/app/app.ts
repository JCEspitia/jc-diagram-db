import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import {
  DiagramDetailLevel,
  ReferentialAction,
  RelationshipSchema,
  TableSchema,
} from './core/schema';
import { AutoLayoutMode } from './core/diagram/auto-layout/auto-layout';
import { checkExpressionError } from './core/schema/validation/check-expression.validator';
import { DiagramCanvas } from './features/diagram/diagram-canvas/diagram-canvas';
import { DbmlEditor } from './features/editor/dbml-editor/dbml-editor';
import { ExportMenu } from './features/export/export-menu/export-menu';
import { ProjectBrowser } from './features/projects/project-browser/project-browser';
import { DiagramStore, supportsAutoIncrement } from './state/diagram.store';
import { TooltipDirective } from './shared/tooltip/tooltip.directive';
import { DEFAULT_TABLE_COLOR, TABLE_COLORS } from './shared/table-colors';
import { PwaService } from './core/pwa/pwa.service';
import {
  LucideChevronRight,
  LucideCheck,
  LucideBraces,
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
    ExportMenu,
    ProjectBrowser,
    LucideChevronRight,
    LucideCheck,
    LucideBraces,
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
  protected readonly pwa = inject(PwaService);
  protected readonly tableColors = TABLE_COLORS;
  protected readonly defaultTableColor = DEFAULT_TABLE_COLOR;
  private readonly canvas = viewChild(DiagramCanvas);
  protected readonly dbmlCollapsed = signal(false);
  protected readonly projectBrowserOpen = signal(false);
  protected readonly activeSidebar = signal<'dbml' | 'inspector' | 'enums' | 'areas'>('dbml');
  protected readonly tableFilter = signal('');
  protected readonly expandedTableIds = signal<Set<string>>(new Set());
  protected readonly expandedEnumId = signal<string | null>(null);
  protected readonly expandedAreaId = signal<string | null>(null);
  protected readonly tableMenuId = signal<string | null>(null);
  protected readonly columnMenuId = signal<string | null>(null);
  protected readonly editingTableId = signal<string | null>(null);
  protected readonly draggedTableId = signal<string | null>(null);
  protected readonly draggedColumn = signal<{ tableId: string; columnId: string } | null>(null);
  protected readonly tableDropTargetId = signal<string | null>(null);
  protected readonly columnDropTargetId = signal<string | null>(null);
  protected readonly relationshipMode = signal(false);
  protected readonly autoLayoutMenu = signal(false);
  protected readonly detailLevelMenu = signal(false);
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

  protected createManagedEnum(): void {
    this.expandedEnumId.set(this.store.createEnum());
  }

  protected createManagedArea(): void {
    const areaId = this.store.createArea();
    this.expandedAreaId.set(areaId);
    requestAnimationFrame(() => this.canvas()?.focusArea(areaId));
  }

  protected areaEntries() {
    return Object.entries(this.store.layout().areas ?? {});
  }

  protected tablesForArea(areaId: string): TableSchema[] {
    const ids = new Set(this.canvas()?.tableIdsInArea(areaId) ?? []);
    return this.store.schema().tables.filter(({ id }) => ids.has(id));
  }

  protected updateAreaName(areaId: string, event: Event): void {
    const name = inputValue(event).trim();
    if (name) this.store.updateArea(areaId, { name });
  }

  protected focusArea(areaId: string): void {
    requestAnimationFrame(() => this.canvas()?.focusArea(areaId));
  }

  protected editManagedArea(areaId: string): void {
    this.activeSidebar.set('areas');
    this.dbmlCollapsed.set(false);
    this.expandedAreaId.set(areaId);
    this.focusArea(areaId);
  }

  protected updateAreaNote(areaId: string, event: Event): void {
    const note = inputValue(event).trim();
    this.store.updateArea(areaId, { note: note || undefined });
  }

  protected assignTableFromAreaPanel(areaId: string, event: Event): void {
    const tableId = inputValue(event);
    if (!tableId) return;
    this.store.assignTableToArea(tableId, areaId);
    (event.target as HTMLSelectElement).value = '';
  }

  protected renameEnum(enumId: string, event: Event): void {
    this.store.renameEnum(enumId, inputValue(event));
  }

  protected updateEnumValue(enumId: string, index: number, event: Event): void {
    this.store.updateEnumValue(enumId, index, inputValue(event));
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

  protected updateColumnDefault(tableId: string, columnId: string, event: Event): void {
    const defaultValue = inputValue(event).trim();
    this.store.updateColumn(tableId, columnId, {
      defaultValue: defaultValue || undefined,
    });
  }

  protected selectedEnum(type: string): string {
    const normalized = type.replace(/\[\]$/, '').split('.').at(-1)?.replaceAll('"', '');
    return (
      this.store
        .schema()
        .enums.find(({ name }) => name.toLocaleLowerCase() === normalized?.toLocaleLowerCase())
        ?.name ?? ''
    );
  }

  protected updateColumnEnum(
    tableId: string,
    columnId: string,
    currentType: string,
    event: Event,
  ): void {
    const enumName = inputValue(event);
    if (enumName) this.store.updateColumn(tableId, columnId, { type: enumName });
    else if (this.selectedEnum(currentType)) {
      this.store.updateColumn(tableId, columnId, { type: 'varchar' });
    }
  }

  protected updateTableNote(tableId: string, event: Event): void {
    this.store.updateTableNote(tableId, inputValue(event));
  }

  protected updateTableCheck(tableId: string, checkId: string, event: Event): void {
    this.store.updateTableCheck(tableId, checkId, inputValue(event));
  }

  protected checkError(expression: string): string | null {
    return checkExpressionError(expression);
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

  protected setDetailLevel(level: DiagramDetailLevel): void {
    this.store.setDetailLevel(level);
    this.detailLevelMenu.set(false);
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
    if (!target?.closest('.detail-level-control')) this.detailLevelMenu.set(false);
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
