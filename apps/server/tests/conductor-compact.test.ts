import { beforeAll, describe, expect, it } from 'vitest';
import { startRunner } from './runner-boot.ts';

// Conductor compaction (#1015, runner/conductor-compact.ts): a #conductor thread on any model compacts between turns
// once its context passes the threshold, with a focus that keeps its routing state, and the policy can be turned off.
// The fake CLI sets its context with CTX:<tokens> and drops to 8K on /compact.

let H: Awaited<ReturnType<typeof startRunner>>;
let policy: typeof import('../runner/conductor-compact.ts');
const T = { timeout: 30_000 };

beforeAll(async () => {
  H = await startRunner();
  policy = await import('../runner/conductor-compact.ts');
});

const conductor = (prompt: string, model = 'claude-sonnet-5-5') => H.start(prompt, { channel: 'conductor', role: 'conductor', model });
const users = (id: string) => H.byKind(id, 'user').map((e) => ({ text: e.p.text as string, source: e.p.source as string }));
/** The thread is idle with `n` results, and stays so a moment: nothing else was queued behind them. */
async function settled(id: string, n: number) {
  await H.untilResults(id, n);
  await H.until('idle', () => !['running', 'queued'].includes(H.thread(id).status));
  await new Promise((r) => setTimeout(r, 300));
  expect(H.byKind(id, 'result')).toHaveLength(n);
}

describe('the focus prompt', () => {
  it('keeps open delegations, their task ids, who waits on what and pending questions', () => {
    const f = policy.CONDUCTOR_COMPACT_FOCUS;
    expect(f).toMatch(/open delegation/);
    expect(f).toMatch(/task id/);
    expect(f).toMatch(/thread id/);
    expect(f).toMatch(/who waits on what/);
    expect(f).toMatch(/questions still waiting/);
    expect(f).not.toMatch(/\bBen\b/);
  });

  it('rides on Claude Code’s /compact, and Codex’s takes none', () => {
    expect(policy.compactMessage({ harness: 'claude-code' })).toBe(`/compact ${policy.CONDUCTOR_COMPACT_FOCUS}`);
    expect(policy.compactMessage({ harness: 'codex' })).toBe('/compact');
  });

  it('applies only where the harness has a compact command', () => {
    const t = { channel_id: 'conductor', source: 'ben', parent_id: null, quick: 0, id: 'none' } as any;
    for (const harness of ['cursor', 'cursor-cloud', 'hermes', 'antigravity', 'custom:acme']) expect(policy.compactDue({ ...t, harness }, 1)).toBe(false);
  });
});

describe('a #conductor thread', () => {
  it('on Sonnet compacts once it passes the threshold, with the focus, and only once', T, async () => {
    const t = await conductor('CTX:120000 route the release');
    await settled(t.id, 2);
    const [first, compact] = users(t.id);
    expect(first.text).toBe('CTX:120000 route the release');
    expect(compact).toEqual({ text: `/compact ${policy.CONDUCTOR_COMPACT_FOCUS}`, source: 'omni' });
    // The CLI read the focus as its /compact instructions.
    expect(H.claudeTexts(t.id).at(-1)).toBe(`/compact ${policy.CONDUCTOR_COMPACT_FOCUS}`);
    // The next turn starts from the summary and does not compact again.
    H.runner.sendMessage(t.id, 'what is still open?');
    await settled(t.id, 3);
    expect(users(t.id).filter((u) => u.source === 'omni')).toHaveLength(1);
  });

  it('on Opus and Haiku compacts too', T, async () => {
    for (const model of ['claude-opus-5-5', 'haiku']) {
      const t = await conductor('CTX:130000 route it', model);
      await settled(t.id, 2);
      expect(users(t.id).at(-1)?.source).toBe('omni');
    }
  });

  it('below the threshold does not compact', T, async () => {
    const t = await conductor('CTX:60000 route this');
    await settled(t.id, 1);
    expect(users(t.id)).toHaveLength(1);
  });

  it('does not compact with the policy off', T, async () => {
    const was = H.config.conductorCompactAt;
    H.config.conductorCompactAt = 0;
    try {
      const t = await conductor('CTX:150000 route this');
      await settled(t.id, 1);
      expect(users(t.id)).toHaveLength(1);
    } finally {
      H.config.conductorCompactAt = was;
    }
  });

  it('a long thread in another channel is left to its harness', T, async () => {
    const t = await H.start('CTX:150000 build this', { model: 'claude-sonnet-5-5' });
    await settled(t.id, 1);
    expect(users(t.id)).toHaveLength(1);
  });
});
