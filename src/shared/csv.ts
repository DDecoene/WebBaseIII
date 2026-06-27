export const MAX_IMPORT_BYTES = 5 * 1024 * 1024; // 5 MB
export const MAX_EXPORT_ROWS = 50000;
export const MAX_IMPORT_SKIPS = 10;

function quoteField(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

// Serialize rows (in the given column order) to RFC-4180 CSV with a header row.
export function toCSV(columns: string[], rows: Record<string, unknown>[]): string {
  const lines = [columns.map(quoteField).join(',')];
  for (const row of rows) {
    lines.push(columns.map(c => quoteField(row[c])).join(','));
  }
  return lines.join('\r\n');
}

// Parse RFC-4180 CSV into a header array + array of string-cell rows.
export function parseCSV(text: string): { header: string[]; rows: string[][] } {
  const records: string[][] = [];
  let field = '';
  let record: string[] = [];
  let inQuotes = false;
  let i = 0;
  const pushField = () => { record.push(field); field = ''; };
  const pushRecord = () => { pushField(); records.push(record); record = []; };

  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += ch; i++; continue;
    }
    if (ch === '"') { inQuotes = true; i++; continue; }
    if (ch === ',') { pushField(); i++; continue; }
    if (ch === '\r') { if (text[i + 1] === '\n') i++; pushRecord(); i++; continue; }
    if (ch === '\n') { pushRecord(); i++; continue; }
    field += ch; i++;
  }
  // flush trailing field/record unless input ended exactly on a newline
  if (field !== '' || record.length > 0) pushRecord();

  const header = records.shift() ?? [];
  return { header, rows: records };
}
