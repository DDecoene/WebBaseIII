import fs from 'fs';
import path from 'path';
import { programStore } from './ProgramStore.js';
import { reportStore } from './ReportStore.js';

const DEMOS_DIR = path.join(process.cwd(), 'demos');

/**
 * Seeds every demos/*.prg into the program store under its lowercased
 * basename, overwriting any existing store copy — the files in demos/ are
 * the single source of truth and win on every server start.
 * Returns the seeded program names.
 */
export function seedDemoPrograms(demosDir = DEMOS_DIR): string[] {
  if (!fs.existsSync(demosDir)) return [];
  const seeded: string[] = [];
  for (const file of fs.readdirSync(demosDir)) {
    if (!file.toLowerCase().endsWith('.prg')) continue;
    const name = path.basename(file, path.extname(file)).toLowerCase();
    programStore.save(name, fs.readFileSync(path.join(demosDir, file), 'utf8'));
    seeded.push(name);
  }
  return seeded;
}

const REPORTS_DIR = path.join(process.cwd(), 'demos', 'reports');

/**
 * Seeds every demos/reports/*.json into the report store under its lowercased
 * basename, overwriting any store copy — like seedDemoPrograms, the files win
 * on every server start. Returns the seeded report names.
 */
export function seedDemoReports(reportsDir = REPORTS_DIR): string[] {
  if (!fs.existsSync(reportsDir)) return [];
  const seeded: string[] = [];
  for (const file of fs.readdirSync(reportsDir)) {
    if (!file.toLowerCase().endsWith('.json')) continue;
    const name = path.basename(file, path.extname(file)).toLowerCase();
    reportStore.save(name, fs.readFileSync(path.join(reportsDir, file), 'utf8'));
    seeded.push(name);
  }
  return seeded;
}
