# Contexto de desarrollo — DiagramDB

## 1. Descripción del proyecto

Construir una aplicación web llamada **DiagramDB**, inspirada en herramientas como dbdiagram.io, enfocada en diseñar esquemas de bases de datos relacionales de forma visual y mediante código DBML.

La aplicación debe funcionar completamente en el navegador usando Angular.

No habrá backend en la primera versión.

El usuario podrá:

* escribir DBML;
* visualizar automáticamente las tablas y relaciones;
* mover tablas dentro de un canvas;
* crear relaciones arrastrando entre columnas;
* editar tablas, columnas y relaciones;
* mantener sincronizados DBML y canvas;
* guardar proyectos localmente en el navegador;
* exportar proyectos;
* importar proyectos;
* trabajar sin conexión.

El núcleo técnico del producto es:

**DBML ⇄ Canonical Schema Model ⇄ Canvas**

Este flujo debe ser la principal prioridad del desarrollo.

---

# 2. Stack tecnológico

Usar:

* Angular
* TypeScript
* Angular Signals
* Monaco Editor
* HTML + SVG para el canvas
* IndexedDB para persistencia
* CSS/SCSS o Tailwind CSS para estilos
* Vitest/Jest + Angular Testing utilities para tests

Evitar:

* NestJS
* Node backend
* PostgreSQL
* Prisma
* Firebase
* Supabase
* autenticación
* infraestructura cloud

durante el MVP.

La aplicación debe poder compilarse como una SPA estática.

---

# 3. Filosofía de arquitectura

No usar DBML como estado principal de la aplicación.

No usar los componentes visuales del canvas como estado principal.

Debe existir un modelo canónico independiente.

Arquitectura:

```text
              ┌──────────────────┐
              │  Monaco Editor   │
              │      DBML        │
              └────────┬─────────┘
                       │
                     parse
                       │
                       ▼
              ┌──────────────────┐
              │                  │
              │ Canonical Schema │
              │      Model       │
              │                  │
              └───────┬──────────┘
                      │
          ┌───────────┼─────────────┐
          │           │             │
          ▼           ▼             ▼
       Canvas      Generator      Validator
                      │
                      ▼
                     DBML
```

Las modificaciones visuales también deben pasar por el modelo:

```text
Canvas interaction
       │
       ▼
Schema Operation
       │
       ▼
Canonical Schema
       │
       ├── Render Canvas
       │
       └── Generate DBML
```

Nunca modificar directamente Monaco desde componentes visuales sin pasar por el modelo.

---

# 4. Modelo canónico

Crear un módulo `schema-core` completamente independiente de Angular UI.

Modelo conceptual:

```ts
export interface DatabaseSchema {
  id: string;
  name: string;

  tables: TableSchema[];
  relationships: RelationshipSchema[];
  enums: EnumSchema[];
}
```

Tabla:

```ts
export interface TableSchema {
  id: string;

  name: string;
  schema?: string;

  columns: ColumnSchema[];
  indexes: IndexSchema[];

  note?: string;
}
```

Columna:

```ts
export interface ColumnSchema {
  id: string;

  name: string;
  type: string;

  primaryKey: boolean;
  nullable: boolean;
  unique: boolean;
  increment: boolean;

  defaultValue?: string;
  note?: string;
}
```

Relación:

```ts
export interface RelationshipSchema {
  id: string;

  sourceTableId: string;
  sourceColumnId: string;

  targetTableId: string;
  targetColumnId: string;

  type:
    | 'one-to-one'
    | 'one-to-many'
    | 'many-to-one';

  onDelete?: ReferentialAction;
  onUpdate?: ReferentialAction;
}
```

Enum:

```ts
export interface EnumSchema {
  id: string;
  name: string;
  values: string[];
}
```

Índices:

```ts
export interface IndexSchema {
  id: string;

  columns: string[];

  unique?: boolean;
  name?: string;
}
```

---

# 5. IDs internos

Todas las entidades deben tener IDs internos estables.

Nunca utilizar el nombre como identificador.

Ejemplo:

```ts
{
  id: 'tbl_01J...',
  name: 'users'
}
```

Debe ser posible cambiar:

```text
users
```

por:

```text
customers
```

sin perder:

* posición;
* relaciones;
* selección;
* metadatos visuales.

Usar UUID o ULID.

---

# 6. Layout del diagrama

El layout debe estar completamente separado del esquema.

Ejemplo:

```ts
export interface DiagramLayout {
  tables: Record<string, TableLayout>;

  viewport: ViewportState;
}
```

```ts
export interface TableLayout {
  x: number;
  y: number;

  width?: number;
  collapsed?: boolean;
}
```

```ts
export interface ViewportState {
  x: number;
  y: number;
  zoom: number;
}
```

`tables` debe utilizar `tableId` como key.

Ejemplo:

```ts
{
  tables: {
    "tbl_users": {
      x: 400,
      y: 280
    }
  }
}
```

Nunca guardar posiciones dentro de `TableSchema`.

---

# 7. Modelo de proyecto

Todo proyecto debe poder representarse con una única estructura serializable.

```ts
export interface DiagramProject {
  format: 'diagramdb';

  formatVersion: number;

  id: string;
  name: string;

  schema: DatabaseSchema;
  layout: DiagramLayout;

  dbml: string;

  createdAt: string;
  updatedAt: string;
}
```

El `formatVersion` permitirá hacer migraciones futuras.

Ejemplo:

```ts
formatVersion: 1
```

---

# 8. DBML

Crear una capa específica para trabajar con DBML.

No utilizar directamente una librería de DBML desde componentes Angular.

Crear interfaces:

```ts
export interface DbmlParser {
  parse(source: string): DbmlParseResult;
}
```

```ts
export interface DbmlGenerator {
  generate(schema: DatabaseSchema): string;
}
```

Resultado:

```ts
export interface DbmlParseResult {
  schema?: DatabaseSchema;

  errors: DbmlParseError[];
}
```

```ts
export interface DbmlParseError {
  message: string;

  line?: number;
  column?: number;
}
```

---

# 9. Reconciliación de DBML

Cuando el usuario edite DBML no reemplazar automáticamente todo el esquema perdiendo IDs.

Debe existir un proceso:

```text
DBML
  │
  ▼
Parse
  │
  ▼
ParsedSchema
  │
  ▼
SchemaReconciler
  │
  ▼
CanonicalSchema
```

`SchemaReconciler` debe intentar identificar elementos existentes.

Primera estrategia:

## Tablas

Comparar por:

1. nombre exacto;
2. schema + nombre;
3. similitud estructural en caso de rename.

## Columnas

Comparar por:

1. nombre;
2. tabla;
3. tipo;
4. propiedades.

Cuando sea posible conservar el ID antiguo.

Esto es importante para conservar el layout.

---

# 10. Manejo de errores DBML

Cuando el DBML tenga errores:

NO reemplazar el canvas actual.

Ejemplo:

```text
DBML válido
   │
   ▼
Canvas actualizado

Usuario escribe DBML inválido
   │
   ▼
Mostrar error

Canvas permanece con último schema válido
```

Mostrar diagnostics en Monaco cuando sea posible.

Ejemplo:

```text
Unexpected token
Line 14, Column 8
```

Cuando vuelva a ser válido, actualizar el schema.

---

# 11. Editor DBML

Usar Monaco Editor.

Debe soportar inicialmente:

* syntax highlighting;
* números de línea;
* búsqueda;
* undo/redo del editor;
* diagnostics;
* autoindent;
* dark/light theme;
* resize dinámico.

El parseo debe utilizar debounce.

Aproximadamente:

```text
250-400 ms
```

No parsear en cada evento de teclado sin debounce.

---

# 12. Canvas

Implementar el canvas utilizando:

* HTML para las tablas;
* SVG para las relaciones.

No utilizar `<canvas>` 2D como base inicial.

Arquitectura:

```text
DiagramViewport

├── RelationshipSvgLayer
│
│   ├── Edge
│   ├── Edge
│   └── Edge
│
└── TableHtmlLayer

    ├── TableNode
    ├── TableNode
    └── TableNode
```

Ambas capas deben compartir la misma transformación.

---

# 13. Sistema de coordenadas

El viewport debe tener:

```ts
interface Viewport {
  x: number;
  y: number;
  zoom: number;
}
```

Transformación conceptual:

```text
screenX = worldX * zoom + viewportX

screenY = worldY * zoom + viewportY
```

Crear utilidades para:

```ts
worldToScreen()

screenToWorld()
```

No repartir cálculos de coordenadas por diferentes componentes.

Crear un servicio/módulo específico.

---

# 14. Pan

El usuario debe poder desplazarse por el diagrama.

Soportar:

* mouse drag sobre canvas vacío;
* middle mouse;
* opcionalmente space + drag.

El movimiento de tablas NO debe activar pan.

---

# 15. Zoom

Soportar:

* mouse wheel;
* trackpad;
* botones;
* reset;
* fit-to-screen.

Rango sugerido:

```text
25% → 200%
```

El zoom mediante mouse debe mantener el punto del cursor como referencia.

---

# 16. Tabla visual

Ejemplo visual:

```text
┌──────────────────────────────┐
│ users                        │
├──────────────────────────────┤
│ 🔑 id        uuid            │
│    email     varchar         │
│    name      varchar         │
│    role_id   uuid            │
│    created   timestamp       │
└──────────────────────────────┘
```

Cada columna debe tener:

* nombre;
* tipo;
* indicador PK;
* indicador FK cuando aplique;
* indicadores básicos de constraints.

---

# 17. Drag de tablas

Las tablas deben poder moverse.

Flujo:

```text
pointerdown
    │
    ▼
start position
    │
    ▼
pointermove
    │
    ▼
visual translation
    │
    ▼
pointerup
    │
    ▼
update layout
```

No guardar en IndexedDB durante cada `pointermove`.

Guardar solamente al finalizar o mediante debounce.

---

# 18. Relaciones visuales

Las relaciones deben dibujarse mediante SVG.

Primera versión:

* Bézier curves.

Opcionalmente después:

* orthogonal routing.

Una relación conecta:

```text
source column
      │
      ▼
target column
```

El punto de conexión debe obtenerse de la posición real de la fila correspondiente.

---

# 19. Interaction handles

Cuando el usuario pase el mouse por una columna debe poder aparecer un handle.

Ejemplo:

```text
id        uuid      ●
email     varchar   ●
user_id   uuid      ●
```

El usuario podrá:

```text
user_id ●──────────────►● id
```

Crear relación mediante:

```text
pointerdown handle
       ↓
temporary edge
       ↓
pointermove
       ↓
hover valid target
       ↓
pointerup
       ↓
create relationship
```

---

# 20. Relación temporal

Mientras se crea una relación mostrar:

```text
source
   │
   └──────────── cursor
```

Esta relación temporal NO debe entrar todavía al Schema Model.

Solamente al realizar drop válido se crea la operación.

---

# 21. Selección

Debe existir estado de selección.

```ts
export interface DiagramSelection {
  tableId?: string;
  columnId?: string;
  relationshipId?: string;
}
```

Solamente un elemento seleccionado inicialmente.

Posteriormente podrá soportar multiselect.

---

# 22. Inspector

Al seleccionar una tabla mostrar inspector lateral.

Ejemplo:

```text
Table

Name
[ users ]

Schema
[ public ]

Columns
────────────

id
uuid
[x] Primary Key
[x] Not Null

email
varchar
[x] Unique

[ + Add column ]
```

---

# 23. Inspector de relaciones

Al seleccionar una relación:

```text
Relationship

From

orders.user_id

To

users.id

Type

Many to One

On delete

CASCADE

On update

NO ACTION

[ Delete relationship ]
```

Todas las modificaciones deben convertirse en `SchemaOperation`.

---

# 24. Operaciones del esquema

Crear un modelo explícito de operaciones.

Ejemplo:

```ts
export type SchemaOperation =
  | AddTableOperation
  | UpdateTableOperation
  | DeleteTableOperation

  | AddColumnOperation
  | UpdateColumnOperation
  | DeleteColumnOperation

  | AddRelationshipOperation
  | UpdateRelationshipOperation
  | DeleteRelationshipOperation;
```

Ejemplo:

```ts
interface AddTableOperation {
  type: 'ADD_TABLE';

  table: TableSchema;
}
```

---

# 25. Operaciones visuales

Separar operaciones del schema de operaciones del layout.

```ts
export type DiagramOperation =
  | MoveTableOperation
  | ResizeTableOperation
  | ChangeViewportOperation;
```

Mover una tabla no debe regenerar DBML.

---

# 26. Store

Crear un store principal usando Angular Signals.

Ejemplo conceptual:

```ts
@Injectable({
  providedIn: 'root'
})
export class DiagramStore {

  readonly project =
    signal<DiagramProject | null>(null);

  readonly schema =
    computed(() => this.project()?.schema);

  readonly layout =
    computed(() => this.project()?.layout);

  readonly selection =
    signal<DiagramSelection | null>(null);

  readonly dbmlErrors =
    signal<DbmlParseError[]>([]);

  readonly dirty =
    signal(false);

  readonly saveStatus =
    signal<'saved' | 'saving' | 'dirty'>('saved');

}
```

---

# 27. Métodos del store

Crear métodos como:

```ts
createProject()

loadProject()

deleteProject()

setDbml()

applySchemaOperation()

applyDiagramOperation()

selectTable()

selectColumn()

selectRelationship()

clearSelection()

undo()

redo()

save()
```

Los componentes no deben modificar estado directamente.

---

# 28. Prevención de loops DBML ↔ Canvas

Debe existir concepto de origen del cambio.

```ts
type ChangeOrigin =
  | 'editor'
  | 'canvas'
  | 'import'
  | 'system';
```

Ejemplo:

```text
Editor changes DBML

origin = editor

parse DBML
   ↓
schema update
   ↓
canvas render

NO regenerar DBML innecesariamente
```

Y:

```text
Canvas adds column

origin = canvas

schema update
   ↓
generate DBML
   ↓
update Monaco
```

Esto evita ciclos.

---

# 29. Historial

Implementar Undo/Redo.

Mantener:

```ts
undoStack
redoStack
```

Registrar operaciones significativas.

Ejemplos:

* create table;
* delete table;
* update table;
* create column;
* create relationship;
* move table.

Un drag completo debe generar solamente una operación.

NO:

```text
MOVE 400,200
MOVE 401,200
MOVE 402,201
MOVE 403,201
```

Sino:

```text
MOVE

from:
400,200

to:
650,320
```

---

# 30. Persistencia local

Usar IndexedDB.

Crear abstracción:

```ts
export interface ProjectRepository {

  findAll(): Promise<DiagramProject[]>;

  findById(
    id: string
  ): Promise<DiagramProject | null>;

  save(
    project: DiagramProject
  ): Promise<void>;

  delete(
    id: string
  ): Promise<void>;
}
```

Implementación inicial:

```text
IndexedDbProjectRepository
```

Nunca utilizar IndexedDB directamente dentro de componentes.

---

# 31. Autosave

Guardar automáticamente después de modificaciones.

Flujo:

```text
change
  │
  ▼
dirty
  │
  ▼
debounce
  │
  ▼
IndexedDB
  │
  ▼
saved
```

Debounce aproximado:

```text
750ms - 1500ms
```

Mostrar visualmente:

```text
Saving...

Saved locally
```

---

# 32. Home

La página inicial debe mostrar los proyectos locales.

Ejemplo:

```text
DiagramDB

Your diagrams

┌─────────────────────┐
│ Ecommerce           │
│ Updated 10 min ago  │
└─────────────────────┘

┌─────────────────────┐
│ Accounting          │
│ Updated yesterday   │
└─────────────────────┘

[ + New Diagram ]

[ Import ]
```

---

# 33. Editor principal

Layout:

```text
┌──────────────────────────────────────────────────────────────┐
│ DiagramDB   Ecommerce        Undo Redo   Export             │
├──────────────────────┬─────────────────────────────┬─────────┤
│                      │                             │         │
│ DBML Editor          │                             │         │
│                      │                             │         │
│ Table users {        │          Canvas             │Inspector│
│                      │                             │         │
│ }                    │                             │         │
│                      │                             │         │
├──────────────────────┴─────────────────────────────┴─────────┤
│ Saved locally                         Zoom 100%              │
└──────────────────────────────────────────────────────────────┘
```

---

# 34. Panel DBML

Debe poder:

* resize;
* collapse;
* expand.

El canvas debe aprovechar automáticamente el espacio restante.

---

# 35. Toolbar

Toolbar mínima:

```text
Add table

Add relationship

Auto layout

Undo

Redo

Zoom -

Zoom +

Fit

Import

Export
```

---

# 36. Auto layout

Implementarlo como comando explícito.

No ejecutar automáticamente al modificar DBML.

Botón:

```text
Auto layout
```

Puede utilizarse una librería como ELK.js.

El resultado solamente modifica `DiagramLayout`.

No modifica `DatabaseSchema`.

---

# 37. Creación visual de tabla

Botón:

```text
+ Table
```

Debe crear una tabla inicial.

Ejemplo:

```text
new_table

id integer PK
```

Opcionalmente abrir inmediatamente el inspector.

Al crearla:

```text
Canvas
   ↓
ADD_TABLE
   ↓
Canonical Schema
   ↓
Generate DBML
```

---

# 38. Crear columna

Desde inspector:

```text
+ Add column
```

Crear:

```ts
{
  name: 'new_column',
  type: 'varchar'
}
```

Después permitir editar sus propiedades.

---

# 39. Eliminaciones

Eliminar tabla debe eliminar también relaciones asociadas.

Ejemplo:

```text
Delete users
      │
      ├── delete users
      ├── delete relationships using users
      └── delete users layout
```

Esta modificación debe funcionar como una única operación reversible.

---

# 40. Validaciones

Validar mínimo:

* nombres duplicados de tablas;
* columnas duplicadas;
* relaciones apuntando a entidades inexistentes;
* IDs duplicados;
* relationship source/target válidos.

Las validaciones del dominio deben vivir en `schema-core`.

---

# 41. Import DBML

Permitir archivos:

```text
*.dbml
```

Flujo:

```text
select file
   ↓
read text
   ↓
parse
   ↓
create DiagramProject
   ↓
auto layout
   ↓
persist IndexedDB
```

---

# 42. Export DBML

Permitir:

```text
Export → DBML
```

Archivo:

```text
ecommerce.dbml
```

Debe contener solamente DBML válido.

---

# 43. Formato DiagramDB

Crear un formato propio para preservar proyecto completo.

Extensión sugerida:

```text
.diagramdb
```

Internamente puede ser JSON.

Ejemplo:

```json
{
  "format": "diagramdb",
  "formatVersion": 1,
  "project": {
    "id": "...",
    "name": "Ecommerce",
    "dbml": "...",
    "schema": {},
    "layout": {},
    "createdAt": "...",
    "updatedAt": "..."
  }
}
```

---

# 44. Import DiagramDB

Permitir:

```text
*.diagramdb
```

Validar:

```ts
format === 'diagramdb'
```

y versión compatible.

No asumir que el JSON importado es válido.

Crear:

```ts
DiagramProjectValidator
```

---

# 45. Export DiagramDB

Botón:

```text
Export Project
```

Debe descargar:

```text
ecommerce.diagramdb
```

Este archivo debe permitir recuperar:

* schema;
* DBML;
* posiciones;
* viewport;
* configuraciones;
* metadatos.

---

# 46. Keyboard shortcuts

Implementar inicialmente:

```text
Ctrl/Cmd + Z
Undo

Ctrl/Cmd + Shift + Z
Redo

Delete
Delete selection

Escape
Clear selection

Ctrl/Cmd + S
Save local

Ctrl/Cmd + 0
Fit diagram
```

Posteriormente:

```text
Cmd/Ctrl + K
Command palette
```

---

# 47. Performance

Objetivo inicial:

```text
100 tablas
1000 columnas
500 relaciones
```

La aplicación debe continuar siendo interactiva.

Evitar render completo durante cada movimiento.

Cuando se mueva una tabla recalcular solamente relaciones asociadas.

---

# 48. Componentes Angular sugeridos

```text
src/app/

app.routes.ts

core/

  schema/
    models/
    operations/
    validation/
    reconciliation/

  dbml/
    parser/
    generator/

  persistence/
    project.repository.ts
    indexed-db-project.repository.ts

  import-export/

features/

  home/
    project-list/
    project-card/

  editor/
    diagram-editor-page/
    dbml-editor/

  diagram/
    canvas/
    viewport/
    table-node/
    column-row/
    relationship-edge/
    relationship-layer/
    temporary-edge/
    toolbar/

  inspector/
    inspector/
    table-inspector/
    column-inspector/
    relationship-inspector/

state/

  diagram.store.ts
  history.store.ts
```

---

# 49. Servicios/módulos importantes

Implementar preferentemente:

```text
DbmlParser

DbmlGenerator

SchemaReconciler

SchemaValidator

SchemaOperationExecutor

DiagramOperationExecutor

DiagramGeometryService

RelationshipGeometryService

ProjectRepository

ProjectImportService

ProjectExportService
```

---

# 50. Separación de responsabilidades

## TableNodeComponent

Debe:

* renderizar tabla;
* emitir interacción;
* emitir drag.

NO debe:

* generar DBML;
* persistir IndexedDB;
* modificar otras tablas;
* gestionar historial.

---

## RelationshipEdgeComponent

Debe:

* dibujar relación;
* manejar selección.

NO debe:

* crear directamente relaciones;
* modificar Schema Model.

---

## DbmlEditorComponent

Debe:

* envolver Monaco;
* recibir DBML;
* emitir cambios;
* mostrar diagnostics.

NO debe:

* parsear directamente;
* modificar canvas;
* guardar proyectos.

---

# 51. Schema Engine

Esta debe ser una de las piezas más importantes del proyecto.

Debe poder ejecutar:

```ts
const result = executeSchemaOperation(
  schema,
  operation
);
```

Preferentemente siguiendo un enfoque inmutable:

```text
schema
   +
operation
   ↓
newSchema
```

Esto simplifica:

* Angular Signals;
* undo/redo;
* tests;
* debugging.

---

# 52. Reglas de integridad

Nunca permitir relaciones a columnas que no existan.

Nunca dejar layout huérfano de tablas eliminadas.

Nunca guardar selección de elementos eliminados.

Nunca modificar IDs al editar propiedades.

---

# 53. Testing prioritario

Crear tests antes de hacer UI demasiado compleja.

Tests importantes:

```text
DBML → schema

schema → DBML

DBML → schema → DBML

ADD_TABLE

DELETE_TABLE

ADD_COLUMN

DELETE_COLUMN

ADD_RELATIONSHIP

DELETE_RELATIONSHIP

rename table preserving ID

rename table preserving layout

move table does not alter DBML

DBML parse error preserves previous schema

import/export DiagramDB

undo schema operation

redo schema operation
```

---

# 54. Flujo principal que debe funcionar

Usar este ejemplo:

```dbml
Table users {
  id uuid [pk]
  email varchar [unique]
}

Table posts {
  id uuid [pk]
  user_id uuid
  title varchar
}

Ref: posts.user_id > users.id
```

El sistema debe:

1. parsearlo;
2. crear `users`;
3. crear `posts`;
4. crear relación;
5. asignar IDs internos;
6. asignar layout;
7. renderizar ambas tablas;
8. renderizar la relación.

---

# 55. Flujo de modificación desde canvas

Después:

1. mover `users`;
2. posición debe guardarse;
3. agregar columna `name`;
4. Schema Model debe cambiar;
5. DBML debe actualizarse;
6. Monaco debe actualizarse;
7. posición de `users` debe permanecer igual.

---

# 56. Flujo de modificación desde DBML

Después editar:

```text
email varchar
```

a:

```text
email varchar [not null, unique]
```

Debe:

1. parsear;
2. reconciliar;
3. conservar table ID;
4. conservar column ID cuando sea posible;
5. conservar posición;
6. actualizar canvas.

---

# 57. Creación de relaciones desde canvas

Escenario:

```text
posts.user_id

drag

→

users.id
```

Debe crear:

```dbml
Ref: posts.user_id > users.id
```

automáticamente.

---

# 58. MVP

El MVP se considera completo cuando incluye:

* gestión de proyectos locales;
* Monaco;
* DBML parser;
* DBML generator;
* canvas;
* tablas;
* columnas;
* relaciones;
* drag;
* pan;
* zoom;
* inspector;
* creación visual;
* edición visual;
* eliminación;
* DBML ↔ Canvas;
* undo/redo;
* IndexedDB;
* autosave;
* import DBML;
* export DBML;
* import `.diagramdb`;
* export `.diagramdb`.

---

# 59. Fuera del MVP

NO implementar todavía:

* usuarios;
* autenticación;
* backend;
* cloud sync;
* colaboración;
* comments;
* organizaciones;
* equipos;
* permisos;
* billing;
* AI;
* database connections;
* SQL introspection;
* migrations.

---

# 60. Roadmap posterior

Después del MVP considerar:

## Fase 2

* búsqueda de tablas;
* minimap;
* auto layout avanzado;
* grupos;
* schemas visuales;
* notes;
* keyboard navigation;
* command palette;
* SQL export;
* PNG;
* SVG;
* PDF.

## Fase 3

* import SQL;
* PostgreSQL DDL;
* MySQL DDL;
* Prisma Schema;
* schema diff;
* migrations.

## Fase 4

* backend opcional;
* cuentas;
* cloud sync;
* compartir diagramas.

## Fase 5

* colaboración multiplayer;
* realtime;
* comments;
* history remoto.

---

# 61. Orden recomendado de implementación

No construir todo simultáneamente.

### Etapa 1 — Core

Crear:

```text
Angular app

schema-core

models

operations

tests
```

---

### Etapa 2 — DBML

Construir:

```text
DBML parser adapter

DBML generator

reconciliation

tests
```

Conseguir:

```text
DBML ⇄ Schema
```

antes de trabajar seriamente en canvas.

---

### Etapa 3 — Canvas estático

Renderizar:

```text
tables

columns

relationships
```

con datos hardcoded.

---

### Etapa 4 — Interacción

Implementar:

```text
pan

zoom

drag tables

selection
```

---

### Etapa 5 — Conexiones

Implementar:

```text
relationship geometry

relationship handles

temporary edge

create relationship

edit relationship
```

---

### Etapa 6 — Sincronización

Conectar:

```text
Monaco
   ↕
Schema
   ↕
Canvas
```

---

### Etapa 7 — Persistencia

Agregar:

```text
IndexedDB

autosave

project list
```

---

### Etapa 8 — Import/export

Agregar:

```text
DBML import

DBML export

DiagramDB import

DiagramDB export
```

---

### Etapa 9 — History

Agregar:

```text
Undo

Redo
```

---

### Etapa 10 — Polish

Agregar:

```text
keyboard shortcuts

error states

empty states

performance improvements

auto-layout
```

---

# 62. Primera milestone obligatoria

Antes de seguir agregando funcionalidades debe existir una pantalla donde:

```text
┌────────────────────┬──────────────────────────────┐
│                    │                              │
│ DBML               │          Canvas              │
│                    │                              │
│ Table users {      │     ┌───────────────┐        │
│   id uuid [pk]     │     │ users         │        │
│ }                  │     │ id uuid       │        │
│                    │     └───────────────┘        │
│                    │                              │
└────────────────────┴──────────────────────────────┘
```

y modificar DBML debe modificar el canvas.

No continuar con funcionalidad secundaria hasta conseguirlo.

---

# 63. Segunda milestone obligatoria

Debe ser posible:

```text
drag:

posts.user_id

        ↓

users.id
```

y generar automáticamente:

```dbml
Ref: posts.user_id > users.id
```

Esta funcionalidad valida que:

```text
Canvas → Schema → DBML
```

funciona.

---

# 64. Tercera milestone obligatoria

Debe ser posible:

1. mover las tablas;
2. cerrar la aplicación;
3. abrirla nuevamente;
4. recuperar el proyecto;
5. recuperar exactamente las posiciones.

Esto valida:

```text
Schema
+
Layout
+
IndexedDB
```

---

# 65. Cuarta milestone obligatoria

Debe funcionar:

```text
Export Project
```

generando:

```text
project.diagramdb
```

Después:

```text
Delete project

Import project.diagramdb
```

y recuperar exactamente:

* esquema;
* DBML;
* relaciones;
* posiciones;
* viewport.

---

# 66. Definición de terminado

DiagramDB MVP se considera terminado cuando un usuario puede:

1. abrir la aplicación;
2. crear un diagrama;
3. escribir DBML;
4. visualizarlo inmediatamente;
5. mover las tablas;
6. agregar tablas visualmente;
7. agregar columnas;
8. conectar columnas;
9. editar relaciones;
10. observar cómo DBML se actualiza;
11. modificar DBML y observar cómo se actualiza el canvas;
12. cerrar el navegador;
13. regresar posteriormente;
14. recuperar el proyecto;
15. exportarlo;
16. importarlo en otro navegador.

El producto debe funcionar completamente sin servidor.

La prioridad absoluta durante el desarrollo es mantener limpia y predecible esta arquitectura:

```text
                    DiagramDB

                       Store
                         │
              ┌──────────┴──────────┐
              │                     │
              ▼                     ▼
       Canonical Schema       Diagram Layout
              │                     │
       ┌──────┼────────┐            │
       │      │        │            │
       ▼      ▼        ▼            ▼
     DBML   Canvas  Validation   IndexedDB
       ▲      │
       │      │
       └──────┘
```

Si una decisión técnica rompe esta separación, debe revisarse antes de continuar.
