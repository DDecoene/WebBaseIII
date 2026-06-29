import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import * as os from 'os';
import path from 'path';
import { seedDemoPrograms, seedDemoReports } from '../server/DemoSeeder';
import { programStore } from '../server/ProgramStore';
import { reportStore } from '../server/ReportStore';

describe('seedDemoPrograms', () => {
  it('upserts every demos/*.prg into the program store, demos winning over store edits', () => {
    // Simulate a drifted store copy — the file must win
    programStore.save('inventory', '* user-modified copy');

    const seeded = seedDemoPrograms();

    const expected = fs.readFileSync(path.join(process.cwd(), 'demos', 'INVENTORY.prg'), 'utf8');
    expect(seeded).toContain('inventory');
    expect(programStore.load('inventory')).toBe(expected);
  });

  it('seeds all .prg files in demos/ under their lowercased basename', () => {
    const names = fs.readdirSync(path.join(process.cwd(), 'demos'))
      .filter(f => f.toLowerCase().endsWith('.prg'))
      .map(f => path.basename(f, path.extname(f)).toLowerCase());

    const seeded = seedDemoPrograms();

    expect(seeded.sort()).toEqual(names.sort());
    for (const name of names) {
      expect(programStore.load(name)).not.toBeNull();
    }
  });
});

describe('seedDemoReports', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb3-reports-'));
  });

  it('seeds each *.json into the report store under its lowercased basename', () => {
    const def = JSON.stringify({ title: 'X', columns: [{ field: 'A', heading: 'A', width: 5 }] });
    fs.writeFileSync(path.join(dir, 'MyReport.json'), def);
    const seeded = seedDemoReports(dir);
    expect(seeded).toContain('myreport');
    expect(reportStore.load('myreport')).toBe(def);
  });

  it('ignores non-json files and returns [] for a missing dir', () => {
    fs.writeFileSync(path.join(dir, 'notes.txt'), 'hi');
    expect(seedDemoReports(dir)).toEqual([]);
    expect(seedDemoReports(path.join(dir, 'nope'))).toEqual([]);
  });
});
