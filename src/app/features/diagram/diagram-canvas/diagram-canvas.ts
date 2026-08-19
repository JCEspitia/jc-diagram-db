import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import {
  columnAnchor,
  relationshipPath,
  tableLayout,
} from '../../../core/diagram/diagram-geometry';
import { DatabaseSchema, DiagramLayout, RelationshipSchema } from '../../../core/schema';
import { TableNode } from '../table-node/table-node';

interface RenderedRelationship {
  relationship: RelationshipSchema;
  path: string;
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

  protected readonly transform = computed(() => {
    const viewport = this.layout().viewport;
    return `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`;
  });

  protected readonly edges = computed<RenderedRelationship[]>(() =>
    this.schema().relationships.flatMap((relationship) => {
      const sourceTable = this.schema().tables.find(({ id }) => id === relationship.sourceTableId);
      const targetTable = this.schema().tables.find(({ id }) => id === relationship.targetTableId);
      const sourceIndex =
        sourceTable?.columns.findIndex(({ id }) => id === relationship.sourceColumnId) ?? -1;
      const targetIndex =
        targetTable?.columns.findIndex(({ id }) => id === relationship.targetColumnId) ?? -1;
      if (!sourceTable || !targetTable || sourceIndex < 0 || targetIndex < 0) return [];
      const sourceLayout = tableLayout(this.layout(), sourceTable.id);
      const targetLayout = tableLayout(this.layout(), targetTable.id);
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

  protected tablePosition(tableId: string) {
    return tableLayout(this.layout(), tableId);
  }
}
