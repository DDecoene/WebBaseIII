import { describe, it, expect, afterEach } from 'vitest';
import { IndexStore } from '../server/IndexStore';
import { Lexer } from '../src/interpreter/Lexer';
import { Parser } from '../src/interpreter/Parser';
import { Session } from '../server/Session';
import type { ServerMessage } from '../src/shared/types.js';
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

describe('Parser: index commands', () => {
  function parse(src: string) {
    return new Parser(new Lexer(src).tokenize()).parse();
  }

  it('parses INDEX ON field TO tag', () => {
    const nodes = parse('INDEX ON lastname TO byname');
    expect(nodes[0]).toEqual({ type: 'INDEX_ON', expression: 'LASTNAME', tag: 'BYNAME' });
  });

  it('parses INDEX ON expression TO tag', () => {
    const nodes = parse('INDEX ON lastname+firstname TO full');
    expect(nodes[0]).toEqual({ type: 'INDEX_ON', expression: 'LASTNAME+FIRSTNAME', tag: 'FULL' });
  });

  it('parses SET INDEX TO tag', () => {
    const nodes = parse('SET INDEX TO byname');
    expect(nodes[0]).toEqual({ type: 'SET_INDEX', tag: 'BYNAME' });
  });

  it('parses SET INDEX TO (clear)', () => {
    const nodes = parse('SET INDEX TO');
    expect(nodes[0]).toEqual({ type: 'SET_INDEX', tag: null });
  });

  it('parses REINDEX', () => {
    const nodes = parse('REINDEX');
    expect(nodes[0]).toEqual({ type: 'REINDEX' });
  });

  it('parses LIST INDEXES', () => {
    const nodes = parse('LIST INDEXES');
    expect(nodes[0]).toEqual({ type: 'LIST_INDEXES' });
  });

  it('parses SEEK value', () => {
    const nodes = parse('SEEK "Smith"');
    expect(nodes[0]).toMatchObject({ type: 'SEEK', value: { k: 'lit', v: 'Smith' } });
  });

  it('parses FIND string', () => {
    const nodes = parse('FIND Smith');
    expect(nodes[0]).toMatchObject({ type: 'FIND', value: 'SMITH' });
  });

  it('parses FIND with quoted string', () => {
    const nodes = parse('FIND "Smith"');
    expect(nodes[0]).toMatchObject({ type: 'FIND', value: 'Smith' });
  });
});

let sessionCounter = 0;
function makeSession() {
  const sent: ServerMessage[] = [];
  const send = (msg: ServerMessage) => { sent.push(msg); };
  const session = new Session(send);
  return { session, sent };
}
function uniqueDb() { return `test_idx_sess_${++sessionCounter}`; }

describe('Session: INDEX ON restores on USE', () => {
  it.todo('active index is restored when table is re-opened');
});
