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
