import { describe, it, expect, afterEach } from 'vitest';
import { ReportStore } from '../server/ReportStore.js';
import fs from 'fs';
import path from 'path';

const TEST_DB = path.join(process.cwd(), 'data', 'test_reportstore.sqlite3');

function makeStore() {
  return new ReportStore(TEST_DB);
}

afterEach(() => {
  [TEST_DB, TEST_DB + '-shm', TEST_DB + '-wal'].forEach(f => {
    if (fs.existsSync(f)) fs.unlinkSync(f);
  });
});

describe('ReportStore', () => {
  it('saves and loads a report', () => {
    const store = makeStore();
    store.save('emp', '{"title":"Emp"}');
    expect(store.load('emp')).toBe('{"title":"Emp"}');
  });

  it('returns null for missing report', () => {
    const store = makeStore();
    expect(store.load('nope')).toBeNull();
  });

  it('lists saved reports', () => {
    const store = makeStore();
    store.save('beta', '{}');
    store.save('alpha', '{}');
    expect(store.list()).toEqual(['alpha', 'beta']);
  });

  it('overwrites existing report on save', () => {
    const store = makeStore();
    store.save('emp', '{"title":"Old"}');
    store.save('emp', '{"title":"New"}');
    expect(store.load('emp')).toBe('{"title":"New"}');
  });

  it('deletes a report', () => {
    const store = makeStore();
    store.save('emp', '{}');
    store.delete('emp');
    expect(store.load('emp')).toBeNull();
    expect(store.list()).toEqual([]);
  });

  it('delete of non-existent report does not throw', () => {
    const store = makeStore();
    expect(() => store.delete('ghost')).not.toThrow();
  });
});
