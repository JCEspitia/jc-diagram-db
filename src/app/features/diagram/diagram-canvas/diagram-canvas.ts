import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import {
  columnAnchor,
  fitToScreen,
  relationshipPath,
  screenToWorld,
  tableLayout,
  zoomAtPoint,
} from '../../../core/diagram/diagram-geometry';
import { DiagramOperation } from '../../../core/diagram/operations/diagram.operations';
import {
  DatabaseSchema,
  DiagramLayout,
  RelationshipSchema,
  TableLayout,
  ViewportState,
} from '../../../core/schema';
import { TableNode } from '../table-node/table-node';

interface RenderedRelationship {
  relationship: RelationshipSchema;
  path: string;
}

interface RelationshipEndpoint {
  tableId: string;
  columnId: string;
}

@Component({
  selector: 'app-diagram-canvas',
  imports: [TableNode],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './diagram-canvas.html',
  styleUrl: './diagram-canvas.scss',
})
export class DiagramCanvas {
  readonly schema = input.required<DatabaseSchema>();
  readonly layout = input.required<DiagramLayout>();
  readonly selectedTableId = input<string>();
  readonly selectedColumnId = input<string>();
  readonly selectedRelationshipId = input<string>();
  readonly relationshipMode = input(false);
  readonly diagramOperation = output<DiagramOperation>();
  readonly tableSelected = output<string>();
  readonly columnSelected = output<{ tableId: string; columnId: string }>();
  readonly relationshipSelected = output<string>();
  readonly relationshipCreated = output<{
    sourceTableId: string;
    sourceColumnId: string;
    targetTableId: string;
    targetColumnId: string;
  }>();
  readonly selectionCleared = output<void>();

  private interaction:
    | {
        kind: 'table';
        pointerId: number;
        tableId: string;
        startX: number;
        startY: number;
        from: TableLayout;
      }
    | { kind: 'pan'; pointerId: number; startX: number; startY: number; from: ViewportState }
    | {
        kind: 'relationship';
        pointerId: number;
        source: RelationshipEndpoint;
      }
    | undefined;
  private readonly tablePreview = signal<{ tableId: string; layout: TableLayout } | null>(null);
  private readonly viewportPreview = signal<ViewportState | null>(null);
  protected readonly relationshipTarget = signal<RelationshipEndpoint | null>(null);
  private readonly temporaryRelationship = signal<{
    source: { x: number; y: number };
    cursor: { x: number; y: number };
  } | null>(null);
  private readonly viewportElement = viewChild.required<ElementRef<HTMLElement>>('viewport');

  protected readonly transform = computed(() => {
    const viewport = this.viewportPreview() ?? this.layout().viewport;
    return `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`;
  });

  protected readonly edges = computed<RenderedRelationship[]>(() =>
    this.schema().relationships.flatMap((relationship) => {
      const preview = this.tablePreview();
      const sourceTable = this.schema().tables.find(({ id }) => id === relationship.sourceTableId);
      const targetTable = this.schema().tables.find(({ id }) => id === relationship.targetTableId);
      const sourceIndex =
        sourceTable?.columns.findIndex(({ id }) => id === relationship.sourceColumnId) ?? -1;
      const targetIndex =
        targetTable?.columns.findIndex(({ id }) => id === relationship.targetColumnId) ?? -1;
      if (!sourceTable || !targetTable || sourceIndex < 0 || targetIndex < 0) return [];
      const sourceLayout =
        preview?.tableId === sourceTable.id
          ? preview.layout
          : tableLayout(this.layout(), sourceTable.id);
      const targetLayout =
        preview?.tableId === targetTable.id
          ? preview.layout
          : tableLayout(this.layout(), targetTable.id);
      const sourceOnLeft = sourceLayout.x > targetLayout.x;
      return [
        {
          relationship,
          path: relationshipPath(
            columnAnchor(sourceLayout, sourceIndex, sourceOnLeft ? 'left' : 'right'),
            columnAnchor(targetLayout, targetIndex, sourceOnLeft ? 'right' : 'left'),
          ),
        },
      ];
    }),
  );

  protected readonly temporaryPath = computed(() => {
    const temporary = this.temporaryRelationship();
    return temporary ? relationshipPath(temporary.source, temporary.cursor) : null;
  });

  protected tablePosition(tableId: string) {
    const preview = this.tablePreview();
    return preview?.tableId === tableId ? preview.layout : tableLayout(this.layout(), tableId);
  }

  protected startTableDrag({ tableId, event }: { tableId: string; event: PointerEvent }): void {
    this.tableSelected.emit(tableId);
    this.interaction = {
      kind: 'table',
      pointerId: event.pointerId,
      tableId,
      startX: event.clientX,
      startY: event.clientY,
      from: tableLayout(this.layout(), tableId),
    };
    (event.target as Element).setPointerCapture(event.pointerId);
  }

  protected startPan(event: PointerEvent): void {
    if (event.button !== 0 && event.button !== 1) return;
    if ((event.target as Element).closest('app-table-node')) return;
    event.preventDefault();
    if (event.button === 0) this.selectionCleared.emit();
    this.interaction = {
      kind: 'pan',
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      from: this.layout().viewport,
    };
    (event.currentTarget as Element).setPointerCapture(event.pointerId);
  }

  protected startRelationship({
    tableId,
    columnId,
    event,
  }: {
    tableId: string;
    columnId: string;
    event: PointerEvent;
  }): void {
    const table = this.schema().tables.find(({ id }) => id === tableId);
    const columnIndex = table?.columns.findIndex(({ id }) => id === columnId) ?? -1;
    if (!table || columnIndex < 0) return;
    const source = columnAnchor(tableLayout(this.layout(), tableId), columnIndex, 'right');
    this.interaction = {
      kind: 'relationship',
      pointerId: event.pointerId,
      source: { tableId, columnId },
    };
    this.temporaryRelationship.set({ source, cursor: source });
    (event.target as Element).setPointerCapture(event.pointerId);
  }

  protected movePointer(event: PointerEvent): void {
    const interaction = this.interaction;
    if (!interaction || interaction.pointerId !== event.pointerId) return;
    if (interaction.kind === 'table') {
      const deltaX = event.clientX - interaction.startX;
      const deltaY = event.clientY - interaction.startY;
      const zoom = this.layout().viewport.zoom;
      this.tablePreview.set({
        tableId: interaction.tableId,
        layout: {
          ...interaction.from,
          x: interaction.from.x + deltaX / zoom,
          y: interaction.from.y + deltaY / zoom,
        },
      });
    } else if (interaction.kind === 'pan') {
      const deltaX = event.clientX - interaction.startX;
      const deltaY = event.clientY - interaction.startY;
      this.viewportPreview.set({
        ...interaction.from,
        x: interaction.from.x + deltaX,
        y: interaction.from.y + deltaY,
      });
    } else {
      const bounds = this.viewportElement().nativeElement.getBoundingClientRect();
      const cursor = screenToWorld(
        { x: event.clientX - bounds.left, y: event.clientY - bounds.top },
        this.layout().viewport,
      );
      const current = this.temporaryRelationship();
      if (current) this.temporaryRelationship.set({ ...current, cursor });
      this.relationshipTarget.set(
        this.endpointAt(event.clientX, event.clientY, interaction.source),
      );
    }
  }

  protected endPointer(event: PointerEvent): void {
    const interaction = this.interaction;
    if (!interaction || interaction.pointerId !== event.pointerId) return;
    if (interaction.kind === 'table') {
      const preview = this.tablePreview();
      if (preview)
        this.diagramOperation.emit({
          type: 'MOVE_TABLE',
          tableId: interaction.tableId,
          from: interaction.from,
          to: preview.layout,
        });
      this.tablePreview.set(null);
    } else if (interaction.kind === 'pan') {
      const preview = this.viewportPreview();
      if (preview)
        this.diagramOperation.emit({
          type: 'CHANGE_VIEWPORT',
          from: interaction.from,
          to: preview,
        });
      this.viewportPreview.set(null);
    } else {
      const target = this.relationshipTarget();
      if (target) {
        this.relationshipCreated.emit({
          sourceTableId: interaction.source.tableId,
          sourceColumnId: interaction.source.columnId,
          targetTableId: target.tableId,
          targetColumnId: target.columnId,
        });
      }
      this.clearTemporaryRelationship();
    }
    this.interaction = undefined;
  }

  protected cancelPointer(event: PointerEvent): void {
    if (this.interaction?.pointerId !== event.pointerId) return;
    this.tablePreview.set(null);
    this.viewportPreview.set(null);
    this.clearTemporaryRelationship();
    this.interaction = undefined;
  }

  protected zoom(event: WheelEvent): void {
    event.preventDefault();
    const element = event.currentTarget as HTMLElement;
    const bounds = element.getBoundingClientRect();
    const viewport = this.layout().viewport;
    const factor = Math.exp(-event.deltaY * 0.0015);
    const to = zoomAtPoint(
      viewport,
      { x: event.clientX - bounds.left, y: event.clientY - bounds.top },
      viewport.zoom * factor,
    );
    this.diagramOperation.emit({ type: 'CHANGE_VIEWPORT', from: viewport, to });
  }

  protected selectRelationship(event: PointerEvent, relationshipId: string): void {
    event.stopPropagation();
    this.relationshipSelected.emit(relationshipId);
  }

  fitDiagram(): void {
    const element = this.viewportElement().nativeElement;
    const from = this.layout().viewport;
    const to = fitToScreen(this.schema(), this.layout(), {
      width: element.clientWidth,
      height: element.clientHeight,
    });
    this.diagramOperation.emit({ type: 'CHANGE_VIEWPORT', from, to });
  }

  private endpointAt(
    clientX: number,
    clientY: number,
    source: RelationshipEndpoint,
  ): RelationshipEndpoint | null {
    const row = document
      .elementFromPoint(clientX, clientY)
      ?.closest<HTMLElement>('[data-table-id][data-column-id]');
    const tableId = row?.dataset['tableId'];
    const columnId = row?.dataset['columnId'];
    if (!tableId || !columnId || (tableId === source.tableId && columnId === source.columnId)) {
      return null;
    }
    return { tableId, columnId };
  }

  private clearTemporaryRelationship(): void {
    this.temporaryRelationship.set(null);
    this.relationshipTarget.set(null);
  }
}
