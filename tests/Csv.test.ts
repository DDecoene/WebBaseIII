import { describe, it, expect } from 'vitest';
import { toCSV, parseCSV } from '../src/shared/csv';

describe('toCSV', () => {
  it('writes a header row then data rows in column order', () => {
    const csv = toCSV(['name', 'age'], [{ name: 'Ada', age: 36 }, { name: 'Bo', age: 9 }]);
    expect(csv).toBe('name,age\r\nAda,36\r\nBo,9');
  });

  it('quotes fields containing comma, quote, or newline and doubles embedded quotes', () => {
    const csv = toCSV(['a'], [{ a: 'x,y' }, { a: 'he said "hi"' }, { a: 'line1\nline2' }]);
    expect(csv).toBe('a\r\n"x,y"\r\n"he said ""hi"""\r\n"line1\nline2"');
  });

  it('renders null/undefined as an empty field', () => {
    expect(toCSV(['a', 'b'], [{ a: null, b: undefined }])).toBe('a,b\r\n,');
  });
});

describe('parseCSV', () => {
  it('parses a header and rows, tolerating CRLF and LF', () => {
    const r = parseCSV('name,age\r\nAda,36\nBo,9');
    expect(r.header).toEqual(['name', 'age']);
    expect(r.rows).toEqual([['Ada', '36'], ['Bo', '9']]);
  });

  it('parses quoted fields with embedded commas, quotes and newlines', () => {
    const r = parseCSV('a\r\n"x,y"\r\n"he said ""hi"""\r\n"l1\nl2"');
    expect(r.rows).toEqual([['x,y'], ['he said "hi"'], ['l1\nl2']]);
  });

  it('returns empty rows for header-only input', () => {
    expect(parseCSV('a,b').rows).toEqual([]);
  });

  it('ignores a trailing newline (no phantom empty row)', () => {
    expect(parseCSV('a\r\n1\r\n').rows).toEqual([['1']]);
  });
});
