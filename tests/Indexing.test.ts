import { describe, it, expect, afterEach } from 'vitest';
import { IndexStore } from '../server/IndexStore';
import fs from 'fs';
import path from 'path';

let counter = 0;
function tmpPath() {
  return path.join(process.cwd(), 'data', `test_idx_${++counter}.sqlite3`);
}

afterEach(() => {
  const dataDir = path.join(process.cwd(), 'data');
  if (fs.existsSync(dataDir)) {
    fs.readdirSync(dataDir)
      .filter(f => f.startsWith('test_idx_'))
      .forEach(f => fs.unlinkSync(path.join(dataDir, f)));
  }
});

describe('IndexStore', () => {
  it('saves and retrieves an index definition', () => {
    const store = new IndexStore(tmpPath());
    store.saveIndex('customers', 'byname', 'lastname+firstname');
    const indexes = store.listIndexes('customers');
    expect(indexes).toHaveLength(1);
    expect(indexes[0].tag).toBe('byname');
    expect(indexes[0].expression).toBe('lastname+firstname');
  });

  it('sets and gets active index', () => {
    const store = new IndexStore(tmpPath());
    store.saveIndex('customers', 'byname', 'lastname');
    store.setActive('customers', 'byname');
    expect(store.getActive('customers')).toEqual({ tag: 'byname', expression: 'lastname' });
  });

  it('clears active index', () => {
    const store = new IndexStore(tmpPath());
    store.saveIndex('customers', 'byname', 'lastname');
    store.setActive('customers', 'byname');
    store.clearActive('customers');
    expect(store.getActive('customers')).toBeNull();
  });

  it('returns null getActive when no index set', () => {
    const store = new IndexStore(tmpPath());
    expect(store.getActive('customers')).toBeNull();
  });

  it('upserts index definition on duplicate tag', () => {
    const store = new IndexStore(tmpPath());
    store.saveIndex('customers', 'byname', 'lastname');
    store.saveIndex('customers', 'byname', 'firstname');
    const indexes = store.listIndexes('customers');
    expect(indexes).toHaveLength(1);
    expect(indexes[0].expression).toBe('firstname');
  });

  it('setActive throws when tag does not exist', () => {
    const store = new IndexStore(tmpPath());
    expect(() => store.setActive('customers', 'ghost')).toThrow("Index 'ghost' not found on table 'customers'");
  });
});
