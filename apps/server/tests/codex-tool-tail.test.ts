import { beforeAll, describe, expect, it } from 'vitest';
import { TOOL_OUTPUT } from '@omni/shared/tool-output.ts';
import { startRunner, type Ev } from './runner-boot.ts';
import { FAKE_CODEX } from './support.ts';

// A noisy Codex command through the real runner against the fake app-server (#225): its row opens when it starts, its
// outputDelta notifications feed the bounded tail and nothing else, and its result ends the tail and stays whole in
// the database while the transcript carries it compact.

let H: Awaited<ReturnType<typeof startRunner>>;
const codex = { harness: 'codex', model: 'gpt-5.6-sol' };

beforeAll(async () => {
  H = await startRunner({ OMNI_CODEX_BIN: FAKE_CODEX });
  const svc = await import('../harness/catalog-service.ts');
  await svc.loadCatalog();
});

describe('a noisy codex command', () => {
  it('opens its row at once and tails through a bounded subscription, off the bus', async () => {
    const { toolTails } = await import('../tool-tail.ts');
    const { bus } = await import('../bus.ts');
    const t = await H.start('NOISY print a lot', codex);
    const seen: string[] = [];
    const onThread = (e: unknown) => seen.push(JSON.stringify(e));
    bus.on(`thread:${t.id}`, onThread);
    try {
      await H.until('the command row', () => H.byKind(t.id, 'tool_use').some((e: Ev) => e.p.name === 'Bash'));
      expect(H.byKind(t.id, 'tool_result'), 'still running').toHaveLength(0);
      const call = H.byKind(t.id, 'tool_use').find((e: Ev) => e.p.name === 'Bash')!.p.id as string;
      // All 3,000 lines (about 200 KB) arrive within moments, and the command stays up for 700 ms after them.
      await new Promise((resolve) => setTimeout(resolve, 250));
      const tail = toolTails.subscribe(t.id, call);
      const m = tail.take();
      expect(m).toMatchObject({ kind: 'tail', reset: true });
      if (m?.kind !== 'tail') return;
      expect(m.text.length).toBeLessThanOrEqual(TOOL_OUTPUT.pending);
      expect(m.skipped, 'older output dropped, not queued').toBeGreaterThan(100_000);
      expect(m.text.endsWith(`noise 2999 ${'n'.repeat(60)}\n`)).toBe(true);

      await H.untilResults(t.id, 1);
      expect(tail.take()).toEqual({ kind: 'end', live: true });
      tail.close();
      expect(toolTails.stats()).toEqual({ calls: 0, tails: 0 });
      expect(H.byKind(t.id, 'tool_use').filter((e: Ev) => e.p.name === 'Bash'), 'the call row is not repeated at completion').toHaveLength(1);
      expect(H.byKind(t.id, 'tool_result')).toHaveLength(1);
    } finally {
      bus.off(`thread:${t.id}`, onThread);
    }
    // The stored result (16,000 characters, once) is a row like any other; the 3,000 deltas are not.
    const rest = seen.filter((m) => !m.includes('"kind":"tool_result"'));
    expect(rest.filter((m) => m.includes('noise ')).length, 'bus messages carrying command output').toBe(0);
    expect(seen.reduce((n, m) => n + m.length, 0), 'bytes on the bus for the whole turn').toBeLessThan(64 * 1024);
  });
});
