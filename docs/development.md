# Guía de desarrollo de JC Diagram DB

Esta guía reúne la información necesaria para ejecutar, verificar y desplegar el proyecto. La
aplicación es una SPA estática construida con Angular y no requiere backend.

## Requisitos

- Node.js 22 o una versión compatible con Angular 21.
- npm 11, según la versión declarada en `package.json`.
- Un navegador moderno con IndexedDB y soporte para service workers.

## Instalación local

Clona el repositorio e instala exactamente las dependencias del lockfile:

```bash
git clone https://github.com/JCEspitia/jc-diagram-db.git
cd jc-diagram-db
npm ci
npm start
```

La aplicación estará disponible en `http://localhost:4200/`. El service worker se mantiene
deshabilitado durante `ng serve` para evitar que una caché anterior interfiera con el desarrollo.

## Comandos

```bash
npm start                 # Servidor de desarrollo
npm test -- --watch=false # Suite completa de pruebas
npm run build             # Build web de producción
npm run build:pages       # Build con el prefijo usado por GitHub Pages
npm run watch             # Build de desarrollo en modo watch
```

Los artefactos se generan en `dist/diagramdb/browser`.

## Arquitectura

El modelo canónico es la fuente de verdad de la aplicación:

```text
DBML ⇄ Canonical Schema Model ⇄ Canvas
                         ├── Generator
                         └── Validator
```

Las operaciones visuales nunca modifican directamente el editor. Toda edición pasa primero por
una operación del modelo y después actualiza el canvas y el DBML generado.

```text
src/app/core/
├── dbml/                 Parser, generador y preservación de comentarios
├── diagram/              Geometría, layout y ruteo de relaciones
├── export/               Generación de PNG, SVG y PDF
├── import-export/        Archivos DBML y JC Diagram DB
├── persistence/          Persistencia local en IndexedDB
└── schema/
    ├── models/           Modelo canónico y proyecto serializable
    ├── operations/       Operaciones inmutables
    ├── reconciliation/   Conservación de identidades
    └── validation/       Reglas de integridad
```

La interfaz utiliza Angular Signals. Monaco Editor y las dependencias pesadas de exportación se
cargan bajo demanda para reducir el bundle inicial.

## Pruebas y verificación

Antes de abrir un pull request ejecuta:

```bash
npm ci
npm test -- --watch=false
npm run build:pages
```

El proyecto usa Vitest con las utilidades de pruebas de Angular. La cobertura end-to-end de las
interacciones principales del canvas continúa siendo una mejora pendiente.

## PWA y pruebas offline

El service worker solo se activa en builds de producción. Para probar la instalación y el modo
offline, sirve `dist/diagramdb/browser` después de ejecutar `npm run build`; utiliza `localhost` o
HTTPS porque los service workers requieren un contexto seguro.

Los proyectos se almacenan en IndexedDB. No hay base de datos remota, autenticación ni variables
de entorno obligatorias.

## Despliegue

El workflow `.github/workflows/pages.yml` se ejecuta después de cada push a `master`:

1. Instala las dependencias con `npm ci`.
2. Ejecuta la suite de pruebas.
3. Compila con el prefijo `/jc-diagram-db/`.
4. Publica `dist/diagramdb/browser` en GitHub Pages.

Para habilitarlo en un repositorio nuevo, selecciona **Settings → Pages → Source → GitHub
Actions**. También puede ejecutarse manualmente desde la pestaña Actions.

## Convenciones de trabajo

- Mantén TypeScript en modo estricto.
- Conserva el modelo canónico independiente de la UI.
- No uses nombres de tablas o columnas como IDs internos.
- Incluye pruebas para cambios en parser, generador, validación y operaciones del modelo.
- Ejecuta Prettier sobre los archivos modificados.
- No subas `node_modules`, `dist`, cachés de Angular ni datos locales del navegador.

Consulta [PROJECT.md](../PROJECT.md) para conocer el alcance, las decisiones arquitectónicas y el
roadmap del producto.
