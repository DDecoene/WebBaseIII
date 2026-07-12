import type { IDatabaseBridge } from '../shared/types';
import type { Lookup, LookupOption } from '../shared/cellValidation';

export const LOOKUP_MAX_VALUES = 1000;

function q(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/**
 * Resolve a lookup to concrete {value,label} options, or null when it cannot
 * be honoured (missing table/column, empty source, or over the ceiling).
 * Callers degrade to free text and skip membership enforcement on null —
 * an unresolvable lookup is a warning, not a lock. Never truncates: a clipped
 * option list would hide legal values while membership validation rejected them.
 */
export async function resolveLookup(db: IDatabaseBridge, lookup: Lookup): Promise<LookupOption[] | null> {
  if (lookup.kind === 'list') {
    return lookup.values.map(v => ({ value: v, label: v }));
  }
  if (!(await db.tableExists(lookup.table))) return null;
  const cols = await db.getStructure(lookup.table);
  const valueCol = cols.find(c => c.name.toUpperCase() === lookup.column.toUpperCase());
  if (!valueCol) return null;
  let displayCol;
  if (lookup.display) {
    displayCol = cols.find(c => c.name.toUpperCase() === lookup.display!.toUpperCase());
    if (!displayCol) return null;
  }
  const sel = displayCol ? `${q(valueCol.name)}, ${q(displayCol.name)}` : q(valueCol.name);
  const rows = await db.query(
    `SELECT DISTINCT ${sel} FROM ${q(lookup.table)} ORDER BY 1 LIMIT ${LOOKUP_MAX_VALUES + 1}`
  );
  const options: LookupOption[] = [];
  for (const r of rows) {
    const value = String(r[valueCol.name] ?? '');
    if (value === '') continue;                      // NULL/empty is not a pickable value
    const label = displayCol ? String(r[displayCol.name] ?? value) : value;
    options.push({ value, label });
  }
  if (options.length === 0 || options.length > LOOKUP_MAX_VALUES) return null;
  return options;
}
