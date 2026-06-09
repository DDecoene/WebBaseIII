import type { ReportDef, ReportColumn } from '../src/shared/types.js';

function pad(val: unknown, width: number): string {
  const s = val == null ? '' : String(val);
  return s.length >= width ? s.slice(0, width) : s + ' '.repeat(width - s.length);
}

function rpad(val: unknown, width: number): string {
  const s = val == null ? '' : String(val);
  return s.length >= width ? s.slice(0, width) : ' '.repeat(width - s.length) + s;
}

function fieldVal(row: Record<string, unknown>, field: string): unknown {
  return row[field] ?? row[field.toUpperCase()] ?? row[field.toLowerCase()] ?? '';
}

export class ReportRunner {
  run(def: ReportDef, rows: Record<string, unknown>[]): { ascii: string; html: string } {
    const cols = def.columns;
    const pageWidth = def.pageWidth ?? 80;
    const lines: string[] = [];

    // Header
    if (def.pageHeader) lines.push(def.pageHeader);
    lines.push(def.title ?? '');
    lines.push('');

    // Column headings
    lines.push(cols.map(c => pad(c.heading, c.width)).join('  '));
    lines.push(cols.map(c => '-'.repeat(c.width)).join('  '));

    if (rows.length === 0) {
      lines.push('(No records)');
    } else {
      const grandTotals: Map<number, number> = new Map();
      cols.forEach((c, i) => { if (c.total) grandTotals.set(i, 0); });

      let currentGroup: unknown = undefined;
      const groupTotals: Map<number, number> = new Map();
      cols.forEach((c, i) => { if (c.total) groupTotals.set(i, 0); });

      const flushGroup = (groupVal: unknown) => {
        if (def.groupBy && currentGroup !== undefined) {
          const sep = '-'.repeat(pageWidth);
          lines.push(sep);
          const totPart = cols.map((c, i) => {
            if (c.total) return rpad((groupTotals.get(i) ?? 0).toFixed(2), c.width);
            return ' '.repeat(c.width);
          }).join('  ').trimStart();
          lines.push(`** ${groupVal} **  ${totPart}`);
          lines.push('');
          cols.forEach((_, i) => { if (groupTotals.has(i)) groupTotals.set(i, 0); });
        }
      };

      for (const row of rows) {
        const groupVal = def.groupBy ? fieldVal(row, def.groupBy) : undefined;
        if (def.groupBy && groupVal !== currentGroup) {
          flushGroup(currentGroup);
          currentGroup = groupVal;
        }
        lines.push(cols.map((c, i) => {
          const v = fieldVal(row, c.field);
          if (c.total) {
            const n = Number(v) || 0;
            groupTotals.set(i, (groupTotals.get(i) ?? 0) + n);
            grandTotals.set(i, (grandTotals.get(i) ?? 0) + n);
            return rpad(n.toFixed(2), c.width);
          }
          return pad(v, c.width);
        }).join('  '));
      }
      flushGroup(currentGroup);

      // Grand total
      lines.push('-'.repeat(pageWidth));
      lines.push('** Total **  ' + cols.map((c, i) => {
        if (c.total) return rpad((grandTotals.get(i) ?? 0).toFixed(2), c.width);
        return ' '.repeat(c.width);
      }).join('  ').trimStart());
    }

    // Footer
    if (def.pageFooter) lines.push(def.pageFooter.replace('{PAGE}', '1'));

    const ascii = lines.join('\n');
    const html = this.toHtml(def, rows, cols);
    return { ascii, html };
  }

  private toHtml(def: ReportDef, rows: Record<string, unknown>[], cols: ReportColumn[]): string {
    const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const grandTotals: Map<number, number> = new Map();
    cols.forEach((c, i) => { if (c.total) grandTotals.set(i, 0); });

    let bodyRows = '';
    let currentGroup: unknown = undefined;
    const groupTotals: Map<number, number> = new Map();
    cols.forEach((c, i) => { if (c.total) groupTotals.set(i, 0); });

    const nonTotalCols = cols.filter(c => !c.total).length;

    const flushGroupHtml = (groupVal: unknown) => {
      if (def.groupBy && currentGroup !== undefined) {
        bodyRows += `<tr class="subtotal"><td colspan="${nonTotalCols}"><strong>** ${esc(groupVal)} **</strong></td>`;
        cols.forEach((c, i) => {
          if (c.total) bodyRows += `<td class="num"><strong>${(groupTotals.get(i) ?? 0).toFixed(2)}</strong></td>`;
        });
        bodyRows += '</tr>';
        cols.forEach((_, i) => { if (groupTotals.has(i)) groupTotals.set(i, 0); });
      }
    };

    if (rows.length === 0) {
      bodyRows = `<tr><td colspan="${cols.length}">(No records)</td></tr>`;
    } else {
      for (const row of rows) {
        const groupVal = def.groupBy ? (row[def.groupBy] ?? row[def.groupBy.toUpperCase()] ?? row[def.groupBy.toLowerCase()] ?? '') : undefined;
        if (def.groupBy && groupVal !== currentGroup) {
          flushGroupHtml(currentGroup);
          currentGroup = groupVal;
        }
        bodyRows += '<tr>' + cols.map((c, i) => {
          const v = row[c.field] ?? row[c.field.toUpperCase()] ?? row[c.field.toLowerCase()] ?? '';
          if (c.total) {
            const n = Number(v) || 0;
            groupTotals.set(i, (groupTotals.get(i) ?? 0) + n);
            grandTotals.set(i, (grandTotals.get(i) ?? 0) + n);
            return `<td class="num">${esc(n.toFixed(2))}</td>`;
          }
          return `<td>${esc(v)}</td>`;
        }).join('') + '</tr>';
      }
      flushGroupHtml(currentGroup);
      bodyRows += `<tr class="grandtotal"><td colspan="${nonTotalCols}"><strong>** Total **</strong></td>`;
      cols.forEach((c, i) => {
        if (c.total) bodyRows += `<td class="num"><strong>${(grandTotals.get(i) ?? 0).toFixed(2)}</strong></td>`;
      });
      bodyRows += '</tr>';
    }

    return `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>${esc(def.title)}</title>
<style>
  body { font-family: monospace; padding: 2rem; background: #fff; color: #000; }
  h1 { font-size: 1.2rem; margin-bottom: 0.25rem; }
  .pageheader { color: #666; font-size: 0.9rem; margin-bottom: 1rem; }
  table { border-collapse: collapse; width: 100%; }
  th { border-bottom: 2px solid #333; text-align: left; padding: 4px 8px; }
  td { padding: 2px 8px; }
  .num { text-align: right; }
  tr.subtotal td { border-top: 1px solid #999; background: #f5f5f5; }
  tr.grandtotal td { border-top: 2px solid #333; background: #eee; }
  .footer { margin-top: 1rem; font-size: 0.85rem; color: #666; }
  @media print { body { padding: 0; } }
</style>
</head><body>
${def.pageHeader ? `<div class="pageheader">${esc(def.pageHeader)}</div>` : ''}
<h1>${esc(def.title)}</h1>
<table>
<thead><tr>${cols.map(c => `<th>${esc(c.heading)}</th>`).join('')}</tr></thead>
<tbody>${bodyRows}</tbody>
</table>
${def.pageFooter ? `<div class="footer">${esc(def.pageFooter.replace('{PAGE}', '1'))}</div>` : ''}
</body></html>`;
  }
}
