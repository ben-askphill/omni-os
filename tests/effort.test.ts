import { describe, it, expect, beforeAll } from 'vitest';
import { startRunner } from './runner-boot.ts';
import { validateRun, claudeHarness, type Catalog } from '../server/harness/catalog.ts';

let H: Awaited<ReturnType<typeof startRunner>>;

beforeAll(async () => {
  H = await startRunner();
});

describe('effort validation', () => {
  const cat: Catalog = { harnesses: [claudeHarness(4)] };
  it('accepts a supported Claude level and an empty (default) level', () => {
    expect(validateRun(cat, 'claude-code', 'opus', 'xhigh').ok).toBe(true);
    expect(validateRun(cat, 'claude-code', 'opus', '').ok).toBe(true);
  });
  it('rejects an unsupported level with the valid options', () => {
    const r = validateRun(cat, 'claude-code', 'opus', 'ultra');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('does not support effort');
  });
});

describe('effort reaches the Claude CLI', () => {
  it('passes --effort when set', async () => {
    const t = await H.start('do the thing', { effort: 'high' });
    await H.untilResults(t.id, 1);
    const inv = H.invocations().find((i) => i.thread_id === t.id && i.mode === 'stream');
    expect(inv.effort).toBe('high');
  });

  it('passes nothing when effort is the default', async () => {
    const t = await H.start('do the other thing');
    await H.untilResults(t.id, 1);
    const inv = H.invocations().find((i) => i.thread_id === t.id && i.mode === 'stream');
    expect(inv.effort).toBeNull();
    expect(H.thread(t.id).effort).toBe('');
  });

  it('rejects creating a thread with an unsupported effort', async () => {
    await expect(H.runner.createThread({ channel: 'scratch', prompt: 'x', effort: 'ultra' })).rejects.toThrow(/does not support effort/);
  });
});
