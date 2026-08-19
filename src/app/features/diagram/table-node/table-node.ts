import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RelationshipSchema, TableLayout, TableSchema } from '../../../core/schema';

@Component({
  selector: 'app-table-node',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './table-node.html',
  styleUrl: './table-node.scss',
  host: { '[style.left.px]': 'layout().x', '[style.top.px]': 'layout().y' },
})
export class TableNode {
  readonly table = input.required<TableSchema>();
  readonly layout = input.required<TableLayout>();
  readonly relationships = input<RelationshipSchema[]>([]);

  protected readonly foreignKeyColumnIds = computed(() => {
    const tableId = this.table().id;
    return new Set(
      this.relationships()
        .filter(({ sourceTableId }) => sourceTableId === tableId)
        .map(({ sourceColumnId }) => sourceColumnId),
    );
  });
}
