import { DiagramLayout } from '../../schema';
import { DiagramOperation } from './diagram.operations';

export function executeDiagramOperation(
  layout: DiagramLayout,
  operation: DiagramOperation,
): DiagramLayout {
  switch (operation.type) {
    case 'CHANGE_DETAIL_LEVEL':
      return { ...layout, detailLevel: operation.to };
    case 'MOVE_TABLE':
    case 'RESIZE_TABLE':
      return {
        ...layout,
        tables: { ...layout.tables, [operation.tableId]: operation.to },
      };
    case 'MOVE_TABLES':
      return {
        ...layout,
        tables: {
          ...layout.tables,
          ...Object.fromEntries(operation.tables.map(({ tableId, to }) => [tableId, to])),
        },
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
    case 'ADD_AREA':
      return { ...layout, areas: { ...layout.areas, [operation.areaId]: operation.area } };
    case 'UPDATE_AREA':
    case 'RESIZE_AREA':
      return { ...layout, areas: { ...layout.areas, [operation.areaId]: operation.to } };
    case 'MOVE_AREA':
      return {
        ...layout,
        areas: { ...layout.areas, [operation.areaId]: operation.to },
        tables: {
          ...layout.tables,
          ...Object.fromEntries(operation.tables.map(({ tableId, to }) => [tableId, to])),
        },
      };
    case 'DELETE_AREA': {
      const areas = { ...layout.areas };
      delete areas[operation.areaId];
      return { ...layout, areas };
    }
  }
}
