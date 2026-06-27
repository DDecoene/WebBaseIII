export type TType =
  | 'KW' | 'ID' | 'STR' | 'NUM' | 'BOOL'
  | 'OP' | 'COMMA' | 'SEMI' | 'AT' | 'DOT'
  | 'LPAREN' | 'RPAREN' | 'NL' | 'EOF';

export interface Token { type: TType; val: string; line: number; col: number; }

const KWS = new Set([
  'USE','LIST','BROWSE','CLEAR','SET','FILTER','TO','REPLACE','ALL','WITH',
  'APPEND','RECORD','BLANK','READ','IF','ENDIF','ELSE','STORE','SAY','GET',
  'DO','WHILE','ENDDO','RETURN','CLOSE','TABLES','STRUCTURE','DATABASES',
  'DELETE','RECALL','PACK','GO','GOTO','TOP','BOTTOM','SKIP',
  'COUNT','LOCATE','CONTINUE','QUIT','FIELDS','HELP','SUM','AVERAGE','COPY','FROM',
  'AND','OR','NOT','TRUE','FALSE','CREATE','TABLE','DROP','INDEX','ON',
  'INPUT','ACCEPT','DISPLAY','DATABASE','FOR','NEXT',
  'SEEK','FIND','REINDEX','INDEXES','SORT',
  // Multi-work-area
  'SELECT','RELATION','ALIAS','AREAS','INTO',
  // DO CASE control flow
  'CASE','OTHERWISE','ENDCASE',
  // Built-in function names
  'SUBSTR','LEN','TRIM','LTRIM','UPPER','LOWER','AT','STR','VAL',
  'INT','ABS','SPACE','REPLICATE','DATE','DTOC','CTOD',
  'EOF','BOF','FOUND','RECNO','RECCOUNT',
]);

export class Lexer {
  private p = 0; private ln = 1; private col = 1;
  private toks: Token[] = [];

  constructor(private src: string) {}

  tokenize(): Token[] {
    while (this.p < this.src.length) {
      this.skipWs();
      if (this.p >= this.src.length) break;
      const ch = this.src[this.p];

      if (ch === '\n') {
        this.toks.push({ type: 'NL', val: '\n', line: this.ln, col: this.col });
        this.ln++; this.col = 1; this.p++;
        continue;
      }
      if (ch === '\r') { this.p++; continue; }

      // line comment: * at start of line, or &&
      if (ch === '*' && this.atLineStart()) { this.skipToNl(); continue; }
      if (ch === '&' && this.src[this.p + 1] === '&') { this.skipToNl(); continue; }

      if (ch === '"' || ch === "'") { this.toks.push(this.rdStr(ch)); continue; }
      if (this.isDigit(ch)) { this.toks.push(this.rdNum()); continue; }
      if (this.isAlpha(ch) || ch === '_') { this.toks.push(this.rdIdent()); continue; }
      // dBASE boolean literals: .T. .TRUE. .F. .FALSE.
      if (ch === '.') {
        const rest = this.src.slice(this.p + 1).toUpperCase();
        if (rest.startsWith('T.') || rest.startsWith('TRUE.')) {
          const len = rest.startsWith('TRUE.') ? 6 : 3;
          this.toks.push({ type: 'BOOL', val: 'TRUE', line: this.ln, col: this.col });
          this.p += len; this.col += len; continue;
        }
        if (rest.startsWith('F.') || rest.startsWith('FALSE.')) {
          const len = rest.startsWith('FALSE.') ? 7 : 3;
          this.toks.push({ type: 'BOOL', val: 'FALSE', line: this.ln, col: this.col });
          this.p += len; this.col += len; continue;
        }
        // dBASE logical operators: .NOT. .AND. .OR. — same tokens as bare keywords
        if (rest.startsWith('NOT.')) {
          this.toks.push({ type: 'KW', val: 'NOT', line: this.ln, col: this.col });
          this.p += 5; this.col += 5; continue;
        }
        if (rest.startsWith('AND.')) {
          this.toks.push({ type: 'KW', val: 'AND', line: this.ln, col: this.col });
          this.p += 5; this.col += 5; continue;
        }
        if (rest.startsWith('OR.')) {
          this.toks.push({ type: 'KW', val: 'OR', line: this.ln, col: this.col });
          this.p += 4; this.col += 4; continue;
        }
        // Plain dot (alias.field separator)
        this.toks.push({ type: 'DOT', val: '.', line: this.ln, col: this.col });
        this.p++; this.col++;
        continue;
      }

      // dBASE print command: ? (with leading newline) and ?? (no newline)
      if (ch === '?') {
        if (this.src[this.p + 1] === '?') { this.emit('OP', '??'); }
        else { this.emit('OP', '?'); }
        continue;
      }

      if (ch === '@') { this.emit('AT', '@'); continue; }
      if (ch === ',') { this.emit('COMMA', ','); continue; }
      if (ch === ';') { this.emit('SEMI', ';'); continue; }
      if (ch === '(') { this.emit('LPAREN', '('); continue; }
      if (ch === ')') { this.emit('RPAREN', ')'); continue; }

      const op = this.rdOp();
      if (op) { this.toks.push(op); continue; }
      this.p++; this.col++;
    }
    this.toks.push({ type: 'EOF', val: '', line: this.ln, col: this.col });
    return this.toks;
  }

  private emit(type: TType, val: string) {
    this.toks.push({ type, val, line: this.ln, col: this.col });
    this.p += val.length; this.col += val.length;
  }

  private skipWs() {
    while (this.p < this.src.length) {
      const c = this.src[this.p];
      if (c === ' ') { this.col++; this.p++; }
      else if (c === '\t') { this.col += 4; this.p++; }
      else break;
    }
  }

  private atLineStart(): boolean {
    let i = this.p - 1;
    while (i >= 0 && (this.src[i] === ' ' || this.src[i] === '\t')) i--;
    return i < 0 || this.src[i] === '\n';
  }

  private skipToNl() {
    while (this.p < this.src.length && this.src[this.p] !== '\n') { this.p++; this.col++; }
  }

  private rdStr(q: string): Token {
    const c = this.col; this.p++; this.col++;
    let v = '';
    while (this.p < this.src.length && this.src[this.p] !== q) {
      if (this.src[this.p] === '\\') { this.p++; this.col++; v += this.src[this.p] ?? ''; }
      else v += this.src[this.p];
      this.p++; this.col++;
    }
    if (this.p < this.src.length) { this.p++; this.col++; }
    return { type: 'STR', val: v, line: this.ln, col: c };
  }

  private rdNum(): Token {
    const c = this.col; let v = '';
    while (this.p < this.src.length && (this.isDigit(this.src[this.p]) || this.src[this.p] === '.')) {
      v += this.src[this.p]; this.p++; this.col++;
    }
    return { type: 'NUM', val: v, line: this.ln, col: c };
  }

  private rdIdent(): Token {
    const c = this.col; let v = '';
    while (this.p < this.src.length && (this.isAlphaNum(this.src[this.p]) || this.src[this.p] === '_')) {
      v += this.src[this.p]; this.p++; this.col++;
    }
    const up = v.toUpperCase();
    return { type: KWS.has(up) ? 'KW' : 'ID', val: up, line: this.ln, col: c };
  }

  private rdOp(): Token | null {
    const c = this.col; const ch = this.src[this.p]; const nx = this.src[this.p + 1] ?? '';
    const two = ch + nx;
    if (['==','!=','<>','<=','>='].includes(two)) {
      this.p += 2; this.col += 2;
      return { type: 'OP', val: two === '<>' ? '!=' : two, line: this.ln, col: c };
    }
    if ('=<>+*/-!'.includes(ch)) {
      this.p++; this.col++;
      return { type: 'OP', val: ch, line: this.ln, col: c };
    }
    return null;
  }

  private isAlpha(c: string)    { return /[a-zA-Z]/.test(c); }
  private isDigit(c: string)    { return /[0-9]/.test(c); }
  private isAlphaNum(c: string) { return /[a-zA-Z0-9]/.test(c); }
}
