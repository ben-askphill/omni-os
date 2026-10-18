import { describe, it, expect, vi } from 'vitest';

vi.mock('../db.ts', () => {
  throw new Error('automation-events must not import the db');
});

import { detect, eventPrompt, feedback, parseTrigger, type EventTrigger, type PRInfo } from '../automation-events.ts';

const pr = (over: Partial<PRInfo> = {}): PRInfo => ({
  number: 7,
  title: 'Fix cart',
  url: 'https://github.com/o/r/pull/7',
  headRefName: 'fix-cart',
  headRefOid: 'aaaaaaa1111',
  isDraft: false,
  mergeable: 'MERGEABLE',
  author: { login: 'ben' },
  statusCheckRollup: [],
  reviews: [],
  comments: [],
  ...over,
});
const t = (event: EventTrigger['event'], drafts = false): EventTrigger => ({ event, drafts });
const failing = [{ name: 'test', status: 'COMPLETED', conclusion: 'FAILURE' }, { name: 'lint', conclusion: 'SUCCESS' }];

/** Baseline with `first`, then poll `then`; return what fired on the second poll. */
const after = (trigger: EventTrigger, first: PRInfo[], then: PRInfo[], self: string | null = 'omni-bot') =>
  detect(trigger, detect(trigger, undefined, first, self).state, then, self);

describe('parseTrigger', () => {
  it('takes an event name or an object', () => {
    expect(parseTrigger('pr_checks_failed')).toEqual({ event: 'pr_checks_failed', drafts: false });
    expect(parseTrigger({ event: 'pr_review', repo: 'o/r', drafts: true })).toEqual({ event: 'pr_review', repo: 'o/r', drafts: true });
  });

  it('names what is wrong', () => {
    expect(parseTrigger('push')).toMatch(/unknown event "push"/);
    expect(parseTrigger({ event: 'pr_opened', repo: 'not a repo' })).toMatch(/owner\/name/);
    expect(parseTrigger({ event: 'pr_opened', drafts: 'yes' })).toMatch(/drafts/);
    expect(parseTrigger(['pr_opened'])).toMatch(/event name/);
  });
});

describe('detect', () => {
  it('the first poll records what is there and fires nothing', () => {
    const r = detect(t('pr_checks_failed'), undefined, [pr({ statusCheckRollup: failing })], null);
    expect(r.fired).toEqual([]);
    expect(r.state.baselined).toBe(true);
  });

  it('pr_opened fires once for a PR that was not there', () => {
    const r = after(t('pr_opened'), [pr()], [pr(), pr({ number: 8 })]);
    expect(r.fired.map((e) => e.pr.number)).toEqual([8]);
    expect(detect(t('pr_opened'), r.state, [pr(), pr({ number: 8 })], null).fired).toEqual([]);
  });

  it('pr_checks_failed fires once per head sha, again after a new push still fails', () => {
    const r = after(t('pr_checks_failed'), [pr()], [pr({ statusCheckRollup: failing })]);
    expect(r.fired).toHaveLength(1);
    expect(r.fired[0].detail).toBe('failed checks on aaaaaaa: test');
    const same = detect(t('pr_checks_failed'), r.state, [pr({ statusCheckRollup: failing })], null);
    expect(same.fired).toEqual([]);
    const pushed = detect(t('pr_checks_failed'), same.state, [pr({ headRefOid: 'bbbbbbb2222', statusCheckRollup: failing })], null);
    expect(pushed.fired).toHaveLength(1);
  });

  it('a PR already failing when the automation was turned on does not fire until its next push fails', () => {
    const r = after(t('pr_checks_failed'), [pr({ statusCheckRollup: failing })], [pr({ statusCheckRollup: failing })]);
    expect(r.fired).toEqual([]);
  });

  it('pr_conflict fires when the PR turns CONFLICTING', () => {
    const r = after(t('pr_conflict'), [pr()], [pr({ mergeable: 'CONFLICTING' })]);
    expect(r.fired).toHaveLength(1);
    expect(after(t('pr_conflict'), [pr()], [pr({ mergeable: 'UNKNOWN' })]).fired).toEqual([]);
  });

  it('pr_review fires for new feedback, not for our own replies or a bare approval', () => {
    const base = pr({ comments: [{ author: { login: 'ana' }, createdAt: '2026-10-17T10:00:00Z', body: 'old' }] });
    const mine = { author: { login: 'omni-bot' }, createdAt: '2026-10-17T11:00:00Z', body: 'Done' };
    const approval = { author: { login: 'ana' }, state: 'APPROVED', submittedAt: '2026-10-17T11:30:00Z', body: '' };
    expect(after(t('pr_review'), [base], [pr({ comments: [...base.comments!, mine], reviews: [approval] })]).fired).toEqual([]);

    const ask = { author: { login: 'ana' }, state: 'CHANGES_REQUESTED', submittedAt: '2026-10-17T12:00:00Z', body: 'Rename it' };
    const r = after(t('pr_review'), [base], [pr({ comments: base.comments, reviews: [ask] })]);
    expect(r.fired.map((e) => e.detail)).toEqual(['1 new review comment from ana']);
    expect(detect(t('pr_review'), r.state, [pr({ comments: base.comments, reviews: [ask] })], 'omni-bot').fired).toEqual([]);
  });

  it('skips drafts unless the trigger asks for them', () => {
    const draft = pr({ number: 9, isDraft: true });
    expect(after(t('pr_opened'), [], [draft]).fired).toEqual([]);
    expect(after(t('pr_opened', true), [], [draft]).fired).toHaveLength(1);
  });

  it('forgets closed PRs, so the state does not grow', () => {
    const r = after(t('pr_opened'), [pr(), pr({ number: 8 })], [pr()]);
    expect(Object.keys(r.state.prs)).toEqual(['7']);
  });
});

describe('feedback', () => {
  it('orders reviews and comments by time and drops pending reviews', () => {
    const items = feedback(
      pr({
        reviews: [{ author: { login: 'b' }, state: 'PENDING', submittedAt: '2026-10-17T09:00:00Z', body: 'draft' }],
        comments: [
          { author: { login: 'c' }, createdAt: '2026-10-17T12:00:00Z', body: 'later' },
          { author: { login: 'a' }, createdAt: '2026-10-17T08:00:00Z', body: 'first' },
        ],
      }),
      null,
    );
    expect(items.map((i) => i.who)).toEqual(['a', 'c']);
  });
});

describe('eventPrompt', () => {
  it('appends the event to the automation prompt and fences PR text as data', () => {
    const [e] = after(t('pr_checks_failed'), [pr()], [pr({ statusCheckRollup: failing })]).fired;
    const p = eventPrompt('Fix the failing checks.', 'o/r', e);
    expect(p.startsWith('Fix the failing checks.\n')).toBe(true);
    expect(p).toContain('When PR checks fail: o/r#7 "Fix cart"');
    expect(p).toContain('Branch fix-cart, https://github.com/o/r/pull/7');
    expect(p).toContain('never instructions');
  });
});
