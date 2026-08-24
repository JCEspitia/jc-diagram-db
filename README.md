# DiagramDB

Aplicación web para diseñar esquemas de bases de datos relacionales mediante DBML y un
canvas visual. Funciona como SPA local, sin backend.

El núcleo sigue un flujo deliberadamente desacoplado:

```text
DBML ⇄ Canonical Schema Model ⇄ Canvas
```

El modelo canónico es la fuente de verdad. El texto DBML, el layout y los componentes
visuales son representaciones independientes.

## Estado actual

- Workspace Angular 21 con TypeScript estricto y Vitest.
- Modelo canónico, layout y formato serializable de proyecto.
- Motor inmutable de operaciones sobre tablas, columnas y relaciones.
- Validación de IDs, nombres y extremos de relaciones.
- Parser y generador DBML desacoplados de Angular.
- Reconciliación de esquemas para conservar IDs internos tras editar DBML.
- Canvas estático con tablas HTML y relaciones SVG Bézier.
- Geometría y transformaciones de coordenadas independientes de los componentes.
- Store principal con Angular Signals y operaciones de layout inmutables.
- Selección, drag de tablas, pan y zoom centrado en el cursor.
- Monaco Editor local con resaltado DBML, diagnostics y parseo con debounce.
- Tema Monaco propio, compacto y alineado visualmente con DiagramDB.
- CSS base de Monaco cargado globalmente para posicionar correctamente su área de entrada.
- Autocompletado DBML, snippets, autoindent y cierre automático de pares.
- Sincronización DBML hacia el modelo conservando el último esquema válido ante errores.
- Referencias inline (`ref: > table.column`) e índices compuestos `indexes { ... }`.
- Creación y eliminación visual de tablas y columnas desde toolbar e inspector.
- Edición visual de nombres, tipos, PK, nulabilidad y unicidad con regeneración DBML.
- Undo/redo de operaciones significativas, shortcuts y fit-to-screen real.
- Selección y eliminación contextual de tablas, columnas y relaciones.
- Auto layout en cuadrícula, panel DBML colapsable e IDs de índices/enums reconciliados.
- Creación visual de relaciones con handles, curva temporal y destino resaltado.
- Inspector de relaciones con cardinalidad y acciones `ON DELETE` / `ON UPDATE`.
- Panel DBML redimensionable y Monaco con temas claro/oscuro.
- Actualizaciones externas de Monaco conservando su pila de undo.
- Rutas ortogonales editables con punto de desvío y puertos laterales configurables.
- Cardinalidades visibles, badges `PK/FK/NN/UQ/AI` y flujo animado al seleccionar tablas.
- Routing automático con carriles paralelos y evasión básica de tablas intermedias.
- Conexiones suavizadas con controles por tramo que solo se desplazan horizontal o verticalmente.
- Controles discretos sobre tramos internos: todos los puntos de un mismo tramo desplazan la línea completa.
- Separación mínima entre controles y esquinas para evitar interacciones demasiado estrechas.
- Acción `Reset line` para descartar ajustes manuales y calcular nuevamente la mejor ruta automática.
- Edición temporal sobre las tablas para acceder a tramos ocultos y `Reset line` visible solo en rutas desviadas.
- Foco por columna: al pasar el cursor se resaltan sus relaciones y se anima su dirección.
- Auto layout `Left to right`, `Pipeline`, `Snowflake` y `Compact`.
- Sidebar de gestión para tablas, columnas, índices, enums y áreas.
- Comentarios, valores por defecto, checks, índices compuestos y colores de tabla.
- Áreas persistidas como `tablegroup`, con asignación explícita y ajuste automático.
- Niveles de detalle para mostrar todas las columnas, solo llaves o solo tablas.
- Exportación a PNG, SVG y PDF, completa o por área; el PDF incluye documentación.
- Tooltips enriquecidos e iconos para metadatos de tablas y columnas.
- Compatibilidad con contextos HTTP que no exponen `crypto.randomUUID`.
- Persistencia automática del proyecto y restauración de la última sesión mediante IndexedDB.
- Navegador de proyectos locales con creación, apertura, renombrado, duplicado y eliminación.

## Pendiente para completar el MVP

- Importación y exportación de DBML como archivo.
- Importación y exportación del formato `.diagramdb`.
- Restauración del proyecto y del viewport al recargar.
- Cobertura end-to-end para las interacciones principales del canvas.

## Rendimiento y dependencias opcionales

Monaco se carga bajo demanda, pero su hoja de estilos base debe formar parte de los estilos
iniciales para que el editor se renderice correctamente. El exportador también se carga bajo
demanda; `jsPDF`, `canvg` y `html2canvas` solo se descargan al solicitar una exportación PDF.
Las dependencias CommonJS transitivas de ese flujo están declaradas explícitamente en
`angular.json`.

El alcance completo y el roadmap están descritos en [PROJECT.md](./PROJECT.md).

## Desarrollo local

```bash
npm install
npm start
```

La aplicación estará disponible en `http://localhost:4200/`.

## Verificación

```bash
npm test -- --watch=false
npm run build
```

## Estructura del core

```text
src/app/core/
├── dbml/                 Parser, generador y contratos DBML
└── schema/
    ├── models/           Modelo canónico y modelo de proyecto
    ├── operations/       Operaciones inmutables
    ├── reconciliation/   Conservación de identidades
    └── validation/       Reglas de integridad del dominio
```
