import { afterAll, describe, expect, it } from 'vitest';
import { startRunner } from './runner-boot.ts';
import { hasMcpBuild } from './support.ts';

// The step a running thread is on, as one line on every thread the clients get (step-line.ts): "Step 2 of 3 · Read
// the reviews" when the agent posted a list with set_steps, the phase of its calls when it did not, nothing once the
// turn ends. The feed sends the thread again whenever the line moves, which is what the Inbox cards and the desktop
// app's notifications read.

const r = await startRunner();
const { bus } = await import('../bus.ts');
const { STEP_SETTLE_MS, threadStep, watchSteps } = await import('../step-line.ts');
const { withDelegating } = await import('../delegating.ts');
const { threads } = await import('../db.ts');
const stop = watchSteps();
afterAll(stop);

/** Each thread's step line as the feed sent it, a new entry only when it changed. */
const sent = new Map<string, (string | null)[]>();
bus.on('feed', (e: { type: string; thread?: unknown }) => {
  if (e.type !== 'thread') return;
  const t = withDelegating(e.thread as ReturnType<typeof threads.get> & object);
  const seen = sent.get(t.id) ?? [];
  const line = t.step ?? null;
  if (seen.at(-1) !== line) seen.push(line);
  sent.set(t.id, seen);
});

const step = (id: string) => withDelegating(r.thread(id)).step;

describe('a thread with no plan', () => {
  it('shows the phase of the call it is on while it runs, and nothing once the turn ends', async () => {
    const t = await r.start('TOOL:1500 tidy the repo');
    await r.untilTool(t.id);
    await r.until('the phase on the thread', () => step(t.id) === 'Running commands');
    // The feed sent it once the call's burst settled, not on the next status change.
    await r.until('the phase on the feed', () => sent.get(t.id)?.includes('Running commands'), STEP_SETTLE_MS * 8);
    await r.untilResults(t.id, 1);
    expect(step(t.id)).toBeUndefined();
    expect(threadStep({ id: t.id, status: 'running' })).toBeNull();
    expect(sent.get(t.id)?.at(-1)).toBeNull();
  });

  it('leaves the field off a thread that is not running', async () => {
    const t = await r.start('THINK:1');
    await r.untilResults(t.id, 1);
    expect('step' in withDelegating(r.thread(t.id))).toBe(false);
  });
});

describe.skipIf(!hasMcpBuild)('a thread whose agent posts steps', () => {
  it('sends each step on the feed as the agent moves the marker', { timeout: 30_000 }, async () => {
    const t = await r.start('STEPS:900 pick a review app');
    await r.untilResults(t.id, 1, 25_000);
    expect(sent.get(t.id)).toEqual(
      expect.arrayContaining(['Step 1 of 3 · Find candidate apps', 'Step 2 of 3 · Read the reviews', 'Step 3 of 3 · Compare prices']),
    );
    const lines = sent.get(t.id)!.filter((l): l is string => !!l?.startsWith('Step'));
    expect(lines.indexOf('Step 1 of 3 · Find candidate apps')).toBeLessThan(lines.indexOf('Step 3 of 3 · Compare prices'));
    // The omni-steps server took every call.
    const results = r.byKind(t.id, 'tool_result').map((e) => e.p.text as string);
    expect(results.filter((x) => x.startsWith('Showing '))).toHaveLength(4);
    expect(results).toContain('Showing all 3 steps as done.');
    expect(step(t.id)).toBeUndefined();
  });
});
