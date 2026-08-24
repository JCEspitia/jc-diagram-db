import { describe, expect, it } from 'vitest';
import { DiagramProject } from '../schema';
import { projectFilename, projectNameFromFilename, serializeProject } from './project-transfer';

const project = {
  format: 'diagramdb',
  formatVersion: 1,
  id: 'project-1',
  name: 'Sales & Orders',
  dbml: 'Table orders {}',
  schema: { id: 'schema-1', name: 'Sales', tables: [], relationships: [], enums: [] },
  layout: { tables: {}, viewport: { x: 0, y: 0, zoom: 1 } },
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
} satisfies DiagramProject;

describe('project transfer', () => {
  it('serializes DBML without wrapping it in JSON', () => {
    expect(serializeProject(project, 'dbml')).toBe(project.dbml);
    expect(projectFilename(project, 'dbml')).toBe('Sales-Orders.dbml');
  });

  it('serializes the complete DiagramDB project', () => {
    expect(JSON.parse(serializeProject(project, 'diagramdb'))).toEqual(project);
    expect(projectNameFromFilename('inventory.diagramdb')).toBe('inventory');
  });
});
