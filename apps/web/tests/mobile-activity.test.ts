import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { NeedsYou, Thread } from '../src/api.ts';
import { activityOf } from '../src/mobile/activity.ts';

// The phone's Activity tab, against the recorded server answers the Mac app's tests decode too
// (apps/server/tests/mac-fixtures.test.ts records them).
const FIXTURES = join(resolve(import.meta.dirname, '../..'), 'mac', 'OmniKit', 'Tests', 'OmniKitTests', 'Fixtures');
const fixture = <T>(name: string) => JSON.parse(readFileSync(join(FIXTURES, name), 'utf8')) as T;
const inbox = () => fixture<NeedsYou>('needs-you.json');
const base = fixture<Thread[]>('recent.json')[0];

const NOW = Date.parse('2026-01-05T12:00:00.000Z');
const thread = (id: string, over: Partial<Thread>): Thread => ({ ...base, id, title: id, ...over });
const channel = (id: string) => (id === 'acme' ? { name: 'Acme', icon: null } : undefined);
const harness = (id: string) => (id === 'claude-code' ? 'Claude Code' : id);
const view = (recent: Thread[], needsYou: NeedsYou | null = { items: [], unread: 0, blocked: 0 }) =>
  activityOf({ recent, needsYou, pinned: [], channel, harness, now: NOW });

describe('Activity', () => {
  it('answers each blocker with the action the thread page offers', () => {
    const cards = view([], inbox()).needs;
    const byTitle = (t: string) => cards.find((c) => c.thread.title === t)!;
    expect(byTitle('Tidy the copy')).toMatchObject({ kind: 'limited', label: 'Usage limit reached', glyph: 'needs' });
    // Scheduled already: cancel it, or resume now.
    expect(byTitle('Tidy the copy').actions).toEqual([
      { kind: 'limit', label: 'Cancel', action: 'cancel' },
      { kind: 'limit', label: 'Resume now', action: 'resume' },
    ]);
    expect(byTitle('Fix the widget').actions).toEqual([
      { kind: 'retry', label: 'Retry' },
      { kind: 'open', label: 'Open' },
    ]);
    expect(byTitle('Plan the launch').actions).toEqual([
      { kind: 'resume', label: 'Resume' },
      { kind: 'open', label: 'Open' },
    ]);
  });

  it('opens an unread result, or marks it read', () => {
    const n = inbox();
    const card = view([], n).needs.find((c) => c.thread.title === 'Audit the checkout')!;
    const uid = n.items.find((i) => i.thread.title === 'Audit the checkout')!.result!.uid;
    expect(card).toMatchObject({ kind: 'result', label: 'Finished', glyph: 'done' });
    expect(card.actions).toEqual([
      { kind: 'open', label: 'Open' },
      { kind: 'read', label: 'Mark read', uid },
    ]);
  });

  it('sends a message that may have reached the agent back to the thread, which names it', () => {
    const n = inbox();
    n.items[0] = { ...n.items[0], blockers: [{ kind: 'uncertain', detail: null, count: 1 }] };
    expect(view([], n).needs[0].actions).toEqual([{ kind: 'open', label: 'Review' }]);
  });

  it('heads each card with its channel, role and whether the Conductor sent it', () => {
    const cards = view([], inbox()).needs;
    expect(cards.find((c) => c.thread.title === 'Daily digest · 5 Jan')!.meta).toBe('#Acme · researcher');
    const n = inbox();
    n.items[0] = { ...n.items[0], thread: { ...n.items[0].thread, source: 'conductor', role: 'builder' } };
    expect(view([], n).needs[0].meta).toBe('#Acme · builder · via Conductor');
  });

  it('lists what runs and what finished today, leaving out what Needs you shows and team members', () => {
    const n = inbox();
    const needed = n.items[0].thread.id;
    const a = view(
      [
        thread('run', { status: 'running', updated_at: '2026-01-05T11:58:00.000Z' }),
        thread('queue', { status: 'queued' }),
        thread(needed, { status: 'failed' }),
        thread('member', { status: 'running', source: 'team' }),
        thread('done', { status: 'done', updated_at: '2026-01-05T10:00:00.000Z' }),
        thread('failed', { status: 'failed', updated_at: '2026-01-05T09:00:00.000Z' }),
        thread('yesterday', { status: 'done', updated_at: '2026-01-04T10:00:00.000Z' }),
      ],
      n,
    );
    expect(a.running.map((r) => r.id)).toEqual(['run', 'queue']);
    expect(a.running[0]).toMatchObject({ channel: 'Acme', time: '2m', meta: 'Running', settled: false });
    expect(a.running[1].meta).toBe('Queued');
    expect(a.doneToday.map((r) => r.id)).toEqual(['done', 'failed']);
    expect(a.doneToday[0]).toMatchObject({ settled: true, meta: null, time: '2h' });
  });

  it('shows nothing that needs Ben before Needs you loads', () => {
    expect(view([thread('run', { status: 'running' })], null).needs).toEqual([]);
  });
});
