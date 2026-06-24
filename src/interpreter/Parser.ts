import { Token, TType } from './Lexer';

// ── Built-in Functions ─────────────────────────────────────────────────────

const BUILTIN_FUNCTIONS = new Set([
  'SUBSTR','LEN','TRIM','LTRIM','UPPER','LOWER','AT','STR','VAL',
  'INT','ABS','SPACE','REPLICATE','DATE','DTOC','CTOD',
  'EOF','BOF','FOUND','RECNO','RECCOUNT',
]);

// ── AST Node Types ──────────────────────────────────────────────────────────

export type ASTNode =
  | { type: 'USE';         name: string; alias: string | null }
  | { type: 'USE_DB';      name: string }
  | { type: 'SELECT';      alias: string }
  | { type: 'SET_RELATION'; expression: string | null; intoAlias: string | null }
  | { type: 'LIST_AREAS' }
  | { type: 'LIST_COLS';   cols: string[] }
  | { type: 'CLOSE' }
  | { type: 'CLOSE_ALL' }
  | { type: 'LIST' }
  | { type: 'LIST_STRUCT' }
  | { type: 'LIST_TABLES' }
  | { type: 'LIST_DATABASES' }
  | { type: 'CREATE_REPORT'; name: string }
  | { type: 'MODIFY_REPORT'; name: string }
  | { type: 'REPORT_FORM';   name: string }
  | { type: 'LIST_REPORTS' }
  | { type: 'DELETE_REPORT'; name: string }
  | { type: 'BROWSE' }
  | { type: 'CLEAR' }
  | { type: 'QUIT' }
  | { type: 'HELP' }
  | { type: 'PACK' }
  | { type: 'SET_FILTER';  expr: string | null }
  | { type: 'REPLACE_ALL'; fields: Array<{ field: string; value: Expr }>; scope: 'ALL' | 'CURRENT' }
  | { type: 'APPEND' }
  | { type: 'DELETE';      scope: 'CURRENT' | 'ALL' }
  | { type: 'RECALL';      scope: 'CURRENT' | 'ALL' }
  | { type: 'GO';          target: 'TOP' | 'BOTTOM' | number }
  | { type: 'SKIP';        n: number }
  | { type: 'AT_SAY';      row: Expr; col: Expr; text: Expr }
  | { type: 'AT_SAY_GET';  row: Expr; col: Expr; text: Expr; varName: string }
  | { type: 'READ' }
  | { type: 'STORE';       value: Expr; varName: string }
  | { type: 'INPUT';       prompt: string; varName: string }
  | { type: 'IF';          cond: Expr; body: ASTNode[]; elseBody: ASTNode[] }
  | { type: 'DO_WHILE';    cond: Expr; body: ASTNode[] }
  | { type: 'DO_CASE'; cases: Array<{ cond: Expr; body: ASTNode[] }>; otherwise: ASTNode[] }
  | { type: 'CREATE_TABLE'; name: string; cols: ColDef[] }
  | { type: 'DROP_TABLE';  name: string }
  | { type: 'DO_PRG';      name: string }
  | { type: 'LIST_PROGRAMS' }
  | { type: 'EDIT_PRG';    name: string }
  | { type: 'INDEX_ON';    expression: string; tag: string }
  | { type: 'SET_INDEX';   tag: string | null }
  | { type: 'REINDEX' }
  | { type: 'LIST_INDEXES' }
  | { type: 'SORT'; field: string; descending: boolean; target: string }
  | { type: 'SEEK';        value: Expr }
  | { type: 'FIND';        value: string }
  | { type: 'UNKNOWN';     raw: string };

export interface ColDef { name: string; colType: string; size?: number; }

export type Expr =
  | { k: 'lit';  v: string | number | boolean }
  | { k: 'var';  name: string }
  | { k: 'bin';  op: string; l: Expr; r: Expr }
  | { k: 'not';  e: Expr }
  | { k: 'call'; fn: string; args: Expr[] };

// ── Parser ─────────────────────────────────────────────────────────────────

export class Parser {
  private p = 0;

  constructor(private toks: Token[]) {}

  parseExprPublic(): Expr {
    return this.expr();
  }

  parse(): ASTNode[] {
    const nodes: ASTNode[] = [];
    while (!this.end()) {
      this.skipNl();
      if (this.end()) break;
      if (this.peek().type === 'SEMI') { this.adv(); continue; }
      const n = this.stmt();
      if (n) nodes.push(n);
    }
    return nodes;
  }

  private stmt(): ASTNode | null {
    this.skipNl();
    const t = this.peek();

    if (t.type === 'AT') return this.parseAt();

    if (t.type !== 'KW' && t.type !== 'ID') {
      const raw = t.val; this.adv(); this.skipLine();
      return { type: 'UNKNOWN', raw };
    }

    const kw = t.val.toUpperCase();
    switch (kw) {
      case 'USE':      return this.parseUse();
      case 'SELECT':   return this.parseSelect();
      case 'CLOSE':    return this.parseClose();
      case 'LIST':     return this.parseList();
      case 'BROWSE':   this.adv(); return { type: 'BROWSE' };
      case 'CLEAR':    this.adv(); return { type: 'CLEAR' };
      case 'QUIT':     this.adv(); return { type: 'QUIT' };
      case 'HELP':     this.adv(); return { type: 'HELP' };
      case 'PACK':     this.adv(); return { type: 'PACK' };
      case 'SET':      return this.parseSet();
      case 'REPLACE':  return this.parseReplace();
      case 'APPEND':   this.adv(); this.skipKw('RECORD'); this.skipKw('BLANK'); return { type: 'APPEND' };
      case 'DELETE':   { this.adv(); if (this.peekKw('REPORT')) { this.adv(); return { type: 'DELETE_REPORT', name: this.ident() }; } return { type: 'DELETE', scope: this.consumeScope() }; }
      case 'RECALL':   this.adv(); return { type: 'RECALL', scope: this.consumeScope() };
      case 'GO':       return this.parseGo();
      case 'GOTO':     return this.parseGo();
      case 'SKIP':     this.adv(); return { type: 'SKIP', n: this.tryNum() ?? 1 };
      case 'READ':     this.adv(); return { type: 'READ' };
      case 'STORE':    return this.parseStore();
      case 'INPUT':    return this.parseInput();
      case 'ACCEPT':   return this.parseInput();
      case 'IF':       return this.parseIf();
      case 'DO':       return this.parseDo();
      case 'CREATE':   return this.parseCreate();
      case 'DROP':     return this.parseDrop();
      case 'EDIT':     { this.adv(); return { type: 'EDIT_PRG', name: this.ident() }; }
      case 'MODIFY': {
        this.adv();
        if (this.peekKw('REPORT')) { this.adv(); return { type: 'MODIFY_REPORT', name: this.ident() }; }
        throw new Error('Expected REPORT after MODIFY');
      }
      case 'REPORT': {
        this.adv();
        if (this.peekKw('FORM')) { this.adv(); return { type: 'REPORT_FORM', name: this.ident() }; }
        throw new Error('Expected FORM after REPORT');
      }
      case 'INDEX':    return this.parseIndexOn();
      case 'SORT':     return this.parseSort();
      case 'REINDEX':  this.adv(); return { type: 'REINDEX' };
      case 'SEEK':     this.adv(); return { type: 'SEEK', value: this.expr() };
      case 'FIND':     { this.adv(); const val = this.peek().val; this.adv(); return { type: 'FIND', value: val }; }
      default: {
        const raw = t.val; this.adv(); this.skipLine();
        return { type: 'UNKNOWN', raw };
      }
    }
  }

  private parseUse(): ASTNode {
    this.adv();
    if (this.peekKw('DATABASE') || this.peekKw('DB')) {
      this.adv();
      return { type: 'USE_DB', name: this.ident() };
    }
    const name = this.ident();
    let alias: string | null = null;
    if (this.peekKw('ALIAS')) { this.adv(); alias = this.ident(); }
    return { type: 'USE', name, alias };
  }

  private parseSelect(): ASTNode {
    this.adv();
    const t = this.peek();
    let alias: string;
    if (t.type === 'NUM') { alias = String(t.val); this.adv(); }
    else alias = this.ident();
    return { type: 'SELECT', alias };
  }

  private parseClose(): ASTNode {
    this.adv();
    if (this.peekKw('ALL')) { this.adv(); return { type: 'CLOSE_ALL' }; }
    return { type: 'CLOSE' };
  }

  private parseList(): ASTNode {
    this.adv();
    if (this.peekKw('STRUCTURE') || this.peekKw('STRUCT')) { this.adv(); return { type: 'LIST_STRUCT' }; }
    if (this.peekKw('TABLES'))    { this.adv(); return { type: 'LIST_TABLES' }; }
    if (this.peekKw('DATABASES') || this.peekKw('DBS')) { this.adv(); return { type: 'LIST_DATABASES' }; }
    if (this.peekKw('PROGRAMS') || this.peekKw('PROGS')) { this.adv(); return { type: 'LIST_PROGRAMS' }; }
    if (this.peekKw('INDEXES'))  { this.adv(); return { type: 'LIST_INDEXES' }; }
    if (this.peekKw('REPORTS'))  { this.adv(); return { type: 'LIST_REPORTS' }; }
    if (this.peekKw('AREAS'))    { this.adv(); return { type: 'LIST_AREAS' }; }
    // Column list: LIST name, alias.field, ...
    if (!this.end() && this.peek().type !== 'NL' && this.peek().type !== 'EOF' && this.peek().type !== 'SEMI') {
      const cols: string[] = [];
      do {
        let col = this.peek().val; this.adv();
        if (!this.end() && this.peek().type === 'DOT') {
          this.adv();
          col += '.' + this.peek().val; this.adv();
        }
        cols.push(col);
      } while (!this.end() && this.peek().type === 'COMMA' && (this.adv(), true));
      if (cols.length) return { type: 'LIST_COLS', cols };
    }
    return { type: 'LIST' };
  }

  private parseSet(): ASTNode {
    this.adv();
    if (this.peekKw('INDEX')) {
      this.adv();
      this.expectKw('TO');
      const tag = (!this.end() && this.peek().type !== 'NL' && this.peek().type !== 'EOF' && this.peek().type !== 'SEMI')
        ? (this.adv(), this.prev().val)
        : null;
      return { type: 'SET_INDEX', tag };
    }
    if (this.peekKw('RELATION')) {
      this.adv();
      this.expectKw('TO');
      if (this.end() || this.peek().type === 'NL' || this.peek().type === 'EOF' || this.peek().type === 'SEMI') {
        return { type: 'SET_RELATION', expression: null, intoAlias: null };
      }
      const parts: string[] = [];
      while (!this.end() && !this.peekKw('INTO') && this.peek().type !== 'NL' && this.peek().type !== 'EOF') {
        parts.push(this.peek().val); this.adv();
      }
      this.expectKw('INTO');
      const intoAlias = this.ident();
      return { type: 'SET_RELATION', expression: parts.join(''), intoAlias };
    }
    this.expectKw('FILTER');
    this.expectKw('TO');
    // rest of line is the filter expression (raw SQL-compatible)
    const parts: string[] = [];
    while (!this.end() && this.peek().type !== 'NL' && this.peek().type !== 'SEMI' && this.peek().type !== 'EOF') {
      const t = this.peek();
      // Re-quote string literals so they become valid SQL (e.g. 'Alice' not bare Alice)
      parts.push(t.type === 'STR' ? `'${t.val.replace(/'/g, "''")}'` : t.val);
      this.adv();
    }
    return { type: 'SET_FILTER', expr: parts.length ? parts.join(' ') : null };
  }

  private parseSort(): ASTNode {
    this.adv(); // SORT
    this.expectKw('ON');
    const field = this.ident();
    // Optional direction qualifier: /D (descending) or /A (ascending).
    // The lexer splits `field/D` into ID, OP('/'), ID('D').
    let descending = false;
    if (this.peek().type === 'OP' && this.peek().val === '/') {
      this.adv(); // '/'
      const dir = this.ident().toUpperCase();
      descending = dir === 'D';
    }
    if (!field) throw new Error('SORT requires a field before TO');
    this.expectKw('TO');
    const target = this.ident();
    if (!target) throw new Error('SORT requires a target table after TO');
    return { type: 'SORT', field, descending, target };
  }

  private parseIndexOn(): ASTNode {
    this.adv(); // INDEX
    this.expectKw('ON');
    // Collect expression tokens until TO keyword
    const parts: string[] = [];
    while (!this.end() && !this.peekKw('TO') && this.peek().type !== 'NL' && this.peek().type !== 'EOF') {
      parts.push(this.peek().val);
      this.adv();
    }
    if (!parts.length) throw new Error('INDEX ON requires an expression before TO');
    this.expectKw('TO');
    const tag = this.ident();
    return { type: 'INDEX_ON', expression: parts.join(''), tag };
  }

  private parseReplace(): ASTNode {
    this.adv();
    const scope = this.peekKw('ALL') ? (this.adv(), 'ALL' as const) : 'CURRENT' as const;
    const fields: Array<{ field: string; value: Expr }> = [];
    do {
      const field = this.ident();
      this.expectKw('WITH');
      fields.push({ field, value: this.expr() });
    } while (this.peek().type === 'COMMA' && (this.adv(), true));
    return { type: 'REPLACE_ALL', fields, scope };
  }

  private parseGo(): ASTNode {
    this.adv();
    if (this.peekKw('TOP'))    { this.adv(); return { type: 'GO', target: 'TOP' }; }
    if (this.peekKw('BOTTOM')) { this.adv(); return { type: 'GO', target: 'BOTTOM' }; }
    const n = this.tryNum();
    return { type: 'GO', target: n ?? 1 };
  }

  private parseStore(): ASTNode {
    this.adv();
    const value = this.expr();
    this.expectKw('TO');
    const varName = this.ident();
    return { type: 'STORE', value, varName };
  }

  private parseInput(): ASTNode {
    this.adv();
    const prompt = this.peek().type === 'STR' ? (this.adv(), this.prev().val) : '';
    if (this.peekKw('TO')) this.adv();
    const varName = this.ident();
    return { type: 'INPUT', prompt, varName };
  }

  private parseIf(): ASTNode {
    this.adv();
    const cond = this.expr();
    this.skipNlSemi();
    const body: ASTNode[] = [];
    const elseBody: ASTNode[] = [];
    let inElse = false;
    while (!this.end()) {
      this.skipNlSemi();
      if (this.peekKw('ENDIF') || this.peekKw('ENDIF;')) { this.adv(); break; }
      if (this.peekKw('ELSE')) { this.adv(); inElse = true; continue; }
      const n = this.stmt();
      if (n) (inElse ? elseBody : body).push(n);
    }
    return { type: 'IF', cond, body, elseBody };
  }

  private parseDo(): ASTNode {
    this.adv();
    if (this.peekKw('CASE')) {
      return this.parseDoCase();
    }
    if (!this.peekKw('WHILE')) {
      return { type: 'DO_PRG', name: this.ident() };
    }
    this.expectKw('WHILE');
    const cond = this.expr();
    this.skipNlSemi();
    const body: ASTNode[] = [];
    while (!this.end()) {
      this.skipNlSemi();
      if (this.peekKw('ENDDO')) { this.adv(); break; }
      const n = this.stmt();
      if (n) body.push(n);
    }
    return { type: 'DO_WHILE', cond, body };
  }

  private parseDoCase(): ASTNode {
    this.adv(); // consume CASE
    this.skipNlSemi();
    const cases: Array<{ cond: Expr; body: ASTNode[] }> = [];
    const otherwise: ASTNode[] = [];

    while (!this.end()) {
      this.skipNlSemi();
      if (this.peekKw('ENDCASE')) { this.adv(); break; }
      if (this.peekKw('OTHERWISE')) {
        this.adv();
        this.skipNlSemi();
        while (!this.end()) {
          this.skipNlSemi();
          if (this.peekKw('ENDCASE')) { this.adv(); break; }
          const n = this.stmt();
          if (n) otherwise.push(n);
        }
        break;
      }
      if (this.peekKw('CASE')) {
        this.adv();
        const cond = this.expr();
        this.skipNlSemi();
        const body: ASTNode[] = [];
        while (!this.end()) {
          this.skipNlSemi();
          if (this.peekKw('CASE') || this.peekKw('OTHERWISE') || this.peekKw('ENDCASE')) break;
          const n = this.stmt();
          if (n) body.push(n);
        }
        cases.push({ cond, body });
        continue;
      }
      // unexpected token inside DO CASE — skip
      this.adv();
    }
    return { type: 'DO_CASE', cases, otherwise };
  }

  private parseCreate(): ASTNode {
    this.adv();
    if (this.peekKw('REPORT')) { this.adv(); return { type: 'CREATE_REPORT', name: this.ident() }; }
    this.skipKw('TABLE');
    const name = this.ident();
    const cols: ColDef[] = [];
    if (this.peek().type === 'LPAREN') {
      this.adv();
      while (!this.end() && this.peek().type !== 'RPAREN') {
        const cname = this.ident();
        const ctype = this.ident();
        let size: number | undefined;
        if (this.peek().type === 'LPAREN') {
          this.adv();
          size = this.tryNum() ?? undefined;
          if (this.peek().type === 'RPAREN') this.adv();
        }
        cols.push({ name: cname, colType: ctype, size });
        if (this.peek().type === 'COMMA') this.adv();
      }
      if (this.peek().type === 'RPAREN') this.adv();
    }
    return { type: 'CREATE_TABLE', name, cols };
  }

  private parseDrop(): ASTNode {
    this.adv();
    this.skipKw('TABLE');
    return { type: 'DROP_TABLE', name: this.ident() };
  }

  private parseAt(): ASTNode {
    this.adv();
    const row = this.expr();
    if (this.peek().type === 'COMMA') this.adv();
    const col = this.expr();
    this.expectKw('SAY');
    const text = this.expr();
    if (this.peekKw('GET')) {
      this.adv();
      const varName = this.ident();
      return { type: 'AT_SAY_GET', row, col, text, varName };
    }
    return { type: 'AT_SAY', row, col, text };
  }

  // ── Expression Parser ───────────────────────────────────────────────────

  private expr(): Expr { return this.exprOr(); }

  private exprOr(): Expr {
    let l = this.exprAnd();
    while (this.peekKw('OR')) {
      this.adv(); const r = this.exprAnd();
      l = { k: 'bin', op: 'OR', l, r };
    }
    return l;
  }

  private exprAnd(): Expr {
    let l = this.exprNot();
    while (this.peekKw('AND')) {
      this.adv(); const r = this.exprNot();
      l = { k: 'bin', op: 'AND', l, r };
    }
    return l;
  }

  private exprNot(): Expr {
    if (this.peekKw('NOT')) { this.adv(); return { k: 'not', e: this.exprCmp() }; }
    return this.exprCmp();
  }

  private exprCmp(): Expr {
    let l = this.exprAdd();
    const ops = ['==','!=','<>','<=','>=','<','>','='];
    while (this.peek().type === 'OP' && ops.includes(this.peek().val)) {
      const op = this.adv().val; const r = this.exprAdd();
      l = { k: 'bin', op: op === '<>' ? '!=' : op, l, r };
    }
    return l;
  }

  private exprAdd(): Expr {
    let l = this.exprMul();
    while (this.peek().type === 'OP' && (this.peek().val === '+' || this.peek().val === '-')) {
      const op = this.adv().val; const r = this.exprMul();
      l = { k: 'bin', op, l, r };
    }
    return l;
  }

  private exprMul(): Expr {
    let l = this.exprUnary();
    while (this.peek().type === 'OP' && (this.peek().val === '*' || this.peek().val === '/')) {
      const op = this.adv().val; const r = this.exprUnary();
      l = { k: 'bin', op, l, r };
    }
    return l;
  }

  private exprUnary(): Expr {
    if (this.peek().type === 'OP' && this.peek().val === '-') {
      this.adv();
      const e = this.exprAtom();
      if (e.k === 'lit' && typeof e.v === 'number') return { k: 'lit', v: -e.v };
      return { k: 'bin', op: '*', l: { k: 'lit', v: -1 }, r: e };
    }
    return this.exprAtom();
  }

  private exprAtom(): Expr {
    const t = this.peek();
    if (t.type === 'STR')  { this.adv(); return { k: 'lit', v: t.val }; }
    if (t.type === 'NUM')  { this.adv(); return { k: 'lit', v: parseFloat(t.val) }; }
    if (t.val === 'TRUE'  || (t.type === 'BOOL' && t.val === 'TRUE'))  { this.adv(); return { k: 'lit', v: true }; }
    if (t.val === 'FALSE' || (t.type === 'BOOL' && t.val === 'FALSE')) { this.adv(); return { k: 'lit', v: false }; }
    if (t.type === 'LPAREN') {
      this.adv(); const e = this.expr();
      if (this.peek().type === 'RPAREN') this.adv();
      return e;
    }
    if (t.type === 'ID' || t.type === 'KW') {
      this.adv();
      // Function call: known built-in name immediately followed by (
      if (this.peek().type === 'LPAREN' && BUILTIN_FUNCTIONS.has(t.val.toUpperCase())) {
        this.adv(); // consume (
        const args: Expr[] = [];
        while (!this.end() && this.peek().type !== 'RPAREN') {
          args.push(this.expr());
          if (this.peek().type === 'COMMA') this.adv();
        }
        if (this.peek().type === 'RPAREN') this.adv(); // consume )
        return { k: 'call', fn: t.val.toUpperCase(), args };
      }
      // alias.field dot notation: ID DOT ID
      if (this.peek().type === 'DOT') {
        this.adv(); // consume DOT
        const field = this.peek().val; this.adv();
        return { k: 'var', name: `${t.val}.${field}` };
      }
      return { k: 'var', name: t.val };
    }
    this.adv(); return { k: 'lit', v: '' };
  }

  // ── Helpers ─────────────────────────────────────────────────────────────

  private peek(): Token { return this.toks[this.p] ?? { type: 'EOF', val: '', line: 0, col: 0 }; }
  private prev(): Token { return this.toks[this.p - 1] ?? { type: 'EOF', val: '', line: 0, col: 0 }; }
  private adv(): Token  { const t = this.peek(); if (!this.end()) this.p++; return t; }
  private end(): boolean { return this.peek().type === 'EOF'; }
  private peekKw(kw: string) { const t = this.peek(); return (t.type === 'KW' || t.type === 'ID') && t.val.toUpperCase() === kw.toUpperCase(); }
  private skipKw(kw: string) { if (this.peekKw(kw)) this.adv(); }
  private expectKw(kw: string) { if (this.peekKw(kw)) this.adv(); }
  private skipNl()     { while (this.peek().type === 'NL') this.adv(); }
  private skipNlSemi() { while (this.peek().type === 'NL' || this.peek().type === 'SEMI') this.adv(); }
  private skipLine()   { while (!this.end() && this.peek().type !== 'NL' && this.peek().type !== 'SEMI') this.adv(); }
  private ident(): string { const t = this.adv(); return t.val; }
  private tryNum(): number | null {
    if (this.peek().type === 'NUM') return parseFloat(this.adv().val);
    // Handle negative: OP '-' followed immediately by NUM
    if (this.peek().type === 'OP' && this.peek().val === '-') {
      const saved = this.p;
      this.adv(); // consume '-'
      if (this.peek().type === 'NUM') return -parseFloat(this.adv().val);
      this.p = saved; // backtrack
    }
    return null;
  }
  private consumeScope(): 'ALL' | 'CURRENT' {
    if (this.peekKw('ALL')) { this.adv(); return 'ALL'; }
    return 'CURRENT';
  }
}
