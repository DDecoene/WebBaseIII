import { describe, it, expect } from 'vitest';
import { validateCellValue } from '../src/shared/cellValidation';
import type { ColumnMeta } from '../src/shared/cellValidation';

const meta = (baseType: string, qualifier: number | null = null, scale: number | null = null): ColumnMeta =>
  ({ baseType, qualifier, scale });

describe('validateCellValue', () => {
  it('accepts any value for an unknown/untracked column', () => {
    expect(validateCellValue('X', 'anything', undefined)).toBeNull();
    expect(validateCellValue('X', 'anything', null)).toBeNull();
  });

  it('accepts an empty value for every type (clearing a cell to NULL)', () => {
    for (const t of ['TIME', 'DATE', 'NUM', 'INT', 'LOGICAL']) {
      expect(validateCellValue('X', '', meta(t))).toBeNull();
      expect(validateCellValue('X', '   ', meta(t))).toBeNull();
    }
  });

  it('does not constrain CHAR/MEMO', () => {
    expect(validateCellValue('X', 'anything at all', meta('CHAR', 5))).toBeNull();
    expect(validateCellValue('X', 'anything at all', meta('MEMO'))).toBeNull();
  });

  describe('TIME', () => {
    it('accepts well-formed HH:MM', () => {
      expect(validateCellValue('T', '00:00', meta('TIME'))).toBeNull();
      expect(validateCellValue('T', '23:59', meta('TIME'))).toBeNull();
      expect(validateCellValue('T', '09:07', meta('TIME'))).toBeNull();
    });
    it('rejects malformed or out-of-range values', () => {
      expect(validateCellValue('T', '9:30', meta('TIME'))).toMatch(/HH:MM/);
      expect(validateCellValue('T', '24:00', meta('TIME'))).toMatch(/HH:MM/);
      expect(validateCellValue('T', '08:60', meta('TIME'))).toMatch(/HH:MM/);
      expect(validateCellValue('T', 'noon', meta('TIME'))).toMatch(/HH:MM/);
    });
    it('enforces the minute granularity qualifier', () => {
      expect(validateCellValue('T', '08:15', meta('TIME', 15))).toBeNull();
      expect(validateCellValue('T', '08:45', meta('TIME', 15))).toBeNull();
      expect(validateCellValue('T', '08:07', meta('TIME', 15))).toMatch(/multiple of 15/);
      expect(validateCellValue('T', '08:30', meta('TIME', 30))).toBeNull();
      expect(validateCellValue('T', '08:15', meta('TIME', 30))).toMatch(/multiple of 30/);
    });
  });

  describe('DATE', () => {
    it('accepts a valid ISO calendar date', () => {
      expect(validateCellValue('D', '2024-02-29', meta('DATE'))).toBeNull();
      expect(validateCellValue('D', '2026-12-31', meta('DATE'))).toBeNull();
    });
    it('rejects a wrong format', () => {
      expect(validateCellValue('D', '12/25/26', meta('DATE'))).toMatch(/YYYY-MM-DD/);
      expect(validateCellValue('D', '2024-2-9', meta('DATE'))).toMatch(/YYYY-MM-DD/);
    });
    it('rejects an impossible calendar date', () => {
      expect(validateCellValue('D', '2023-02-29', meta('DATE'))).toMatch(/not a real date/);
      expect(validateCellValue('D', '2024-02-30', meta('DATE'))).toMatch(/not a real date/);
      expect(validateCellValue('D', '2024-13-01', meta('DATE'))).toMatch(/not a real date/);
    });
  });

  describe('LOGICAL', () => {
    it('accepts the dBASE and plain boolean literal set', () => {
      for (const v of ['.T.', '.F.', '.TRUE.', '.FALSE.', 'T', 'F', 'true', 'FALSE', '1', '0']) {
        expect(validateCellValue('L', v, meta('LOGICAL'))).toBeNull();
      }
    });
    it('rejects anything else', () => {
      expect(validateCellValue('L', 'yes', meta('LOGICAL'))).toMatch(/\.T\.|\.F\./);
      expect(validateCellValue('L', '2', meta('LOGICAL'))).toMatch(/\.T\.|\.F\./);
    });
  });

  describe('INT', () => {
    it('accepts integers, including negatives', () => {
      expect(validateCellValue('I', '42', meta('INT'))).toBeNull();
      expect(validateCellValue('I', '-7', meta('INT'))).toBeNull();
    });
    it('rejects decimals and non-numbers', () => {
      expect(validateCellValue('I', '4.2', meta('INT'))).toMatch(/whole number/);
      expect(validateCellValue('I', 'abc', meta('INT'))).toMatch(/whole number/);
    });
  });

  describe('NUM', () => {
    it('accepts any number when unqualified', () => {
      expect(validateCellValue('N', '3.14159', meta('NUM'))).toBeNull();
      expect(validateCellValue('N', '-12', meta('NUM'))).toBeNull();
    });
    it('rejects non-numeric input', () => {
      expect(validateCellValue('N', 'abc', meta('NUM'))).toMatch(/number/);
    });
    it('enforces scale (digits after the decimal point)', () => {
      expect(validateCellValue('N', '10.25', meta('NUM', 8, 2))).toBeNull();
      expect(validateCellValue('N', '10.257', meta('NUM', 8, 2))).toMatch(/2 decimal/);
    });
    it('enforces precision (total digits)', () => {
      expect(validateCellValue('N', '123456.78', meta('NUM', 8, 2))).toBeNull();   // 8 digits
      expect(validateCellValue('N', '1234567.89', meta('NUM', 8, 2))).toMatch(/6 digit/); // 7 int digits > 8-2
    });
    it('treats NUM(n) with no scale as an integer-width limit', () => {
      expect(validateCellValue('N', '123456', meta('NUM', 6))).toBeNull();
      expect(validateCellValue('N', '1234567', meta('NUM', 6))).toMatch(/6 digit/);
    });
  });
});

describe('lookup membership', () => {
  const meta = {
    baseType: 'CHAR', qualifier: 12 as number | null, scale: null as number | null,
    lookup: { kind: 'list' as const, values: ['Lead', 'Won', 'Lost'] },
    options: [
      { value: 'Lead', label: 'Lead' },
      { value: 'Won', label: 'Won' },
      { value: 'Lost', label: 'Lost' },
    ],
  };

  it('accepts a value that is in the resolved options', () => {
    expect(validateCellValue('STAGE', 'Won', meta)).toBeNull();
  });

  it('rejects a value that is not in the resolved options', () => {
    expect(validateCellValue('STAGE', 'Maybe', meta)).toMatch(/not one of the allowed values/);
  });

  it('is case-sensitive: "won" is not "Won"', () => {
    expect(validateCellValue('STAGE', 'won', meta)).toMatch(/not one of the allowed values/);
  });

  it('still allows clearing the cell', () => {
    expect(validateCellValue('STAGE', '', meta)).toBeNull();
  });

  it('skips membership when options are absent (unresolvable lookup degrades)', () => {
    const degraded = { ...meta, options: undefined };
    expect(validateCellValue('STAGE', 'Anything', degraded)).toBeNull();
  });

  it('runs the declared-type check before membership', () => {
    const intMeta = {
      baseType: 'INT', qualifier: null, scale: null,
      lookup: { kind: 'list' as const, values: ['1', '2'] },
      options: [{ value: '1', label: '1' }, { value: '2', label: '2' }],
    };
    expect(validateCellValue('N', 'abc', intMeta)).toMatch(/whole number/);
    expect(validateCellValue('N', '3', intMeta)).toMatch(/not one of the allowed values/);
    expect(validateCellValue('N', '2', intMeta)).toBeNull();
  });
});
