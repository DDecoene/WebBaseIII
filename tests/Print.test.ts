import { describe, it, expect } from 'vitest';
import { Session } from '../server/Session';
import type { ServerMessage } from '../src/shared/types.js';

async function run(text: string): Promise<string[]> {
  const sent: ServerMessage[] = [];
  const session = new Session((m) => sent.push(m));
  await session.handleMessage({ type: 'command', text });
  const lines: string[] = [];
  for (const m of sent) {
    if (m.type === 'output') {
      for (const l of (m as { lines: { text: string }[] }).lines) lines.push(l.text);
    }
  }
  return lines;
}

describe('? / ?? print command', () => {
  it('evaluates and prints an arithmetic expression, right-justified', async () => {
    const lines = await run('? 2 + 2');
    const hit = lines.find(l => l.trim() === '4');
    expect(hit).toBeDefined();
    expect(hit!.startsWith(' ')).toBe(true); // numeric output is right-justified
  });

  it('prints a string result without quotes', async () => {
    const lines = await run('? UPPER("hello")');
    expect(lines.some(l => l === 'HELLO')).toBe(true);
  });

  it('prints multiple comma-separated expressions joined by a space', async () => {
    const lines = await run('? "a", "b"');
    expect(lines.some(l => l === 'a b')).toBe(true);
  });

  it('prints a blank line for a bare ?', async () => {
    const lines = await run('?');
    expect(lines.some(l => l === '')).toBe(true);
  });

  it('renders booleans as .T./.F.', async () => {
    const lines = await run('? 1 = 1');
    expect(lines.some(l => l === '.T.')).toBe(true);
  });

  it('?? prints its expression', async () => {
    const lines = await run('?? "x"');
    expect(lines.some(l => l === 'x')).toBe(true);
  });

  it('does not treat ? as an unknown command', async () => {
    const lines = await run('? 7');
    expect(lines.some(l => /unknown|unrecognized|\*\*/i.test(l))).toBe(false);
  });
});
