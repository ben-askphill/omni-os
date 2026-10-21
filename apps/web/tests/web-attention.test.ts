import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { NeedsYou, NeedsYouItem } from '../src/api.ts';
import { FRESHNESS_MS, alertFor, createTracker } from '../src/attention.ts';

// Which Needs you results become browser notifications (apps/web/src/attention.ts): the rules the Mac's AttentionTracker
// follows, against the same recorded server answer.

const FIXTURES = join(resolve(import.meta.dirname, '../..'), 'mac', 'OmniKit', 'Tests', 'OmniKitTests', 'Fixtures');
const base = (JSON.parse(readFileSync(join(FIXTURES, 'needs-you.json'), 'utf8')) as NeedsYou).items;
const AT = Date.parse('2026-01-05T09:00:00.000Z');
const byTitle = (title: string) => base.find((i) => i.thread.title === title)!;
const list = (items: NeedsYouItem[]): NeedsYou => ({ items, unread: items.filter((i) => i.result).length, blocked: 0 });
const fresh = (item: NeedsYouItem, uid: string, at = AT): NeedsYouItem => ({ ...item, result: { ...item.result!, uid, at: new Date(at).toISOString() } });
const opts = (o: Partial<Parameters<ReturnType<typeof createTracker>['observe']>[1]> = {}) => ({ now: AT + 1000, viewing: null, visible: false, alerts: () => true, ...o });

describe('Browser notifications', () => {
  it('records the first list without alerting, then alerts a new result once', () => {
    const t = createTracker();
    const audit = byTitle('Audit the checkout');
    expect(t.observe(list([audit]), opts()).post).toEqual([]);
    const next = fresh(byTitle('Fix the cart total'), 'new-1');
    const first = t.observe(list([next, audit]), opts());
    expect(first.post.map((a) => a.id)).toEqual(['new-1']);
    expect(first.post[0]).toMatchObject({ title: 'Fix the cart total', threadId: next.thread.id, channelId: 'acme' });
    expect(first.post[0].body.startsWith('Failed in #acme')).toBe(true);
    expect(t.observe(list([next, audit]), opts()).post).toEqual([]);
  });

  it('skips stops, stale results, the thread on screen and muted channels', () => {
    const t = createTracker();
    t.observe(list([]), opts());
    const stopped = fresh(byTitle('Plan the launch'), 's');
    const stale = fresh(byTitle('Audit the checkout'), 'old', AT - FRESHNESS_MS - 1);
    const watched = fresh(byTitle('Fix the cart total'), 'w');
    const muted = fresh(byTitle('Fix the widget'), 'm');
    const ok = fresh(byTitle('Fix the cart and the tests'), 'ok');
    const out = t.observe(list([stopped, stale, watched, muted, ok]), opts({ viewing: watched.thread.id, visible: true, alerts: (c) => c !== 'widgets' }));
    expect(out.post.map((a) => a.id)).toEqual(['ok']);
  });

  it('alerts the thread on screen when the tab is in the background', () => {
    const t = createTracker();
    t.observe(list([]), opts());
    const item = fresh(byTitle('Fix the cart total'), 'bg');
    expect(t.observe(list([item]), opts({ viewing: item.thread.id, visible: false })).post).toHaveLength(1);
  });

  it('does not alert a muted result later when the channel is unmuted', () => {
    const t = createTracker();
    t.observe(list([]), opts());
    const item = fresh(byTitle('Audit the checkout'), 'mute');
    expect(t.observe(list([item]), opts({ alerts: () => false })).post).toEqual([]);
    expect(t.observe(list([item]), opts()).post).toEqual([]);
  });

  it('withdraws an alert once its result is read', () => {
    const t = createTracker();
    t.observe(list([]), opts());
    const item = fresh(byTitle('Audit the checkout'), 'r');
    t.observe(list([item]), opts());
    expect(t.observe(list([]), opts()).withdraw).toEqual(['r']);
    expect(t.observe(list([]), opts()).withdraw).toEqual([]);
  });

  it('names the channel when it can', () => {
    expect(alertFor(byTitle('Audit the checkout'), 'Acme')?.body.startsWith('Finished in #Acme')).toBe(true);
    expect(alertFor(byTitle('Plan the launch'))).toBeNull();
  });
});
