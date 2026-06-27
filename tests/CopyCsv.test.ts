import { describe, it, expect } from 'vitest';
import { Lexer } from '../src/interpreter/Lexer';
import { Parser } from '../src/interpreter/Parser';

function parse(src: string) {
  return new Parser(new Lexer(src).tokenize()).parse();
}

describe('COPY TO / APPEND FROM parsing', () => {
  it('parses COPY TO with a dotted filename', () => {
    expect(parse('COPY TO customers.csv')).toEqual([{ type: 'COPY_TO', file: 'customers.csv' }]);
  });
  it('parses APPEND FROM with a dotted filename', () => {
    expect(parse('APPEND FROM customers.csv')).toEqual([{ type: 'APPEND_FROM', file: 'customers.csv' }]);
  });
  it('still parses bare APPEND as a blank-record append', () => {
    expect(parse('APPEND')).toEqual([{ type: 'APPEND' }]);
    expect(parse('APPEND BLANK')).toEqual([{ type: 'APPEND' }]);
  });
});
