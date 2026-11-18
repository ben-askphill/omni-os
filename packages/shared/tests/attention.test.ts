import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { WIRE_FIXTURES } from '@omni/test-fixtures';
import {
  DEFAULT_ALERT_KINDS,
  FRESHNESS_MS,
  allows,
  createTracker,
  parseAlertKinds,
  questionAlert,
  resultAlert,
  setupAlert,
  type AlertKind,
  type AttentionItem,
  type FeedAlert,
  type ObserveOptions,
} from '../attention.ts';

// Which events become notifications (packages/shared/attention.ts), for the browser and the desktop app alike, against
// the recorded Needs you answer (apps/server/tests/wire-fixtures.test.ts records it).

const base = (JSON.parse(readFileSync(join(WIRE_FIXTURES, 'needs-you.json'), 'utf8')) as { items: AttentionItem[] }).items;
const AT = Date.parse('2026-01-05T09:00:00.000Z');
const byTitle = (title: string) => structuredClone(base.find((i) => i.thread.title === title)!);
const list = (items: AttentionItem[]) => ({ items });
/** A result only: no blockers, so each test says which it means. */
const result = (title: string, uid: string, at = AT): AttentionItem => {
  const i = byTitle(title);
  return { ...i, blockers: [], result: { ...i.result!, uid, at: new Date(at).toISOString() } };
};
const question = (title: string, at = AT, count = 1): AttentionItem => {
  const i = byTitle(title);
  return { ...i, result: null, blockers: [{ kind: 'question', detail: 'Which store first?', count, at: new Date(at).toISOString() }] };
};
const opts = (o: Partial<ObserveOptions> = {}): ObserveOptions => ({ now: AT + 1000, viewing: null, visible: false, allows: () => true, ...o });
const ids = (o: { post: { id: string }[] }) => o.post.map((a) => a.id);
const started = () => {
  const t = createTracker();
  t.observe(list([]), opts());
  return t;
};

describe('results', () => {
  it('records the first list without alerting, then alerts a new result once', () => {
    const t = createTracker();
    expect(t.observe(list([result('Audit the checkout', 'old')]), opts()).post).toEqual([]);
    const next = result('Fix the cart total', 'new-1');
    const first = t.observe(list([next, result('Audit the checkout', 'old')]), opts());
    expect(first.post).toEqual([
      { id: 'new-1', kind: 'failed', threadId: next.thread.id, channelId: 'acme', title: 'Fix the cart total', body: 'Failed in #acme: Output of /context' },
    ]);
    expect(t.observe(list([next]), opts()).post).toEqual([]);
  });

  it('alerts a finish and a failure, never a stop', () => {
    const t = started();
    const out = t.observe(list([result('Plan the launch', 's'), result('Audit the checkout', 'd'), result('Fix the cart total', 'f')]), opts());
    expect(out.post.map((a) => [a.id, a.kind])).toEqual([
      ['f', 'failed'],
      ['d', 'finished'],
    ]);
  });

  it('skips stale results, the thread on screen in front, and what is turned off', () => {
    const t = started();
    const stale = result('Audit the checkout', 'old', AT - FRESHNESS_MS - 1);
    const watched = result('Fix the cart total', 'w');
    const muted = result('Fix the widget', 'm');
    const ok = result('Fix the cart and the tests', 'ok');
    const out = t.observe(list([stale, watched, muted, ok]), opts({ viewing: watched.thread.id, visible: true, allows: (_k, c) => c !== 'widgets' }));
    expect(ids(out)).toEqual(['ok']);
  });

  it('alerts the thread on screen when its window is in the background', () => {
    const t = started();
    const item = result('Fix the cart total', 'bg');
    expect(t.observe(list([item]), opts({ viewing: item.thread.id, visible: false })).post).toHaveLength(1);
  });

  it('does not alert a result later when its kind or channel is turned back on', () => {
    const t = started();
    const item = result('Audit the checkout', 'later');
    expect(t.observe(list([item]), opts({ allows: () => false })).post).toEqual([]);
    expect(t.observe(list([item]), opts()).post).toEqual([]);
  });

  it('withdraws an alert once its result is read', () => {
    const t = started();
    t.observe(list([result('Audit the checkout', 'r')]), opts());
    expect(t.observe(list([]), opts()).withdraw).toEqual(['r']);
    expect(t.observe(list([]), opts()).withdraw).toEqual([]);
  });

  it('names the channel when it can, and the Conductor as such', () => {
    expect(resultAlert(byTitle('Audit the checkout'), 'Acme')?.body.startsWith('Finished in #Acme')).toBe(true);
    const conductor = result('Audit the checkout', 'c');
    conductor.thread.channel_id = 'conductor';
    expect(resultAlert(conductor)?.body.startsWith('Finished in the Conductor')).toBe(true);
    expect(resultAlert(byTitle('Plan the launch'))).toBeNull();
  });
});

describe('questions', () => {
  it('alerts a new question, and withdraws it once answered', () => {
    const t = started();
    const q = question('Audit the checkout');
    const out = t.observe(list([q]), opts());
    expect(out.post).toEqual([
      { id: `question:${q.thread.id}:2026-01-05T09:00:00.000Z`, kind: 'question', threadId: q.thread.id, channelId: 'acme', title: 'Audit the checkout', body: 'Waiting on your answer in #acme: Which store first?' },
    ]);
    expect(t.observe(list([q]), opts()).post).toEqual([]);
    expect(t.observe(list([]), opts()).withdraw).toEqual([out.post[0].id]);
  });

  it('alerts again for a newer question card in the same thread', () => {
    const t = started();
    t.observe(list([question('Audit the checkout')]), opts());
    const second = t.observe(list([question('Audit the checkout', AT + 500, 2)]), opts());
    expect(second.post.map((a) => a.body)).toEqual(['2 questions wait in #acme: Which store first?']);
  });

  it('alerts one thread once per list, with its question over its result', () => {
    const t = started();
    const both = { ...result('Audit the checkout', 'res'), blockers: question('Audit the checkout').blockers };
    const out = t.observe(list([both, result('Fix the cart total', 'other')]), opts());
    expect(out.post.map((a) => [a.threadId, a.kind])).toEqual([
      [byTitle('Fix the cart total').thread.id, 'failed'],
      [both.thread.id, 'question'],
    ]);
    // The result it left out is not news later either, and only what was posted is withdrawn.
    expect(t.observe(list([both]), opts())).toEqual({ post: [], withdraw: ['other'] });
    expect(t.observe(list([]), opts()).withdraw).toEqual([out.post[1].id]);
  });

  it('prefers a failure to a finish in one thread, as the worktree and a result can both say', () => {
    const t = started();
    const i = byTitle('Fix the widget');
    const setupAndDone: AttentionItem = { ...i, thread: { ...i.thread, status: 'failed' }, at: new Date(AT).toISOString(), result: { uid: 'd', status: 'done', at: new Date(AT).toISOString() }, blockers: i.blockers.filter((b) => b.kind === 'setup') };
    expect(t.observe(list([setupAndDone]), opts()).post.map((a) => a.kind)).toEqual(['failed']);
  });

  it('does not alert the older of two questions when the newer one is answered', () => {
    // Both were waiting when the app started, so only the newer card's key was seen.
    const t = createTracker();
    t.observe(list([question('Audit the checkout', AT + 500, 2)]), opts());
    expect(t.observe(list([question('Audit the checkout', AT, 1)]), opts()).post).toEqual([]);
    // Both arrive between two loads, the newer alerts; answering it does not bring the older back as news.
    const t2 = started();
    const both = t2.observe(list([question('Audit the checkout', AT + 500, 2)]), opts());
    expect(both.post).toHaveLength(1);
    const answered = t2.observe(list([question('Audit the checkout', AT, 1)]), opts());
    expect(answered).toEqual({ post: [], withdraw: [both.post[0].id] });
    // A card newer than any seen still alerts.
    expect(t2.observe(list([question('Audit the checkout', AT + 900, 2)]), opts()).post).toHaveLength(1);
  });

  it('keeps quiet for a question in the thread on screen in front, or with questions off', () => {
    const t = started();
    const q = question('Audit the checkout');
    expect(t.observe(list([q]), opts({ viewing: q.thread.id, visible: true })).post).toEqual([]);
    const t2 = started();
    expect(t2.observe(list([q]), opts({ allows: (k) => k !== 'question' })).post).toEqual([]);
  });

  it('reads the recorded question blocker', () => {
    const a = questionAlert(byTitle('Daily digest · 5 Jan'));
    expect(a).toMatchObject({ kind: 'question', body: 'Waiting on your answer in #acme: Which store should the digest cover first?' });
    expect(a!.id).toBe(`question:${byTitle('Daily digest · 5 Jan').thread.id}:2026-01-05T09:00:00.000Z`);
  });

  it('names the step a running thread stopped at to ask', () => {
    const item = byTitle('Daily digest · 5 Jan');
    const a = questionAlert({ ...item, thread: { ...item.thread, status: 'running', step: 'Step 2 of 3 · Read the reviews' } });
    expect(a?.body).toBe('Step 2 of 3 · Read the reviews · waiting on your answer in #acme: Which store should the digest cover first?');
  });
});

describe('worktree setup', () => {
  const setupOnly = (status = 'failed'): AttentionItem => {
    const i = byTitle('Fix the widget');
    return { ...i, thread: { ...i.thread, status }, result: null, blockers: i.blockers.filter((b) => b.kind === 'setup') };
  };

  it('alerts a worktree that could not be prepared as a failure', () => {
    const t = started();
    const out = t.observe(list([{ ...setupOnly(), at: new Date(AT).toISOString() }]), opts());
    expect(out.post).toHaveLength(1);
    expect(out.post[0]).toMatchObject({ kind: 'failed' });
    expect(out.post[0].body.startsWith('Worktree could not be prepared in #widgets')).toBe(true);
  });

  it('stays quiet when Ben stopped it, or a failed result already says it', () => {
    expect(setupAlert(setupOnly('stopped'))).toBeNull();
    expect(setupAlert(byTitle('Fix the widget'))).toBeNull();
  });
});

describe('feed alerts', () => {
  const crew: FeedAlert = { id: 'crew:1', kind: 'crewReport', thread_id: 'cond-1', channel_id: 'conductor', title: 'Ship notifications', body: 'Fix the cart: PR opened.', at: new Date(AT).toISOString() };
  const pr: FeedAlert = { id: 'pr:t1:r1', kind: 'prAttention', thread_id: 't1', channel_id: 'acme', title: 'Fix the cart', body: '#12 at abc1234. CI failed: CI / build', at: new Date(AT).toISOString() };

  it('alerts a crew report and a PR once each, as they arrive', () => {
    const t = createTracker();
    expect(t.feed(crew, opts())).toEqual({ id: 'crew:1', kind: 'crewReport', threadId: 'cond-1', channelId: 'conductor', title: 'Ship notifications', body: 'Crew report in the Conductor: Fix the cart: PR opened.' });
    expect(t.feed(pr, opts({ channelName: () => 'Acme' }))).toMatchObject({ kind: 'prAttention', body: 'Pull request needs attention: #12 at abc1234. CI failed: CI / build' });
    expect(t.feed(crew, opts())).toBeNull();
  });

  it('skips the thread on screen in front and what is turned off', () => {
    expect(createTracker().feed(pr, opts({ viewing: 't1', visible: true }))).toBeNull();
    expect(createTracker().feed(pr, opts({ allows: (k) => k !== 'prAttention' }))).toBeNull();
    expect(createTracker().feed(crew, opts({ allows: (_k, c) => c !== 'conductor' }))).toBeNull();
  });
});

describe('preferences', () => {
  it('turns every kind on by default and reads stored kinds key by key', () => {
    expect(Object.values(DEFAULT_ALERT_KINDS).every(Boolean)).toBe(true);
    expect(parseAlertKinds(null)).toEqual(DEFAULT_ALERT_KINDS);
    expect(parseAlertKinds({ finished: false, question: 'no', other: true })).toEqual({ ...DEFAULT_ALERT_KINDS, finished: false });
  });

  it('allows a kind only with the master switch on, the kind on and the channel not muted', () => {
    const on = { enabled: true, kinds: { ...DEFAULT_ALERT_KINDS, finished: false }, muted: ['widgets'] };
    const check = allows(on);
    const cases: [AlertKind, string, boolean][] = [
      ['failed', 'acme', true],
      ['finished', 'acme', false],
      ['failed', 'widgets', false],
    ];
    for (const [k, c, want] of cases) expect(check(k, c)).toBe(want);
    expect(allows({ ...on, enabled: false })('failed', 'acme')).toBe(false);
  });
});
