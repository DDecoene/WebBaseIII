import { describe, it, expect } from 'vitest';
import { callStateless } from '../src/interpreter/Builtins';

describe('SUBSTR', () => {
  it('extracts mid-string', () => expect(callStateless('SUBSTR', ['Hello', 2, 3])).toBe('ell'));
  it('no len — to end', () => expect(callStateless('SUBSTR', ['Hello', 4])).toBe('lo'));
  it('start < 1 clamps to 1', () => expect(callStateless('SUBSTR', ['Hello', 0, 2])).toBe('He'));
  it('empty string', () => expect(callStateless('SUBSTR', ['', 1, 3])).toBe(''));
});

describe('LEN', () => {
  it('returns length', () => expect(callStateless('LEN', ['Hello'])).toBe(5));
  it('empty string', () => expect(callStateless('LEN', [''])).toBe(0));
});

describe('TRIM', () => {
  it('strips both ends', () => expect(callStateless('TRIM', ['  hi  '])).toBe('hi'));
  it('no-op on clean string', () => expect(callStateless('TRIM', ['hi'])).toBe('hi'));
});

describe('LTRIM', () => {
  it('strips leading only', () => expect(callStateless('LTRIM', ['  hi  '])).toBe('hi  '));
});

describe('UPPER / LOWER', () => {
  it('UPPER', () => expect(callStateless('UPPER', ['hello'])).toBe('HELLO'));
  it('LOWER', () => expect(callStateless('LOWER', ['HELLO'])).toBe('hello'));
});

describe('AT', () => {
  it('finds needle', () => expect(callStateless('AT', ['lo', 'Hello'])).toBe(4));
  it('not found returns 0', () => expect(callStateless('AT', ['xyz', 'Hello'])).toBe(0));
  it('case-sensitive', () => expect(callStateless('AT', ['LO', 'Hello'])).toBe(0));
});

describe('STR', () => {
  it('integer, no args', () => expect(callStateless('STR', [42])).toBe('        42'));
  it('with len', () => expect(callStateless('STR', [42, 5])).toBe('   42'));
  it('with len and dec', () => expect(callStateless('STR', [3.14159, 8, 2])).toBe('    3.14'));
  it('overflow fills with stars', () => expect(callStateless('STR', [12345, 3])).toBe('***'));
});

describe('VAL', () => {
  it('parses number', () => expect(callStateless('VAL', ['42'])).toBe(42));
  it('parses float', () => expect(callStateless('VAL', ['3.14'])).toBe(3.14));
  it('non-numeric returns 0', () => expect(callStateless('VAL', ['abc'])).toBe(0));
  it('leading number', () => expect(callStateless('VAL', ['42abc'])).toBe(42));
});

describe('INT', () => {
  it('truncates positive', () => expect(callStateless('INT', [3.9])).toBe(3));
  it('truncates negative', () => expect(callStateless('INT', [-3.9])).toBe(-3));
});

describe('ABS', () => {
  it('positive stays positive', () => expect(callStateless('ABS', [5])).toBe(5));
  it('negative becomes positive', () => expect(callStateless('ABS', [-5])).toBe(5));
});

describe('SPACE', () => {
  it('produces n spaces', () => expect(callStateless('SPACE', [3])).toBe('   '));
  it('zero returns empty', () => expect(callStateless('SPACE', [0])).toBe(''));
});

describe('REPLICATE', () => {
  it('repeats string', () => expect(callStateless('REPLICATE', ['ab', 3])).toBe('ababab'));
  it('zero times', () => expect(callStateless('REPLICATE', ['ab', 0])).toBe(''));
});

describe('DATE', () => {
  it('returns MM/DD/YY format', () => {
    const result = callStateless('DATE', []) as string;
    expect(result).toMatch(/^\d{2}\/\d{2}\/\d{2}$/);
  });
});

describe('DTOC', () => {
  it('ISO to MM/DD/YY', () => expect(callStateless('DTOC', ['2026-06-07'])).toBe('06/07/26'));
  it('already MM/DD/YY passthrough', () => expect(callStateless('DTOC', ['06/07/26'])).toBe('06/07/26'));
});

describe('CTOD', () => {
  it('MM/DD/YY to ISO', () => expect(callStateless('CTOD', ['06/07/26'])).toBe('2026-06-07'));
});

describe('ROUND', () => {
  it('rounds to specified decimals', () => expect(callStateless('ROUND', [3.14159, 2])).toBe(3.14));
  it('defaults to 0 decimals', () => expect(callStateless('ROUND', [3.9])).toBe(4));
});

describe('MOD', () => {
  it('calculates remainder', () => expect(callStateless('MOD', [10, 3])).toBe(1));
});

describe('MAX', () => {
  it('returns the larger number', () => expect(callStateless('MAX', [10, 20])).toBe(20));
  it('handles negatives', () => expect(callStateless('MAX', [-5, -1])).toBe(-1));
});

describe('MIN', () => {
  it('returns the smaller number', () => expect(callStateless('MIN', [10, 20])).toBe(10));
  it('handles negatives', () => expect(callStateless('MIN', [-5, -1])).toBe(-5));
});

describe('TIME', () => {
  it('returns HH:MM:SS format', () => {
    const result = callStateless('TIME', []) as string;
    expect(result).toMatch(/^\d{2}:\d{2}:\d{2}$/);
  });
});

describe('YEAR', () => {
  it('extracts year from ISO date', () => expect(callStateless('YEAR', ['2024-05-12'])).toBe(2024));
  it('invalid date returns 0', () => expect(callStateless('YEAR', ['not-a-date'])).toBe(0));
});

describe('MONTH', () => {
  it('extracts month from ISO date', () => expect(callStateless('MONTH', ['2024-05-12'])).toBe(5));
  it('invalid date returns 0', () => expect(callStateless('MONTH', ['not-a-date'])).toBe(0));
});

describe('DAY', () => {
  it('extracts day from ISO date', () => expect(callStateless('DAY', ['2024-05-12'])).toBe(12));
  it('invalid date returns 0', () => expect(callStateless('DAY', ['not-a-date'])).toBe(0));
});

describe('unknown function', () => {
  it('throws', () => expect(() => callStateless('FOOBAR', [])).toThrow('Unknown function: FOOBAR'));
});
