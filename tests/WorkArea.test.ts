import { describe, it, expect } from 'vitest';
import { WorkAreaManager } from '../src/interpreter/WorkAreaManager';
import type { WorkArea } from '../src/shared/types';

function makeArea(alias: string, overrides: Partial<WorkArea> = {}): WorkArea {
  return {
    alias,
    db: null, table: null, filter: null,
    rowPtr: 1, cachedRecCount: 0,
    activeIndex: null, _found: false,
    opfsAvailable: false, relation: null,
    ...overrides,
  };
}

describe('WorkAreaManager.detectCircular', () => {
  it('returns false when no existing relations', () => {
    const areas = new Map([
      ['orders', makeArea('orders')],
      ['customers', makeArea('customers')],
    ]);
    expect(WorkAreaManager.detectCircular(areas, 'orders', 'customers')).toBe(false);
  });

  it('returns true for direct cycle: A→B then B→A', () => {
    const areas = new Map([
      ['orders', makeArea('orders', { relation: { expression: 'custid', intoAlias: 'customers' } })],
      ['customers', makeArea('customers')],
    ]);
    expect(WorkAreaManager.detectCircular(areas, 'customers', 'orders')).toBe(true);
  });

  it('returns false for non-cyclic chain A→B, B→C, adding C→D', () => {
    const areas = new Map([
      ['a', makeArea('a', { relation: { expression: 'x', intoAlias: 'b' } })],
      ['b', makeArea('b', { relation: { expression: 'y', intoAlias: 'c' } })],
      ['c', makeArea('c')],
      ['d', makeArea('d')],
    ]);
    expect(WorkAreaManager.detectCircular(areas, 'c', 'd')).toBe(false);
  });
});

describe('WorkAreaManager.resolveField', () => {
  it('returns null when area rowPtr is 0', () => {
    const areas = new Map([
      ['customers', makeArea('customers', { rowPtr: 0, table: 'customers', db: 'test' })],
    ]);
    const result = WorkAreaManager.resolveField('customers', 'name', areas);
    expect(result).toBeNull();
  });

  it('returns null when area not found', () => {
    const areas = new Map<string, WorkArea>();
    expect(WorkAreaManager.resolveField('unknown', 'name', areas)).toBeNull();
  });
});
