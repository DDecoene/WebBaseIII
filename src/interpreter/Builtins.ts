/**
 * Stateless dBASE III built-in functions.
 * All args are already-evaluated values (string | number | boolean).
 * Throws on unknown function name so Executor can distinguish from stateful functions.
 */
export function callStateless(fn: string, args: unknown[]): unknown {
  const s = (i: number) => String(args[i] ?? '');
  const n = (i: number) => Number(args[i] ?? 0);

  switch (fn) {
    case 'SUBSTR': {
      const str = s(0);
      const start = Math.max(1, n(1));
      const len = args[2] !== undefined ? n(2) : undefined;
      return len !== undefined ? str.slice(start - 1, start - 1 + len) : str.slice(start - 1);
    }
    case 'LEN':       return s(0).length;
    case 'TRIM':      return s(0).trim();
    case 'LTRIM':     return s(0).trimStart();
    case 'UPPER':     return s(0).toUpperCase();
    case 'LOWER':     return s(0).toLowerCase();
    case 'AT': {
      const idx = s(1).indexOf(s(0));
      return idx === -1 ? 0 : idx + 1;
    }
    case 'STR': {
      const num = n(0);
      const len = args[1] !== undefined ? n(1) : 10;
      const dec = args[2] !== undefined ? n(2) : 0;
      const formatted = num.toFixed(dec);
      if (formatted.length > len) return '*'.repeat(len);
      return formatted.padStart(len);
    }
    case 'VAL': {
      const parsed = parseFloat(s(0));
      return isNaN(parsed) ? 0 : parsed;
    }
    case 'INT':       return Math.trunc(n(0));
    case 'ABS':       return Math.abs(n(0));
    case 'SPACE':     return ' '.repeat(Math.max(0, n(0)));
    case 'REPLICATE': return s(0).repeat(Math.max(0, n(1)));
    case 'DATE': {
      const d = new Date();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      const yy = String(d.getFullYear()).slice(-2);
      return `${mm}/${dd}/${yy}`;
    }
    case 'DTOC': {
      // Accept ISO (YYYY-MM-DD) or already MM/DD/YY
      const raw = s(0);
      const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (isoMatch) return `${isoMatch[2]}/${isoMatch[3]}/${isoMatch[1].slice(-2)}`;
      return raw; // already display format
    }
    case 'CTOD': {
      // MM/DD/YY → YYYY-MM-DD
      const raw = s(0);
      const m = raw.match(/^(\d{2})\/(\d{2})\/(\d{2})$/);
      if (!m) return raw;
      const century = parseInt(m[3]) >= 70 ? '19' : '20';
      return `${century}${m[3]}-${m[1]}-${m[2]}`;
    }
    case 'ROUND': {
      const num = n(0);
      // If decimals isn't provided, default to 0
      const dec = args[1] !== undefined ? n(1) : 0; 
      const multiplier = Math.pow(10, dec);
      return Math.round(num * multiplier) / multiplier;
    }
    case 'MOD':       return n(0) % n(1);
    case 'MAX':       return Math.max(n(0), n(1));
    case 'MIN':       return Math.min(n(0), n(1));

    case 'TIME': {
      const d = new Date();
      const hh = String(d.getHours()).padStart(2, '0');
      const mm = String(d.getMinutes()).padStart(2, '0');
      const ss = String(d.getSeconds()).padStart(2, '0');
      return `${hh}:${mm}:${ss}`;
    }

    case 'YEAR': {
      const d = new Date(s(0));
      return isNaN(d.getTime()) ? 0 : d.getFullYear();
    }
    case 'MONTH': {
      const d = new Date(s(0));
      return isNaN(d.getTime()) ? 0 : d.getMonth() + 1;
    }
    case 'DAY': {
      const d = new Date(s(0));
      return isNaN(d.getTime()) ? 0 : d.getDate();
    }
    default:
      throw new Error(`Unknown function: ${fn}`);
  }
}
