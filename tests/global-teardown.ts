// Playwright global teardown: after the whole e2e run, remove the scratch
// databases the tests created in data/, keeping only system.sqlite3. Without
// this, every run leaves behind a fresh batch of E2E_*/test db files (#36).
import { cleanData } from '../scripts/clean-data.mjs';

export default function globalTeardown(): void {
  const removed = cleanData();
  console.log(`[global-teardown] removed ${removed} scratch database file(s) from data/.`);
}
