/**
 * Declared-column-type validation, shared by the browser grid (fast inline
 * feedback while typing) and the server (the authoritative check on write).
 *
 * Both sides must agree, so the rules live here rather than being duplicated.
 * Returns an error message, or null when the value is acceptable.
 */

export interface ColumnMeta {
  baseType: string;
  qualifier: number | null;  // CHAR(n) length, TIME(n) minute granularity, NUM(p,s) precision
  scale: number | null;      // NUM(p,s) scale
}

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const LOGICAL_VALUES = new Set(['.T.', '.F.', '.TRUE.', '.FALSE.', 'T', 'F', 'TRUE', 'FALSE', '1', '0']);

/** True when y-m-d names a real calendar day (rejects Feb 30, month 13, …). */
export function isRealDate(y: number, m: number, d: number): boolean {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function validateCellValue(
  colName: string,
  value: string,
  meta: ColumnMeta | null | undefined,
): string | null {
  if (!meta) return null;                       // untracked column — no constraint
  const v = value.trim();
  if (v === '') return null;                    // clearing a cell is always allowed

  switch (meta.baseType.toUpperCase()) {
    case 'TIME': {
      const m = TIME_RE.exec(v);
      if (!m) return `${colName}: expected a time as HH:MM (00-23:00-59)`;
      if (meta.qualifier && Number(m[2]) % meta.qualifier !== 0) {
        return `${colName}: minutes must be a multiple of ${meta.qualifier}`;
      }
      return null;
    }

    case 'DATE': {
      const m = ISO_DATE_RE.exec(v);
      if (!m) return `${colName}: expected a date as YYYY-MM-DD`;
      if (!isRealDate(Number(m[1]), Number(m[2]), Number(m[3]))) {
        return `${colName}: "${v}" is not a real date`;
      }
      return null;
    }

    case 'LOGICAL':
    case 'BOOLEAN':
      return LOGICAL_VALUES.has(v.toUpperCase())
        ? null
        : `${colName}: expected a logical value (.T. / .F.)`;

    case 'INT':
    case 'INTEGER':
      return /^[+-]?\d+$/.test(v) ? null : `${colName}: expected a whole number`;

    case 'NUM':
    case 'NUMERIC':
    case 'FLOAT':
    case 'DOUBLE':
    case 'DECIMAL': {
      if (!/^[+-]?(\d+(\.\d*)?|\.\d+)$/.test(v)) return `${colName}: expected a number`;
      const [intPart, decPart = ''] = v.replace(/^[+-]/, '').split('.');
      const scale = meta.scale ?? 0;
      if (meta.scale !== null && decPart.length > meta.scale) {
        return `${colName}: at most ${meta.scale} decimal place(s)`;
      }
      if (meta.qualifier !== null) {
        // NUM(p,s): p is total digits, so p - s bounds the integer part.
        // NUM(p) with no scale: p bounds the integer part directly.
        const maxIntDigits = meta.qualifier - scale;
        const digits = intPart.replace(/^0+(?=\d)/, '');
        if (digits.length > maxIntDigits) {
          return `${colName}: at most ${maxIntDigits} digit(s) before the decimal point`;
        }
      }
      return null;
    }

    default:
      return null;                              // CHAR / MEMO / anything else — unconstrained
  }
}
