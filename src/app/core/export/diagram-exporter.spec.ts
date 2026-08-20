import { describe, expect, it } from 'vitest';
import { SimpleDbmlParser } from '../dbml';
import { DiagramLayout } from '../schema';
import { renderDiagramSvg } from './diagram-exporter';

describe('diagram exporter', () => {
  const schema = new SimpleDbmlParser().parse(`Table users {
  id int [pk]
}
Table audit_log {
  id int [pk]
}
TableGroup core [color: #d35400] {
  users
}`).schema!;
  const users = schema.tables[0]!;
  const audit = schema.tables[1]!;
  const areaId = schema.tableGroups![0]!.id;
  const layout: DiagramLayout = {
    tables: {
      [users.id]: { x: 80, y: 90 },
      [audit.id]: { x: 500, y: 90 },
    },
    areas: {
      [areaId]: {
        name: 'core',
        color: '#d35400',
        x: 50,
        y: 45,
        width: 300,
        height: 180,
        tableIds: [users.id],
      },
    },
    viewport: { x: 0, y: 0, zoom: 1 },
  };

  it('renders a complete standalone SVG', () => {
    const svg = renderDiagramSvg({ schema, layout, projectName: 'Test' });
    expect(svg.source).toContain('<svg');
    expect(svg.source).toContain('users');
    expect(svg.source).toContain('audit_log');
    expect(svg.source).toContain('core');
  });

  it('limits area exports to the tables assigned to that area', () => {
    const svg = renderDiagramSvg({ schema, layout, projectName: 'Test', areaId });
    expect(svg.source).toContain('users');
    expect(svg.source).not.toContain('audit_log');
  });
});
