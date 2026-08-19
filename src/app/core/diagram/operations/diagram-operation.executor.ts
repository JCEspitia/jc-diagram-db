import { DiagramLayout } from '../../schema';
import { DiagramOperation } from './diagram.operations';

export function executeDiagramOperation(
  layout: DiagramLayout,
  operation: DiagramOperation,
): DiagramLayout {
  switch (operation.type) {
    case 'MOVE_TABLE':
    case 'RESIZE_TABLE':
      return {
        ...layout,
        tables: { ...layout.tables, [operation.tableId]: operation.to },
      };
    case 'CHANGE_VIEWPORT':
      return { ...layout, viewport: operation.to };
    case 'CHANGE_RELATIONSHIP_ROUTE':
      return {
        ...layout,
        relationships: {
          ...layout.relationships,
          [operation.relationshipId]: operation.to,
        },
      };
  }
}
