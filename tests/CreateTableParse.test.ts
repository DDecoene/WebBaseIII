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
