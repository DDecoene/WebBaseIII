import { describe, it, expect } from 'vitest';
import { Lexer } from '../src/interpreter/Lexer';
import { Parser } from '../src/interpreter/Parser';

function parse(src: string) {
  return new Parser(new Lexer(src).tokenize()).parse();
}
function cols(src: string) {
  return (parse(src)[0] as any).cols;
}

// The parser used to absorb any token it did not understand and invent a column
// from it. That is how `NUM(8,2)` silently produced a phantom column named "2"
// of type ")". Malformed input must fail loudly instead. (#50)
describe('CREATE TABLE rejects malformed column definitions', () => {
  it('rejects a missing comma between columns', () => {
    expect(() => parse('CREATE TABLE t (a CHAR(10) b INT)')).toThrow(/CREATE TABLE/i);
  });

  it('rejects an empty column slot (double comma)', () => {
    expect(() => parse('CREATE TABLE t (a CHAR(10),, b INT)')).toThrow(/CREATE TABLE/i);
  });

  it('rejects a column with no type', () => {
    expect(() => parse('CREATE TABLE t (a)')).toThrow(/CREATE TABLE/i);
  });

  it('rejects an unclosed column list', () => {
    expect(() => parse('CREATE TABLE t (a CHAR(10)')).toThrow(/CREATE TABLE/i);
  });

  it('rejects a third argument in a type qualifier', () => {
    expect(() => parse('CREATE TABLE t (a NUM(8,2,9))')).toThrow(/CREATE TABLE/i);
  });

  it('rejects a non-numeric type qualifier', () => {
    expect(() => parse('CREATE TABLE t (a CHAR(x))')).toThrow(/CREATE TABLE/i);
  });

  it('rejects an unclosed type qualifier', () => {
    expect(() => parse('CREATE TABLE t (a CHAR(10, b INT)')).toThrow(/CREATE TABLE/i);
  });

  it('names the offending column in the error', () => {
    expect(() => parse('CREATE TABLE t (a CHAR(10) b INT)')).toThrow(/b/i);
  });
});

describe('CREATE TABLE still accepts every valid form', () => {
  it('a bare table with no column list', () => {
    expect((parse('CREATE TABLE t')[0] as any).cols).toEqual([]);
  });

  it('types with no qualifier', () => {
    expect(cols('CREATE TABLE t (a DATE, b LOGICAL, c INT, d MEMO)')).toEqual([
      { name: 'A', colType: 'DATE' },
      { name: 'B', colType: 'LOGICAL' },
      { name: 'C', colType: 'INT' },
      { name: 'D', colType: 'MEMO' },
    ]);
  });

  it('single-argument qualifiers', () => {
    expect(cols('CREATE TABLE t (a CHAR(40), b NUM(6), c TIME(15))')).toEqual([
      { name: 'A', colType: 'CHAR', size: 40 },
      { name: 'B', colType: 'NUM', size: 6 },
      { name: 'C', colType: 'TIME', size: 15 },
    ]);
  });

  it('two-argument NUM(p,s)', () => {
    expect(cols('CREATE TABLE t (price NUM(8,2), active LOGICAL)')).toEqual([
      { name: 'PRICE', colType: 'NUM', size: 8, scale: 2 },
      { name: 'ACTIVE', colType: 'LOGICAL' },
    ]);
  });

  it('a trailing comma before the closing paren', () => {
    // dBASE-era sources are sloppy; a trailing comma is harmless, not corrupting.
    expect(cols('CREATE TABLE t (a INT,)')).toEqual([{ name: 'A', colType: 'INT' }]);
  });

  it('the exact demo-table definitions still parse to their declared columns', () => {
    expect(cols('CREATE TABLE PRODUCTS (PRODID CHAR(6), CATID CHAR(4), NAME CHAR(40), STOCK NUM(6), REORDER NUM(6), PRICE NUM(8,2), ACTIVE LOGICAL)')
      .map((c: any) => c.name))
      .toEqual(['PRODID', 'CATID', 'NAME', 'STOCK', 'REORDER', 'PRICE', 'ACTIVE']);
  });
});

describe('LOOKUP column qualifier', () => {
  it('parses a table lookup with DISPLAY', () => {
    expect(cols('CREATE TABLE e (SCHEDID CHAR(4) LOOKUP SCHEDULES.SCHEDID DISPLAY DESCR)')).toEqual([
      { name: 'SCHEDID', colType: 'CHAR', size: 4,
        lookup: { kind: 'table', table: 'SCHEDULES', column: 'SCHEDID', display: 'DESCR' } },
    ]);
  });

  it('parses a table lookup without DISPLAY', () => {
    expect(cols('CREATE TABLE e (SCHEDID CHAR(4) LOOKUP SCHEDULES.SCHEDID)')).toEqual([
      { name: 'SCHEDID', colType: 'CHAR', size: 4,
        lookup: { kind: 'table', table: 'SCHEDULES', column: 'SCHEDID' } },
    ]);
  });

  it('parses a literal list, preserving case', () => {
    expect(cols('CREATE TABLE d (STAGE CHAR(12) LOOKUP ("Lead","Won","Lost"))')).toEqual([
      { name: 'STAGE', colType: 'CHAR', size: 12,
        lookup: { kind: 'list', values: ['Lead', 'Won', 'Lost'] } },
    ]);
  });

  it('a LOOKUP column can be followed by more columns', () => {
    expect(cols('CREATE TABLE d (STAGE CHAR(12) LOOKUP ("A","B"), VALUE NUM(8,2))').map((c: any) => c.name))
      .toEqual(['STAGE', 'VALUE']);
  });

  it('rejects an empty LOOKUP list', () => {
    expect(() => parse('CREATE TABLE d (STAGE CHAR(12) LOOKUP ())')).toThrow(/LOOKUP/i);
  });

  it('rejects unquoted values in a LOOKUP list', () => {
    expect(() => parse('CREATE TABLE d (STAGE CHAR(12) LOOKUP (Lead,Won))')).toThrow(/LOOKUP/i);
  });

  it('rejects LOOKUP with no source at all', () => {
    expect(() => parse('CREATE TABLE d (STAGE CHAR(12) LOOKUP)')).toThrow(/LOOKUP/i);
  });

  it('rejects a table lookup missing the .column part', () => {
    expect(() => parse('CREATE TABLE d (STAGE CHAR(12) LOOKUP SCHEDULES)')).toThrow(/LOOKUP/i);
  });

  it('carries LOOKUP through ALTER TABLE ADD', () => {
    const ast = parse('ALTER TABLE t ADD STAGE CHAR(12) LOOKUP ("A","B")')[0] as any;
    expect(ast.lookup).toEqual({ kind: 'list', values: ['A', 'B'] });
  });

  it('carries LOOKUP through ALTER TABLE ALTER', () => {
    const ast = parse('ALTER TABLE t ALTER STAGE CHAR LOOKUP S.C DISPLAY D')[0] as any;
    expect(ast.lookup).toEqual({ kind: 'table', table: 'S', column: 'C', display: 'D' });
  });

  it('ALTER TABLE ADD without LOOKUP sets lookup to null, not undefined', () => {
    const ast = parse('ALTER TABLE t ADD PLAINCOL CHAR')[0] as any;
    expect(ast.lookup).toBeNull();
    expect('lookup' in ast).toBe(true);
  });

  it('ALTER TABLE ALTER without LOOKUP sets lookup to null, not undefined', () => {
    const ast = parse('ALTER TABLE t ALTER PLAINCOL CHAR')[0] as any;
    expect(ast.lookup).toBeNull();
    expect('lookup' in ast).toBe(true);
  });
});
