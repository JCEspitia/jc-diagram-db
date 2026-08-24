import { describe, expect, it } from 'vitest';
import { IndexedDbProjectRepository } from '../core/persistence/project.repository';
import { DiagramProject } from '../core/schema';
import { DiagramStore } from './diagram.store';

class MemoryProjectRepository extends IndexedDbProjectRepository {
  readonly values = new Map<string, DiagramProject>();
  lastProjectId?: string;

  override async loadLastProject(): Promise<DiagramProject | null> {
    return this.lastProjectId ? structuredClone(this.values.get(this.lastProjectId) ?? null) : null;
  }

  override async loadProject(projectId: string): Promise<DiagramProject | null> {
    return structuredClone(this.values.get(projectId) ?? null);
  }

  override async listProjects(): Promise<DiagramProject[]> {
    return [...this.values.values()]
      .map((project) => structuredClone(project))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  override async saveProject(project: DiagramProject): Promise<void> {
    this.values.set(project.id, structuredClone(project));
    this.lastProjectId = project.id;
  }

  override async deleteProject(projectId: string): Promise<void> {
    this.values.delete(projectId);
    if (this.lastProjectId === projectId) this.lastProjectId = undefined;
  }
}

describe('DiagramStore project management', () => {
  it('creates, renames, duplicates, opens and deletes local projects', async () => {
    const repository = new MemoryProjectRepository();
    const store = new DiagramStore(repository);
    await Promise.resolve();

    await store.createProject('Inventory');
    const inventoryId = store.project().id;
    expect(store.project().name).toBe('Inventory');
    expect(store.projects().some(({ id }) => id === inventoryId)).toBe(true);

    await store.renameProject(inventoryId, 'Warehouse');
    expect(store.project().name).toBe('Warehouse');

    await store.duplicateProject(inventoryId);
    const copyId = store.project().id;
    expect(copyId).not.toBe(inventoryId);
    expect(store.project().name).toBe('Warehouse copy');

    await store.openProject(inventoryId);
    expect(store.project().name).toBe('Warehouse');

    await store.deleteProject(inventoryId);
    expect(store.project().id).not.toBe(inventoryId);
    expect(store.projects().some(({ id }) => id === inventoryId)).toBe(false);
  });

  it('imports valid DBML as a new project and rejects invalid DBML safely', async () => {
    const store = new DiagramStore(new MemoryProjectRepository());
    await Promise.resolve();
    const originalId = store.project().id;

    await expect(store.importDbmlProject('Table broken {', 'Broken')).rejects.toThrow();
    expect(store.project().id).toBe(originalId);

    await store.importDbmlProject('Table inventory {\n  id integer [pk]\n}', 'Inventory');
    expect(store.project().name).toBe('Inventory');
    expect(store.schema().tables[0]?.name).toBe('inventory');
    expect(store.project().id).not.toBe(originalId);
  });

  it('imports a DiagramDB file as a copy with a new identity', async () => {
    const repository = new MemoryProjectRepository();
    const store = new DiagramStore(repository);
    await Promise.resolve();
    await store.createProject('Portable');
    const exported = structuredClone(store.project());

    await store.importDiagramProject(JSON.stringify(exported));

    expect(store.project().id).not.toBe(exported.id);
    expect(store.project().name).toBe('Portable imported');
    expect(store.project().schema).toEqual(exported.schema);
    expect(store.project().layout.tables).toEqual(exported.layout.tables);
    expect(store.project().layout.viewport).toEqual(exported.layout.viewport);
  });
});
