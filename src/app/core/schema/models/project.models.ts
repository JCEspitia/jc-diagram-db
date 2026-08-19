import { DatabaseSchema, EntityId } from './schema.models';

export interface DiagramLayout {
  tables: Record<EntityId, TableLayout>;
  viewport: ViewportState;
}

export interface TableLayout {
  x: number;
  y: number;
  width?: number;
  collapsed?: boolean;
}

export interface ViewportState {
  x: number;
  y: number;
  zoom: number;
}

export interface DiagramProject {
  format: 'diagramdb';
  formatVersion: 1;
  id: EntityId;
  name: string;
  schema: DatabaseSchema;
  layout: DiagramLayout;
  dbml: string;
  createdAt: string;
  updatedAt: string;
}

export interface DiagramSelection {
  tableId?: EntityId;
  columnId?: EntityId;
  relationshipId?: EntityId;
}
