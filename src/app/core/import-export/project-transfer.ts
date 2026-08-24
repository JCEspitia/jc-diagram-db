import { DiagramProject } from '../schema';
import { saveBlob } from './save-file';

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

export async function downloadProject(
  project: DiagramProject,
  format: ProjectFileFormat,
): Promise<void> {
  const mime = format === 'dbml' ? 'text/plain;charset=utf-8' : 'application/json;charset=utf-8';
  await saveBlob(
    new Blob([serializeProject(project, format)], { type: mime }),
    projectFilename(project, format),
  );
}

export function projectNameFromFilename(filename: string): string {
  return filename.replace(/\.(?:diagramdb|dbml)$/i, '').trim() || 'Imported diagram';
}
