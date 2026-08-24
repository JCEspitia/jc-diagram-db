import { describe, expect, it } from 'vitest';
import { createEntityId, createUuid } from './schema.factory';

describe('schema ID factory', () => {
  it('creates unique UUID-shaped identifiers', () => {
    const first = createUuid();
    const second = createUuid();

    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    expect(second).not.toBe(first);
    expect(createEntityId('tbl')).toMatch(/^tbl_[0-9a-f-]{36}$/i);
  });
});
