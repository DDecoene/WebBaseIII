import { describe, it, expect } from 'vitest';
import { Lexer } from '../src/interpreter/Lexer';
import { Parser } from '../src/interpreter/Parser';

function parse(src: string) {
  return new Parser(new Lexer(src).tokenize()).parse();
}

describe('JOIN parsing', () => {
  it('parses JOIN WITH alias TO file FOR cond', () => {
    const nodes = parse('JOIN WITH ord TO custord FOR cust.id = ord.custid');
    expect(nodes[0]).toEqual({
      type: 'JOIN',
      withAlias: 'ORD',
      target: 'CUSTORD',
      forCond: 'CUST.ID = ORD.CUSTID',
      fields: null,
    });
  });

  it('parses an explicit FIELDS list with alias.field tokens', () => {
    const nodes = parse('JOIN WITH ord TO custord FOR cust.id = ord.custid FIELDS name, ord.amount');
    expect(nodes[0]).toEqual({
      type: 'JOIN',
      withAlias: 'ORD',
      target: 'CUSTORD',
      forCond: 'CUST.ID = ORD.CUSTID',
      fields: ['NAME', 'ORD.AMOUNT'],
    });
  });

  it('re-quotes string literals in the FOR condition', () => {
    const nodes = parse("JOIN WITH ord TO t FOR cust.city = 'Paris'");
    expect((nodes[0] as any).forCond).toBe("CUST.CITY = 'Paris'");
  });

  it('throws when FOR is missing', () => {
    expect(() => parse('JOIN WITH ord TO custord')).toThrow(/JOIN requires a FOR/i);
  });
});
