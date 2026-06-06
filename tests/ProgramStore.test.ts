import { describe, it, expect, afterAll } from 'vitest';
import path from 'path';
import fs from 'fs';
import { ProgramStore } from '../server/ProgramStore.js';

const TEST_DB = path.join(process.cwd(), 'data', 'test_programstore.sqlite3');
const store = new ProgramStore(TEST_DB);

afterAll(() => {
  for (const f of [TEST_DB, TEST_DB + '-shm', TEST_DB + '-wal']) {
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }
});

describe('ProgramStore', () => {
  it('saves and loads a program', () => {
    store.save('hello', 'LIST\n');
    expect(store.load('hello')).toBe('LIST\n');
  });

  it('returns null for missing program', () => {
    expect(store.load('nonexistent_xyz')).toBeNull();
  });

  it('lists saved programs', () => {
    store.save('alpha', 'LIST\n');
    store.save('beta', 'LIST\n');
    const names = store.list();
    expect(names).toContain('alpha');
    expect(names).toContain('beta');
  });

  it('overwrites existing program on save', () => {
    store.save('overwrite', 'v1\n');
    store.save('overwrite', 'v2\n');
    expect(store.load('overwrite')).toBe('v2\n');
  });
});
