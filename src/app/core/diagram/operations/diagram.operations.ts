import { EntityId, TableLayout, ViewportState } from '../../schema';

export type DiagramOperation =
  | { type: 'MOVE_TABLE'; tableId: EntityId; from: TableLayout; to: TableLayout }
  | { type: 'RESIZE_TABLE'; tableId: EntityId; from: TableLayout; to: TableLayout }
  | { type: 'CHANGE_VIEWPORT'; from: ViewportState; to: ViewportState };
