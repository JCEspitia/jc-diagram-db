import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createColumn } from '../core/schema';
import { DiagramStore } from './diagram.store';

describe('DiagramStore DBML synchronization', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('preserves the last valid schema and layout when DBML is invalid', () => {
    const store = new DiagramStore();
    const schema = store.schema();
    const layout = store.layout();

    store.setDbml('Table users {\n invalid');
    vi.advanceTimersByTime(350);

    expect(store.schema()).toBe(schema);
    expect(store.layout()).toBe(layout);
    expect(store.dbmlErrors().length).toBeGreaterThan(0);
  });

  it('reconciles valid editor changes while preserving table IDs and layout', () => {
    const store = new DiagramStore();
    const users = store.schema().tables.find(({ name }) => name === 'users')!;
    const usersLayout = store.layout().tables[users.id];

    store.setDbml(
      store.dbml().replace('email varchar [unique]', 'email varchar [not null, unique]'),
    );
    vi.advanceTimersByTime(350);

    const updatedUsers = store.schema().tables.find(({ name }) => name === 'users')!;
    expect(updatedUsers.id).toBe(users.id);
    expect(updatedUsers.columns.find(({ name }) => name === 'email')?.nullable).toBe(false);
    expect(store.layout().tables[users.id]).toBe(usersLayout);
    expect(store.dbmlErrors()).toEqual([]);
  });

  it('adds and removes layout entries as DBML changes table membership', () => {
    const store = new DiagramStore();
    const users = store.schema().tables.find(({ name }) => name === 'users')!;
    store.setDbml(`${store.dbml()}\n\nTable audit_log {\n  id uuid [pk]\n}`);
    vi.advanceTimersByTime(350);
    const auditLog = store.schema().tables.find(({ name }) => name === 'audit_log')!;
    expect(store.layout().tables[auditLog.id]).toBeDefined();

    store.setDbml('Table posts {\n  id uuid [pk]\n}');
    vi.advanceTimersByTime(350);
    expect(store.layout().tables[users.id]).toBeUndefined();
    expect(Object.keys(store.layout().tables)).toHaveLength(1);
  });

  it('regenerates DBML after a visual schema operation', () => {
    const store = new DiagramStore();
    const users = store.schema().tables.find(({ name }) => name === 'users')!;
    store.applySchemaOperation({
      type: 'ADD_COLUMN',
      tableId: users.id,
      column: createColumn({ name: 'name' }),
    });

    expect(store.dbml()).toContain('name varchar');
    expect(store.changeOrigin()).toBe('canvas');
  });

  it('creates a table with layout and removes both atomically on delete', () => {
    const store = new DiagramStore();
    store.createTable();
    const created = store.schema().tables.find(({ name }) => name === 'new_table')!;

    expect(created.columns[0]).toMatchObject({
      name: 'id',
      type: 'integer',
      primaryKey: true,
    });
    expect(store.layout().tables[created.id]).toBeDefined();
    expect(store.dbml()).toContain('Table new_table');

    store.deleteTable(created.id);

    expect(store.schema().tables.some(({ id }) => id === created.id)).toBe(false);
    expect(store.layout().tables[created.id]).toBeUndefined();
    expect(store.selection()).toBeNull();
  });

  it('enforces compatible column options during visual edits', () => {
    const store = new DiagramStore();
    const users = store.schema().tables.find(({ name }) => name === 'users')!;
    const email = users.columns.find(({ name }) => name === 'email')!;

    store.updateColumn(users.id, email.id, { primaryKey: true });
    expect(store.schema().tables.find(({ id }) => id === users.id)?.columns[1]).toMatchObject({
      primaryKey: true,
      nullable: true,
      unique: false,
    });

    store.updateColumn(users.id, email.id, { nullable: false });
    expect(store.schema().tables.find(({ id }) => id === users.id)?.columns[1]).toMatchObject({
      primaryKey: false,
      nullable: false,
    });

    store.updateColumn(users.id, email.id, { increment: true });
    expect(store.schema().tables.find(({ id }) => id === users.id)?.columns[1]?.increment).toBe(
      false,
    );
    store.updateColumn(users.id, email.id, {
      type: 'integer',
      defaultValue: '1',
      increment: true,
    });
    expect(store.schema().tables.find(({ id }) => id === users.id)?.columns[1]).toMatchObject({
      type: 'integer',
      increment: true,
      defaultValue: undefined,
    });
    store.updateColumn(users.id, email.id, { type: 'text' });
    expect(store.schema().tables.find(({ id }) => id === users.id)?.columns[1]?.increment).toBe(
      false,
    );
  });

  it('deleting a column also removes its relationships and updates DBML', () => {
    const store = new DiagramStore();
    const posts = store.schema().tables.find(({ name }) => name === 'posts')!;
    const userId = posts.columns.find(({ name }) => name === 'user_id')!;

    store.deleteColumn(posts.id, userId.id);

    expect(store.schema().relationships).toEqual([]);
    expect(store.dbml()).not.toContain('user_id uuid');
    expect(store.dbml()).not.toContain('Ref:');
  });

  it('undoes and redoes one complete table movement without changing DBML', () => {
    const store = new DiagramStore();
    const table = store.schema().tables[0]!;
    const from = store.layout().tables[table.id]!;
    const dbml = store.dbml();
    store.applyDiagramOperation({
      type: 'MOVE_TABLE',
      tableId: table.id,
      from,
      to: { ...from, x: from.x + 100 },
    });

    expect(store.canUndo()).toBe(true);
    expect(store.dbml()).toBe(dbml);
    store.undo();
    expect(store.layout().tables[table.id]).toEqual(from);
    store.redo();
    expect(store.layout().tables[table.id]?.x).toBe(from.x + 100);
  });

  it('rejects duplicate names from visual edits', () => {
    const store = new DiagramStore();
    const posts = store.schema().tables.find(({ name }) => name === 'posts')!;
    store.renameTable(posts.id, 'users');
    expect(store.schema().tables.find(({ id }) => id === posts.id)?.name).toBe('posts');
  });

  it('creates, edits, and deduplicates visual relationships', () => {
    const store = new DiagramStore();
    const users = store.schema().tables.find(({ name }) => name === 'users')!;
    const posts = store.schema().tables.find(({ name }) => name === 'posts')!;
    const usersId = users.columns.find(({ name }) => name === 'id')!;
    const postId = posts.columns.find(({ name }) => name === 'id')!;
    const initialCount = store.schema().relationships.length;

    store.createRelationship(users.id, usersId.id, posts.id, postId.id);
    const created = store.selectedRelationship()!;
    store.createRelationship(users.id, usersId.id, posts.id, postId.id);

    expect(store.schema().relationships).toHaveLength(initialCount + 1);
    expect(store.dbml()).toContain('Ref: users.id > posts.id');
    store.updateRelationship(created.id, { type: 'one-to-one', onDelete: 'CASCADE' });
    expect(store.schema().relationships.find(({ id }) => id === created.id)).toMatchObject({
      type: 'one-to-one',
      onDelete: 'CASCADE',
    });
    expect(store.dbml()).toContain('users.id - posts.id [delete: cascade]');
  });

  it('edits cable routing without modifying DBML and removes orphan routes', () => {
    const store = new DiagramStore();
    const relationship = store.schema().relationships[0]!;
    const dbml = store.dbml();
    store.updateRelationshipRoute(relationship.id, {
      routeX: 520,
      sourceSide: 'right',
      targetSide: 'left',
    });

    expect(store.layout().relationships?.[relationship.id]).toEqual({
      routeX: 520,
      sourceSide: 'right',
      targetSide: 'left',
    });
    expect(store.dbml()).toBe(dbml);
    store.applySchemaOperation({
      type: 'DELETE_RELATIONSHIP',
      relationshipId: relationship.id,
    });
    expect(store.layout().relationships?.[relationship.id]).toBeUndefined();
  });
});
