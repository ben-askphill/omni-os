import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { NeedsYou, PendingMsg, Thread, ThreadDetail } from '../src/api.ts';
import { limitView, resetLabel } from '../src/limits.ts';
import { reasonOf } from '../src/needs-you.ts';

// The Web UI's side of a limit stop (apps/web/src/limits.ts, LimitCard), against the recorded server answers the Mac app's
// Swift tests decode (apps/server/tests/mac-fixtures.test.ts records them): limited, scheduled, cancelled, resumed.

const FIXTURES = join(resolve(import.meta.dirname, '../..'), 'mac', 'OmniKit', 'Tests', 'OmniKitTests', 'Fixtures');
const fixture = <T>(name: string) => JSON.parse(readFileSync(join(FIXTURES, name), 'utf8')) as T;
type Answer = { thread: Thread; pending: PendingMsg[] };

// A fixed afternoon, and resets relative to it.
const NOW = new Date(2026, 0, 5, 14, 0).getTime();
const at = (h: number, m = 0, days = 0) => new Date(2026, 0, 5 + days, h, m).toISOString();

describe('limit stop answers', () => {
  it('reads the thread at each step', () => {
    const limited = fixture<ThreadDetail>('thread-limited.json');
    expect(limited.thread).toMatchObject({ status: 'failed', limit_state: 'limited' });
    expect(limited.thread.limit_resets_at).toEqual(expect.any(String));
    expect(fixture<Answer>('limit-scheduled.json').thread.limit_state).toBe('scheduled');
    expect(fixture<Answer>('limit-cancelled.json').thread.limit_state).toBe('limited');
    // Resume now sends the continuation: the stop is gone and Omni's message waits for its turn.
    const resumed = fixture<Answer>('limit-resumed.json');
    expect(resumed.thread.limit_state).toBeNull();
    expect(resumed.pending.map((p) => [p.text, p.source])).toEqual([['Continue where you left off.', 'limit']]);
  });

  it('lists the stop in Needs you, with when it resumes', () => {
    const item = fixture<NeedsYou>('needs-you.json').items.find((i) => i.blockers.some((b) => b.kind === 'limited'))!;
    expect(item.blockers[0]).toMatchObject({ kind: 'limited', scheduled: true });
    expect(reasonOf(item)).toMatchObject({ glyph: 'needs', label: 'Usage limit reached', detail: expect.stringMatching(/^Resumes at /) });
    expect(reasonOf({ ...item, blockers: [{ kind: 'limited', detail: null, count: 0, resets_at: at(17), scheduled: false }] }).detail).toMatch(/^Resets at /);
    expect(reasonOf({ ...item, blockers: [{ kind: 'limited', detail: null, count: 0, resets_at: null, scheduled: false }] }).detail).toBe('No reset time given');
    // The other Mac's stop (sync): the same reset, and where it is.
    expect(reasonOf({ ...item, blockers: [{ kind: 'limited', detail: null, count: 0, resets_at: at(17), scheduled: false, elsewhere: true }] })).toMatchObject({
      label: 'Usage limit reached on your other Mac',
      detail: expect.stringMatching(/^Resets at /),
    });
  });
});

describe('the card', () => {
  it('offers Resume at reset and Resume now with a reset time, only Resume now without one', () => {
    expect(limitView({ limit_state: 'limited', limit_resets_at: at(17) }, 'Claude Code', NOW)).toEqual({
      title: 'Usage limit reached',
      body: "Claude Code stopped this turn at your plan's limit. It resets at 17:00.",
      actions: ['schedule', 'resume'],
    });
    expect(limitView({ limit_state: 'limited', limit_resets_at: null }, 'Codex', NOW)).toMatchObject({ actions: ['resume'] });
    expect(limitView({ limit_state: 'scheduled', limit_resets_at: at(9, 30, 1) }, 'Codex', NOW)).toMatchObject({
      title: 'Resumes at tomorrow 09:30',
      actions: ['cancel', 'resume'],
    });
    expect(limitView({ limit_state: null, limit_resets_at: null }, 'Codex', NOW)).toBeNull();
  });

  it("shows the other Mac's stop with its reset time and nothing to press", () => {
    expect(limitView({ limit_state: 'limited', limit_resets_at: at(17), limit_elsewhere: 1 }, 'Claude Code', NOW)).toEqual({
      title: 'Usage limit reached on your other Mac',
      body: "Claude Code stopped this turn at your plan's limit on your other Mac. It resets at 17:00. Resume it there.",
      actions: [],
    });
    expect(limitView({ limit_state: 'scheduled', limit_resets_at: at(9, 30, 1), limit_elsewhere: 1 }, 'Codex', NOW)).toMatchObject({
      title: 'Resumes at tomorrow 09:30 on your other Mac',
      actions: [],
    });
    expect(limitView({ limit_state: 'limited', limit_resets_at: null, limit_elsewhere: 1 }, 'Codex', NOW)?.body).toContain('did not say when it resets');
  });

  it('names the reset by time today, tomorrow, or the weekday', () => {
    expect(resetLabel(at(17, 5), NOW)).toBe('17:05');
    expect(resetLabel(at(8, 0, 1), NOW)).toBe('tomorrow 08:00');
    expect(resetLabel(at(8, 0, 4), NOW)).toMatch(/^[A-Z][a-z]{2} 08:00$/);
  });

  it('renders the recorded stop, scheduled and cleared', async () => {
    const { renderToStaticMarkup } = await import('react-dom/server');
    const { createElement } = await import('react');
    const { LimitCard } = await import('../src/components/thread/LimitCard.tsx');
    const html = (thread: Thread) => renderToStaticMarkup(createElement(LimitCard, { thread, onChanged: () => {} }));
    const limited = html(fixture<ThreadDetail>('thread-limited.json').thread);
    expect(limited).toContain('Usage limit reached');
    expect(limited).toContain('Resume at reset');
    expect(limited).toContain('Resume now');
    const scheduled = html(fixture<Answer>('limit-scheduled.json').thread);
    expect(scheduled).toContain('Resumes at');
    expect(scheduled).toContain('Cancel');
    expect(scheduled).not.toContain('Resume at reset');
    expect(html(fixture<Answer>('limit-resumed.json').thread)).toBe('');
  });
});
