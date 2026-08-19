import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { RelationshipSchema, TableLayout, TableSchema } from '../../../core/schema';

@Component({
  selector: 'app-table-node',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './table-node.html',
  styleUrl: './table-node.scss',
  host: {
    '[style.left.px]': 'layout().x',
    '[style.top.px]': 'layout().y',
    '[class.selected]': 'selected()',
  },
})
export class TableNode {
  readonly table = input.required<TableSchema>();
  readonly layout = input.required<TableLayout>();
  readonly relationships = input<RelationshipSchema[]>([]);
  readonly selected = input(false);
  readonly tableSelected = output<string>();
  readonly dragStarted = output<{ tableId: string; event: PointerEvent }>();

  protected readonly foreignKeyColumnIds = computed(() => {
    const tableId = this.table().id;
    return new Set(
      this.relationships()
        .filter(({ sourceTableId }) => sourceTableId === tableId)
        .map(({ sourceColumnId }) => sourceColumnId),
    );
  });

  protected select(): void {
    this.tableSelected.emit(this.table().id);
  }

  protected startDrag(event: PointerEvent): void {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    this.dragStarted.emit({ tableId: this.table().id, event });
  }
}
