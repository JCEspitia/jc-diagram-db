import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
  computed,
  input,
  output,
  signal,
} from '@angular/core';
import {
  ColumnSchema,
  EnumSchema,
  RelationshipSchema,
  TableLayout,
  TableSchema,
} from '../../../core/schema';
import { TooltipDetails, TooltipDirective } from '../../../shared/tooltip/tooltip.directive';
import { DEFAULT_TABLE_COLOR, TABLE_COLORS } from '../../../shared/table-colors';
import {
  LucideEllipsis,
  LucideFingerprint,
  LucideKeyRound,
  LucideLink2,
  LucideMessageSquareText,
  LucideTable2,
} from '@lucide/angular';

@Component({
  selector: 'app-table-node',
  imports: [
    LucideEllipsis,
    LucideFingerprint,
    LucideKeyRound,
    LucideLink2,
    LucideMessageSquareText,
    LucideTable2,
    TooltipDirective,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './table-node.html',
  styleUrl: './table-node.scss',
  host: {
    '[style.left.px]': 'layout().x',
    '[style.top.px]': 'layout().y',
    '[class.selected]': 'selected()',
    '[class.show-relationship-handles]': 'showRelationshipHandles()',
  },
})
export class TableNode {
  readonly table = input.required<TableSchema>();
  readonly layout = input.required<TableLayout>();
  readonly relationships = input<RelationshipSchema[]>([]);
  readonly enums = input<EnumSchema[]>([]);
  readonly selected = input(false);
  readonly selectedColumnId = input<string>();
  readonly relationshipTargetColumnId = input<string>();
  readonly showRelationshipHandles = input(false);
  readonly tableSelected = output<string>();
  readonly tableEditRequested = output<string>();
  readonly tableColorChanged = output<{ tableId: string; color: string }>();
  readonly columnSelected = output<{ tableId: string; columnId: string }>();
  readonly columnHovered = output<{ tableId: string; columnId: string } | null>();
  readonly relationshipStarted = output<{
    tableId: string;
    columnId: string;
    sourceSide: 'left' | 'right';
    event: PointerEvent;
  }>();
  readonly dragStarted = output<{ tableId: string; event: PointerEvent }>();
  protected readonly optionsOpen = signal(false);
  protected readonly tableColors = TABLE_COLORS;
  protected readonly defaultTableColor = DEFAULT_TABLE_COLOR;

  protected readonly foreignKeyColumnIds = computed(() => {
    const tableId = this.table().id;
    const columnIds = new Set<string>();
    for (const relationship of this.relationships()) {
      const sourceCardinality =
        relationship.sourceCardinality ?? (relationship.type === 'many-to-one' ? 'many' : 'one');
      const targetCardinality =
        relationship.targetCardinality ?? (relationship.type === 'one-to-many' ? 'many' : 'one');
      const sourceIsForeignKey =
        sourceCardinality === 'many' ||
        (targetCardinality !== 'many' && sourceCardinality === 'zero') ||
        (sourceCardinality === 'one' && targetCardinality === 'one');
      const targetIsForeignKey =
        targetCardinality === 'many' ||
        (sourceCardinality !== 'many' && targetCardinality === 'zero');
      if (sourceIsForeignKey && relationship.sourceTableId === tableId) {
        columnIds.add(relationship.sourceColumnId);
      }
      if (targetIsForeignKey && relationship.targetTableId === tableId) {
        columnIds.add(relationship.targetColumnId);
      }
    }
    return columnIds;
  });

  protected select(): void {
    this.tableSelected.emit(this.table().id);
  }

  protected toggleOptions(event: PointerEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.optionsOpen.update((open) => !open);
  }

  protected editTable(event: PointerEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.optionsOpen.set(false);
    this.tableEditRequested.emit(this.table().id);
  }

  protected changeColor(event: PointerEvent, color: string): void {
    event.preventDefault();
    event.stopPropagation();
    this.tableColorChanged.emit({ tableId: this.table().id, color });
  }

  protected columnTooltip(column: ColumnSchema): TooltipDetails {
    const enumType = column.type.replace(/\[\]$/, '').split('.').at(-1)?.replaceAll('"', '');
    const enumSchema = this.enums().find(
      ({ name }) => name.toLocaleLowerCase() === enumType?.toLocaleLowerCase(),
    );
    return {
      title: column.name,
      type: column.type,
      ...(column.note ? { comment: column.note } : {}),
      ...(column.defaultValue !== undefined ? { defaultValue: column.defaultValue } : {}),
      ...(enumSchema ? { enumName: enumSchema.name, enumValues: enumSchema.values } : {}),
    };
  }

  @HostListener('document:pointerdown', ['$event'])
  protected closeOptions(event: PointerEvent): void {
    if (!(event.target as Element | null)?.closest('app-table-node .table-options')) {
      this.optionsOpen.set(false);
    }
  }

  protected startDrag(event: PointerEvent): void {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    this.dragStarted.emit({ tableId: this.table().id, event });
  }

  protected selectColumn(event: PointerEvent, columnId: string): void {
    event.stopPropagation();
    this.columnSelected.emit({ tableId: this.table().id, columnId });
  }

  protected interactWithColumn(event: PointerEvent, columnId: string): void {
    if (this.showRelationshipHandles()) this.startRelationship(event, columnId);
    else this.selectColumn(event, columnId);
  }

  protected hoverColumn(columnId: string): void {
    this.columnHovered.emit({ tableId: this.table().id, columnId });
  }

  protected startRelationship(event: PointerEvent, columnId: string): void {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const row = (event.target as Element).closest<HTMLElement>('.column-row');
    const bounds = row?.getBoundingClientRect();
    const sourceSide = bounds && event.clientX < bounds.left + bounds.width / 2 ? 'left' : 'right';
    this.relationshipStarted.emit({
      tableId: this.table().id,
      columnId,
      sourceSide,
      event,
    });
  }
}
