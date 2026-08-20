import {
  DiagramAreaLayout,
  DiagramDetailLevel,
  EntityId,
  RelationshipLayout,
  TableLayout,
  ViewportState,
} from '../../schema';

export type DiagramOperation =
  | { type: 'CHANGE_DETAIL_LEVEL'; from: DiagramDetailLevel; to: DiagramDetailLevel }
  | { type: 'MOVE_TABLE'; tableId: EntityId; from: TableLayout; to: TableLayout }
  | { type: 'RESIZE_TABLE'; tableId: EntityId; from: TableLayout; to: TableLayout }
  | {
      type: 'CHANGE_RELATIONSHIP_ROUTE';
      relationshipId: EntityId;
      from?: RelationshipLayout;
      to: RelationshipLayout;
    }
  | { type: 'CHANGE_VIEWPORT'; from: ViewportState; to: ViewportState }
  | { type: 'ADD_AREA'; areaId: EntityId; area: DiagramAreaLayout }
  | { type: 'UPDATE_AREA'; areaId: EntityId; from: DiagramAreaLayout; to: DiagramAreaLayout }
  | {
      type: 'MOVE_AREA';
      areaId: EntityId;
      from: DiagramAreaLayout;
      to: DiagramAreaLayout;
      tables: { tableId: EntityId; from: TableLayout; to: TableLayout }[];
    }
  | { type: 'RESIZE_AREA'; areaId: EntityId; from: DiagramAreaLayout; to: DiagramAreaLayout }
  | { type: 'DELETE_AREA'; areaId: EntityId; area: DiagramAreaLayout };
