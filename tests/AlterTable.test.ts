import { describe, it, expect } from 'vitest';
import { Lexer } from '../src/interpreter/Lexer';
import { Parser } from '../src/interpreter/Parser';

function parse(src: string) {
  return new Parser(new Lexer(src).tokenize()).parse();
}

describe('Parser: MODIFY STRUCTURE / ALTER TABLE', () => {
  it('parses MODIFY STRUCTURE', () => {
    expect(parse('MODIFY STRUCTURE')[0]).toEqual({ type: 'MODIFY_STRUCTURE' });
  });

  it('parses ALTER TABLE ADD', () => {
    expect(parse('ALTER TABLE customers ADD phone CHAR(20)')[0]).toEqual({
      type: 'ALTER_TABLE', name: 'CUSTOMERS', op: 'ADD', col: 'PHONE', colType: 'CHAR',
    });
  });

  it('parses ALTER TABLE DROP', () => {
    expect(parse('ALTER TABLE customers DROP phone')[0]).toEqual({
      type: 'ALTER_TABLE', name: 'CUSTOMERS', op: 'DROP', col: 'PHONE',
    });
  });

  it('parses ALTER TABLE RENAME', () => {
    expect(parse('ALTER TABLE customers RENAME phone TO mobile')[0]).toEqual({
      type: 'ALTER_TABLE', name: 'CUSTOMERS', op: 'RENAME', col: 'PHONE', newName: 'MOBILE',
    });
  });

  it('parses ALTER TABLE ALTER (type change)', () => {
    expect(parse('ALTER TABLE customers ALTER age INT')[0]).toEqual({
      type: 'ALTER_TABLE', name: 'CUSTOMERS', op: 'ALTER', col: 'AGE', colType: 'INT',
    });
  });
});
