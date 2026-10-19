import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { NeedsYou, NeedsYouItem } from '../src/api.ts';
import { coalesced, inChannel, reasonOf, shownResult, withoutResult } from '../src/needs-you.ts';

// The Web UI's side of Needs you (apps/web/src/needs-you.ts), against the same recorded server answers the Mac app's Swift
// tests decode (apps/server/tests/mac-fixtures.test.ts records them): every kind of result and blocker, then a read.

const FIXTURES = join(resolve(import.meta.dirname, '../..'), 'mac', 'OmniKit', 'Tests', 'OmniKitTests', 'Fixtures');
const fixture = <T>(name: string) => JSON.parse(readFileSync(join(FIXTURES, name), 'utf8')) as T;
const inbox = () => fixture<NeedsYou>('needs-you.json');
const byTitle = (n: NeedsYou, title: string) => n.items.find((i) => i.thread.title === title)!;

describe('Needs you reasons', () => {
  it('says why each thread is there, a blocker before its result', () => {
    const n = inbox();
    expect(reasonOf(byTitle(n, 'Fix the widget'))).toMatchObject({ glyph: 'needs', label: 'Worktree could not be prepared' });
    expect(reasonOf(byTitle(n, 'Fix the widget')).detail).toBe(byTitle(n, 'Fix the widget').thread.setup_error);
    expect(reasonOf(byTitle(n, 'Plan the launch'))).toMatchObject({ glyph: 'needs', label: 'A message waits for Resume' });
    expect(reasonOf(byTitle(n, 'Fix the cart total'))).toMatchObject({ glyph: 'needs', label: 'Failed' });
    expect(reasonOf(byTitle(n, 'Audit the checkout'))).toMatchObject({ glyph: 'done', label: 'Finished' });
  });

  it('counts messages and says stopped', () => {
    const base = byTitle(inbox(), 'Plan the launch');
    const two: NeedsYouItem = { ...base, blockers: [{ kind: 'uncertain', detail: null, count: 2 }] };
    expect(reasonOf(two).label).toBe('2 messages may not have been sent');
    const stopped: NeedsYouItem = { ...base, blockers: [], result: { uid: 'u', status: 'stopped', event_uid: null, at: base.at } };
    expect(reasonOf(stopped)).toMatchObject({ glyph: 'settled', label: 'Stopped' });
  });
});

describe('Needs you counts', () => {
  it('match the items, everywhere and per channel', () => {
    const n = inbox();
    expect(n.unread).toBe(n.items.filter((i) => i.result).length);
    expect(n.blocked).toBe(n.items.filter((i) => i.blockers.length).length);
    const acme = inChannel(n, 'acme')!;
    expect(acme.items.every((i) => i.thread.channel_id === 'acme')).toBe(true);
    expect(acme.unread + inChannel(n, 'widgets')!.unread).toBe(n.unread);
    expect(inChannel(n, 'nowhere')).toEqual({ items: [], unread: 0, blocked: 0 });
    expect(inChannel(null, 'acme')).toBeNull();
  });
});

describe('reading a result', () => {
  it('reads the result the inbox listed, only once the thread is not running', () => {
    const n = inbox();
    const t = byTitle(n, 'Audit the checkout');
    expect(shownResult(n, t.thread.id, 'done')).toBe(t.result!.uid);
    expect(shownResult(n, t.thread.id, 'running')).toBeNull();
    expect(shownResult(n, t.thread.id, 'queued')).toBeNull();
    expect(shownResult(n, t.thread.id, undefined)).toBeNull();
    expect(shownResult(null, t.thread.id, 'done')).toBeNull();
    // A thread with only a blocker has no result to read.
    const only = fixture<{ item: NeedsYouItem }>('needs-you-read.json').item;
    expect(shownResult({ items: [only], unread: 0, blocked: 1 }, only.thread.id, 'stopped')).toBeNull();
  });

  it('drops the read result at once and keeps blockers', () => {
    const n = inbox();
    const done = byTitle(n, 'Audit the checkout');
    const after = withoutResult(n, done.result!.uid);
    expect(after.items.some((i) => i.thread.id === done.thread.id)).toBe(false);
    expect(after.unread).toBe(n.unread - 1);
    const widget = byTitle(n, 'Fix the widget');
    const kept = byTitle(withoutResult(n, widget.result!.uid), 'Fix the widget');
    expect(kept.result).toBeNull();
    expect(kept.blockers.map((b) => b.kind)).toEqual(['setup', 'recovered']);
  });

  it('leaves a later result unread when an older read lands, and takes repeated visits', () => {
    const n = inbox();
    const done = byTitle(n, 'Audit the checkout');
    // The inbox already lists a newer result than the one the read names.
    const later: NeedsYou = { ...n, items: n.items.map((i) => (i === done ? { ...i, result: { ...i.result!, uid: 'newer' } } : i)) };
    const after = withoutResult(later, done.result!.uid);
    expect(byTitle(after, 'Audit the checkout').result?.uid).toBe('newer');
    expect(after.unread).toBe(n.unread);
    const once = withoutResult(n, done.result!.uid);
    expect(withoutResult(once, done.result!.uid)).toEqual(once);
  });

  it('reads the server answer to a read', () => {
    const answer = fixture<{ thread_id: string; item: NeedsYouItem | null }>('needs-you-read.json');
    expect(answer.item?.thread.id).toBe(answer.thread_id);
    expect(answer.item?.result).toBeNull();
    expect(reasonOf(answer.item!).label).toBe('A message waits for Resume');
  });
});

describe('needs_you events', () => {
  it('load the inbox once at a time: a burst from a sync loads it twice, the last after the last event', async () => {
    const pending: (() => void)[] = [];
    let loads = 0;
    const changed = coalesced(() => {
      loads++;
      return new Promise<void>((done) => pending.push(done));
    });
    const settle = () => new Promise((r) => setTimeout(r, 0));
    changed();
    expect(loads).toBe(1);
    for (let i = 0; i < 20; i++) changed();
    expect(loads).toBe(1);
    pending.shift()!();
    await settle();
    expect(loads).toBe(2);
    pending.shift()!();
    await settle();
    expect(loads).toBe(2);
    // Quiet again: the next event loads at once, and a failed load does not stop the one after.
    const failing = coalesced(() => (loads++, Promise.reject(new Error('down'))));
    failing();
    await settle();
    failing();
    expect(loads).toBe(4);
  });
});
