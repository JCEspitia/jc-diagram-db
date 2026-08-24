<p align="center">
  <img src="public/icons/jc-diagram-db.svg" width="88" alt="Logo de JC Diagram DB" />
</p>

<h1 align="center">JC Diagram DB</h1>

<p align="center">
  Diseña, documenta y comparte esquemas de bases de datos desde el navegador.
</p>

<p align="center">
  <a href="https://jcespitia.github.io/jc-diagram-db/"><strong>Abrir JC Diagram DB</strong></a>
  ·
  <a href="https://github.com/JCEspitia/jc-diagram-db/issues">Reportar un problema</a>
</p>

<p align="center">
  <a href="https://github.com/JCEspitia/jc-diagram-db/actions/workflows/pages.yml">
    <img src="https://github.com/JCEspitia/jc-diagram-db/actions/workflows/pages.yml/badge.svg" alt="Estado del despliegue" />
  </a>
  <a href="LICENSE">
    <img src="https://img.shields.io/badge/license-MIT-6366f1.svg" alt="Licencia MIT" />
  </a>
</p>

JC Diagram DB es un editor visual de esquemas relacionales compatible con DBML. Puedes trabajar
mediante código o directamente sobre el diagrama y mantener ambas representaciones sincronizadas.
No requiere cuenta, servidor ni instalación obligatoria.

## Funciones principales

- Editor DBML con resaltado, autocompletado, validación y sincronización visual.
- Creación y edición de tablas, columnas, índices, enums y relaciones.
- Relaciones con cardinalidad, acciones referenciales y rutas ajustables.
- Áreas para organizar grupos de tablas, asignar colores y enfocar secciones del modelo.
- Comentarios, valores por defecto, checks, claves e índices compuestos.
- Varios niveles de detalle y algoritmos de distribución automática.
- Historial de cambios con undo y redo.
- Exportación del diagrama completo o por áreas a PNG, SVG y PDF.
- Importación y exportación de archivos `.dbml` y proyectos `.diagramdb`.
- Proyectos guardados automáticamente en el navegador.
- Temas claro y oscuro.
- Tutorial guiado para conocer las herramientas principales en la primera visita.
- Instalación como PWA y funcionamiento sin conexión después de la primera carga.

## Empezar a usarlo

Abre [JC Diagram DB](https://jcespitia.github.io/jc-diagram-db/) y crea un proyecto. Puedes comenzar
agregando tablas desde la interfaz o escribiendo DBML:

```dbml
Table users {
  id integer [primary key, increment]
  email varchar [not null, unique]
  created_at timestamp [default: `now()`]
}

Table posts {
  id integer [primary key, increment]
  author_id integer [not null]
  title varchar [not null]
}

Ref: posts.author_id > users.id
```

Los cambios realizados en el editor actualizan el canvas. Las modificaciones visuales también
regeneran el DBML sin perder los comentarios existentes.

## Instalar la aplicación

JC Diagram DB es una Progressive Web App. En un navegador compatible:

1. Abre la aplicación.
2. Busca **Instalar JC Diagram DB** en la barra de direcciones o en el menú del navegador.
3. Confirma la instalación.

La aplicación aparecerá como un programa independiente y podrá abrirse sin conexión. La primera
visita y las actualizaciones sí requieren conexión a Internet.

## Privacidad y almacenamiento

JC Diagram DB no tiene backend y no envía tus esquemas a un servidor. Los proyectos se guardan en
IndexedDB dentro del perfil del navegador que estés utilizando.

Ten presente que limpiar los datos del sitio, usar navegación privada o cambiar de navegador
puede hacer que pierdas el almacenamiento local. Exporta periódicamente los proyectos importantes
como `.diagramdb` para conservar una copia portable con el esquema y el layout.

## Formatos de exportación

- `.diagramdb`: copia completa y editable del proyecto.
- `.dbml`: esquema compatible con otros editores DBML.
- `.png` y `.svg`: imagen del diagrama completo o de un área.
- `.pdf`: diagrama acompañado de enums, comentarios y otra documentación del modelo.

## Soporte y contribuciones

Si encuentras un error o quieres proponer una mejora, abre un
[issue](https://github.com/JCEspitia/jc-diagram-db/issues). Para ejecutar el proyecto, entender su
arquitectura o preparar un cambio, consulta la [guía de desarrollo](docs/development.md).

El alcance técnico y el roadmap detallado están disponibles en [PROJECT.md](PROJECT.md).

## Licencia

JC Diagram DB es software open source publicado bajo la [licencia MIT](LICENSE). Puedes usarlo,
modificarlo y distribuirlo, incluso en proyectos comerciales, siempre que conserves el aviso de
copyright y la licencia.
