import fs from 'fs';
import path from 'path';
import { programStore } from './ProgramStore.js';

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
