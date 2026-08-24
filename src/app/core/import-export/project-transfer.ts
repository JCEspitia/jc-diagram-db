import { DiagramProject } from '../schema';

export type ProjectFileFormat = 'dbml' | 'diagramdb';

export function serializeProject(project: DiagramProject, format: ProjectFileFormat): string {
  return format === 'dbml' ? project.dbml : JSON.stringify(project, null, 2);
}

export function projectFilename(project: DiagramProject, format: ProjectFileFormat): string {
  const base =
    project.name
      .trim()
      .replace(/[^a-z0-9_-]+/gi, '-')
      .replace(/^-+|-+$/g, '') || 'diagram';
  return `${base}.${format}`;
}

export function downloadProject(project: DiagramProject, format: ProjectFileFormat): void {
  const mime = format === 'dbml' ? 'text/plain;charset=utf-8' : 'application/json;charset=utf-8';
  const url = URL.createObjectURL(new Blob([serializeProject(project, format)], { type: mime }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = projectFilename(project, format);
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url));
}

export function projectNameFromFilename(filename: string): string {
  return filename.replace(/\.(?:diagramdb|dbml)$/i, '').trim() || 'Imported diagram';
}
