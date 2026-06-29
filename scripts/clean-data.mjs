// Removes scratch user databases from data/, keeping the system store.
//
// Tests (and the GIF/screenshot helpers) create databases in data/ that are
// never cleaned up, so the directory accumulates hundreds of *.sqlite3 / -shm /
// -wal files over time. This deletes every data/*.sqlite3* EXCEPT system.sqlite3
// (the program/index/report store) and .gitkeep.
//
// Used by `npm run clean:data` and by the Playwright global teardown.
import fs from 'node:fs';
import path from 'node:path';

const KEEP = /^system\.sqlite3(-shm|-wal)?$/;

export function cleanData(dataDir = path.join(process.cwd(), 'data')) {
  if (!fs.existsSync(dataDir)) return 0;
  let removed = 0;
  for (const f of fs.readdirSync(dataDir)) {
    if (!/\.sqlite3(-shm|-wal)?$/.test(f)) continue; // only sqlite artifacts
    if (KEEP.test(f)) continue;                       // keep the system store
    fs.rmSync(path.join(dataDir, f), { force: true });
    removed++;
  }
  return removed;
}

// Run directly: `node scripts/clean-data.mjs`
if (import.meta.url === `file://${process.argv[1]}`) {
  const n = cleanData();
  console.log(`clean:data — removed ${n} scratch database file(s) (kept system.sqlite3).`);
}
