import { describe, it, expect } from 'vitest';
import { ReportRunner } from '../server/ReportRunner.js';
import type { ReportDef } from '../src/shared/types.js';

const runner = new ReportRunner();

const DEF: ReportDef = {
  title: 'Employee Report',
  pageWidth: 80,
  columns: [
    { field: 'name',   heading: 'Name',   width: 20 },
    { field: 'dept',   heading: 'Dept',   width: 15 },
    { field: 'salary', heading: 'Salary', width: 10, total: true },
  ],
  groupBy: 'dept',
  pageHeader: 'Confidential',
  pageFooter: 'Page {PAGE}',
};

const ROWS = [
  { name: 'Alice Moreau',  dept: 'Engineering', salary: 92000 },
  { name: 'Carol Smith',   dept: 'Engineering', salary: 105000 },
  { name: 'Bob Tanaka',    dept: 'Marketing',   salary: 74000 },
];

describe('ReportRunner', () => {
  it('returns ascii and html strings', () => {
    const { ascii, html } = runner.run(DEF, ROWS);
    expect(typeof ascii).toBe('string');
    expect(typeof html).toBe('string');
  });

  it('ascii includes title and page header', () => {
    const { ascii } = runner.run(DEF, ROWS);
    expect(ascii).toContain('Employee Report');
    expect(ascii).toContain('Confidential');
  });

  it('ascii includes column headings', () => {
    const { ascii } = runner.run(DEF, ROWS);
    expect(ascii).toContain('Name');
    expect(ascii).toContain('Dept');
    expect(ascii).toContain('Salary');
  });

  it('ascii includes all row data', () => {
    const { ascii } = runner.run(DEF, ROWS);
    expect(ascii).toContain('Alice Moreau');
    expect(ascii).toContain('Carol Smith');
    expect(ascii).toContain('Bob Tanaka');
  });

  it('ascii includes group subtotals', () => {
    const { ascii } = runner.run(DEF, ROWS);
    // Engineering subtotal = 92000 + 105000 = 197000
    expect(ascii).toContain('197000');
    expect(ascii).toContain('Engineering');
  });

  it('ascii includes grand total', () => {
    const { ascii } = runner.run(DEF, ROWS);
    // Grand total = 92000 + 105000 + 74000 = 271000
    expect(ascii).toContain('271000');
  });

  it('ascii includes page footer with page number', () => {
    const { ascii } = runner.run(DEF, ROWS);
    expect(ascii).toContain('Page 1');
  });

  it('handles empty result set', () => {
    const { ascii } = runner.run(DEF, []);
    expect(ascii).toContain('(No records)');
  });

  it('skips missing fields gracefully', () => {
    const { ascii } = runner.run(DEF, [{ name: 'Alice', dept: 'Eng' }]); // salary missing
    expect(ascii).toContain('Alice');
  });

  it('html contains a table element', () => {
    const { html } = runner.run(DEF, ROWS);
    expect(html).toContain('<table');
    expect(html).toContain('</table>');
  });

  it('html contains title', () => {
    const { html } = runner.run(DEF, ROWS);
    expect(html).toContain('Employee Report');
  });
});
