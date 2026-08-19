export type EntityId = string;

export type ReferentialAction = 'NO ACTION' | 'RESTRICT' | 'CASCADE' | 'SET NULL' | 'SET DEFAULT';

export interface DatabaseSchema {
  id: EntityId;
  name: string;
  tables: TableSchema[];
  relationships: RelationshipSchema[];
  enums: EnumSchema[];
}

export interface TableSchema {
  id: EntityId;
  name: string;
  schema?: string;
  columns: ColumnSchema[];
  indexes: IndexSchema[];
  note?: string;
}

export interface ColumnSchema {
  id: EntityId;
  name: string;
  type: string;
  primaryKey: boolean;
  nullable: boolean;
  unique: boolean;
  increment: boolean;
  defaultValue?: string;
  note?: string;
}

export interface RelationshipSchema {
  id: EntityId;
  sourceTableId: EntityId;
  sourceColumnId: EntityId;
  targetTableId: EntityId;
  targetColumnId: EntityId;
  type: 'one-to-one' | 'one-to-many' | 'many-to-one';
  onDelete?: ReferentialAction;
  onUpdate?: ReferentialAction;
}

export interface EnumSchema {
  id: EntityId;
  name: string;
  values: string[];
}

export interface IndexSchema {
  id: EntityId;
  columns: EntityId[];
  unique?: boolean;
  primaryKey?: boolean;
  name?: string;
}
