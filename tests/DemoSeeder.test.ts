import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { seedDemoPrograms } from '../server/DemoSeeder';
import { programStore } from '../server/ProgramStore';

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
