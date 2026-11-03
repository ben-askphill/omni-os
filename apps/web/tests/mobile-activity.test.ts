import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { WIRE_FIXTURES } from '@omni/test-fixtures';
import type { NeedsYou } from '../src/api.ts';
import { needsCard } from '../src/mobile/activity.ts';

// The phone's Needs you cards, against the recorded server answers
// (apps/server/tests/wire-fixtures.test.ts records them).
const fixture = <T>(name: string) => JSON.parse(readFileSync(join(WIRE_FIXTURES, name), 'utf8')) as T;
const inbox = () => fixture<NeedsYou>('needs-you.json');

const NOW = Date.parse('2026-01-05T12:00:00.000Z');
const channel = (id: string) => (id === 'acme' ? { name: 'Acme', icon: null } : undefined);
const harness = (id: string) => (id === 'claude-code' ? 'Claude Code' : id);
const cardsOf = (n: NeedsYou) => n.items.map((i) => needsCard(i, channel(i.thread.channel_id), harness, NOW));

describe('needsCard', () => {
  it('answers each blocker with the action the thread page offers, then Mark done', () => {
    const cards = cardsOf(inbox());
    const byTitle = (t: string) => cards.find((c) => c.thread.title === t)!;
    expect(byTitle('Tidy the copy')).toMatchObject({ kind: 'limited', label: 'Usage limit reached', glyph: 'needs' });
    // Scheduled already: cancel it, or resume now.
    expect(byTitle('Tidy the copy').actions).toEqual([
      { kind: 'limit', label: 'Cancel', action: 'cancel' },
      { kind: 'limit', label: 'Resume now', action: 'resume' },
    ]);
    expect(byTitle('Fix the widget').actions).toEqual([
      { kind: 'retry', label: 'Retry' },
      { kind: 'done', label: 'Mark done' },
    ]);
    expect(byTitle('Plan the launch').actions).toEqual([
      { kind: 'resume', label: 'Resume' },
      { kind: 'done', label: 'Mark done' },
    ]);
  });

  it('opens an unread result, or marks it read', () => {
    const n = inbox();
    const card = cardsOf(n).find((c) => c.thread.title === 'Audit the checkout')!;
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
    expect(cardsOf(n)[0].actions).toEqual([{ kind: 'open', label: 'Review' }, { kind: 'done', label: 'Mark done' }]);
  });

  it('heads each card with its channel, role and whether the Conductor sent it', () => {
    const cards = cardsOf(inbox());
    expect(cards.find((c) => c.thread.title === 'Daily digest · 5 Jan')!.meta).toBe('#Acme · researcher');
    const n = inbox();
    n.items[0] = { ...n.items[0], thread: { ...n.items[0].thread, source: 'conductor', role: 'builder' } };
    expect(cardsOf(n)[0].meta).toBe('#Acme · builder · via Conductor');
  });
});
