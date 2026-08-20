import { DatabaseSchema, EntityId } from './schema.models';

export interface DiagramLayout {
  tables: Record<EntityId, TableLayout>;
  relationships?: Record<EntityId, RelationshipLayout>;
  areas?: Record<EntityId, DiagramAreaLayout>;
  viewport: ViewportState;
}

export interface DiagramAreaLayout {
  name: string;
  note?: string;
  color: string;
  x: number;
  y: number;
  width: number;
  height: number;
  tableIds?: EntityId[];
  collapsed?: boolean;
}

export interface RelationshipLayout {
  routeX?: number;
  sourceX?: number;
  targetX?: number;
  routeY?: number;
  waypoints?: { x: number; y: number }[];
  sourceSide?: 'left' | 'right';
  targetSide?: 'left' | 'right';
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
