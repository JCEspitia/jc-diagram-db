import {
  ColumnSchema,
  EntityId,
  EnumSchema,
  RelationshipSchema,
  TableSchema,
} from '../models/schema.models';

export type SchemaOperation =
  | { type: 'ADD_TABLE'; table: TableSchema }
  | {
      type: 'UPDATE_TABLE';
      tableId: EntityId;
      changes: Partial<Omit<TableSchema, 'id' | 'columns'>>;
    }
  | { type: 'DELETE_TABLE'; tableId: EntityId }
  | {
      type: 'MOVE_TABLE';
      tableId: EntityId;
      targetTableId: EntityId;
      position: 'before' | 'after';
    }
  | { type: 'ADD_COLUMN'; tableId: EntityId; column: ColumnSchema }
  | {
      type: 'UPDATE_COLUMN';
      tableId: EntityId;
      columnId: EntityId;
      changes: Partial<Omit<ColumnSchema, 'id'>>;
    }
  | { type: 'DELETE_COLUMN'; tableId: EntityId; columnId: EntityId }
  | {
      type: 'MOVE_COLUMN';
      tableId: EntityId;
      columnId: EntityId;
      targetColumnId: EntityId;
      position: 'before' | 'after';
    }
  | { type: 'ADD_RELATIONSHIP'; relationship: RelationshipSchema }
  | {
      type: 'UPDATE_RELATIONSHIP';
      relationshipId: EntityId;
      changes: Partial<Omit<RelationshipSchema, 'id'>>;
    }
  | { type: 'DELETE_RELATIONSHIP'; relationshipId: EntityId }
  | { type: 'ADD_ENUM'; enumSchema: EnumSchema }
  | { type: 'UPDATE_ENUM'; enumId: EntityId; changes: Partial<Omit<EnumSchema, 'id'>> }
  | { type: 'DELETE_ENUM'; enumId: EntityId };

export class SchemaOperationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SchemaOperationError';
  }
}
