import { describe, it, expect } from 'vitest';
import { Session } from '../server/Session';
import type { ServerMessage } from '../src/shared/types.js';

// Exercises built-in functions THROUGH the parser+executor (not callStateless
// directly), the way the REPL actually does — catches the parser-whitelist gap
// where an implemented builtin isn't registered in Parser.BUILTIN_FUNCTIONS.
async function evalPrint(expr: string): Promise<string> {
  const sent: ServerMessage[] = [];
  const session = new Session((m) => sent.push(m));
  await session.handleMessage({ type: 'command', text: `? ${expr}` });
  return (sent.filter(m => m.type === 'output') as Extract<ServerMessage, { type: 'output' }>[])
    .flatMap(m => m.lines.map(l => l.text))
    .join('\n');
}

describe('built-in functions reachable through the REPL parser', () => {
  it('ROUND', async () => { expect(await evalPrint('ROUND(3.14159, 2)')).toContain('3.14'); });
  it('MOD', async () => { expect(await evalPrint('MOD(17, 5)')).toContain('2'); });
  it('MAX', async () => { expect(await evalPrint('MAX(3, 9)')).toContain('9'); });
  it('MIN', async () => { expect(await evalPrint('MIN(3, 9)')).toContain('3'); });
  it('TIME', async () => { expect(await evalPrint('TIME()')).toMatch(/\d\d:\d\d:\d\d/); });
  it('YEAR', async () => { expect(await evalPrint('YEAR(CTOD("12/25/2026"))')).toContain('2026'); });
  it('MONTH', async () => { expect(await evalPrint('MONTH(CTOD("12/25/2026"))')).toContain('12'); });
  it('DAY', async () => { expect(await evalPrint('DAY(CTOD("12/25/2026"))')).toContain('25'); });
  it('WEEK', async () => { expect(await evalPrint('WEEK("2024-05-12")')).toContain('19'); });
  it('WEEK across a year boundary', async () => { expect(await evalPrint('WEEK("2021-01-01")')).toContain('53'); });
  it('DATEADD', async () => { expect(await evalPrint('DATEADD("2024-01-31", 1)')).toContain('2024-02-01'); });
  it('DATEADD composes with CTOD', async () => { expect(await evalPrint('DATEADD(CTOD("05/12/24"), 4)')).toContain('2024-05-16'); });
});
