import { describe, expect, it } from 'vitest';
import { isDiagramProject } from './project.repository';

describe('isDiagramProject', () => {
  it('accepts a complete serializable project', () => {
    expect(
      isDiagramProject({
        format: 'diagramdb',
        formatVersion: 1,
        id: 'project-1',
        name: 'Example',
        dbml: '',
        schema: { id: 'schema-1', name: 'Example', tables: [], relationships: [], enums: [] },
        layout: { tables: {}, viewport: { x: 0, y: 0, zoom: 1 } },
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      }),
    ).toBe(true);
  });

  it('rejects unknown formats and incomplete data', () => {
    expect(isDiagramProject({ format: 'other' })).toBe(false);
    expect(isDiagramProject(null)).toBe(false);
  });
});
