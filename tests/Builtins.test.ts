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

describe('unknown function', () => {
  it('throws', () => expect(() => callStateless('FOOBAR', [])).toThrow('Unknown function: FOOBAR'));
});
