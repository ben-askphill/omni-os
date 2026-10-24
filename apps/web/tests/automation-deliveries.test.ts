import { describe, expect, it } from 'vitest';
import type { DeliveryView } from '@omni/shared/automation-triggers.ts';
import { ApiError, refusedDelivery } from '../src/api.ts';
import { describeDeliverySource, expiryFact, httpUrl, inTime, mergeDeliveries, receivedAgo } from '../src/format.ts';

const now = Date.parse('2026-10-24T12:00:00.000Z');
const at = (ms: number) => new Date(now + ms).toISOString();
const MIN = 60_000;
const HOUR = 60 * MIN;

const view = (over: Partial<DeliveryView> & { id: string }): DeliveryView => ({
  automation: 'ci-fixer',
  source: 'github_webhook',
  source_id: `src-${over.id}`,
  summary: `CI failure ${over.id}`,
  context: {},
  state: 'failed',
  reason: null,
  owner: null,
  source_thread: null,
  thread_id: null,
  attempt: 1,
  created_at: at(-HOUR),
  updated_at: at(-HOUR),
  thread_status: null,
  expires_at: null,
  waiting: null,
  can_skip: true,
  can_retry: true,
  retry_blocked: null,
  ...over,
});

describe('inTime', () => {
  it('counts minutes, then hours, then days', () => {
    expect(inTime(at(12 * MIN), now)).toBe('in 12m');
    expect(inTime(at(3 * HOUR), now)).toBe('in 3h');
    expect(inTime(at(2 * 24 * HOUR), now)).toBe('in 2d');
  });

  it('never says 0 minutes or 60 minutes', () => {
    expect(inTime(at(5_000), now)).toBe('in 1m');
    expect(inTime(at(59 * MIN + 40_000), now)).toBe('in 1h');
  });

  it('says now once the time has passed, and nothing for a time it cannot read', () => {
    expect(inTime(at(0), now)).toBe('now');
    expect(inTime(at(-5 * MIN), now)).toBe('now');
    expect(inTime('not a time', now)).toBe('');
  });
});

describe('expiryFact', () => {
  it('says when it will expire', () => {
    expect(expiryFact(at(3 * HOUR), now)).toEqual({ label: 'Expires', value: 'in 3h' });
  });

  it('says it has expired, and when, once the time has passed', () => {
    expect(expiryFact(at(-5 * MIN), now)).toEqual({ label: 'Expired', value: '5m ago' });
    expect(expiryFact(at(0), now).label).toBe('Expired');
  });
});

describe('receivedAgo', () => {
  it('gives the time since for an event from today', () => {
    expect(receivedAgo(at(-2 * MIN), now)).toBe('2m ago');
  });

  it('leaves out what the date already says for an older one', () => {
    expect(receivedAgo(at(-3 * 24 * HOUR), now)).toBeNull();
  });
});

describe('httpUrl', () => {
  it('keeps a web link', () => {
    expect(httpUrl('https://github.com/acme/shop/pull/412')).toBe('https://github.com/acme/shop/pull/412');
    expect(httpUrl('http://localhost:4747/t/1')).toBe('http://localhost:4747/t/1');
  });

  it('turns every other value into text', () => {
    expect(httpUrl('javascript:alert(1)')).toBeNull();
    expect(httpUrl('data:text/html,<b>x</b>')).toBeNull();
    expect(httpUrl('file:///etc/passwd')).toBeNull();
    expect(httpUrl('412')).toBeNull();
    expect(httpUrl('see https://github.com/acme/shop')).toBeNull();
    expect(httpUrl('')).toBeNull();
  });
});

describe('describeDeliverySource', () => {
  it('names both sources', () => {
    expect(describeDeliverySource('artifact_published')).toBe('Published page');
    expect(describeDeliverySource('github_webhook')).toBe('GitHub webhook');
  });
});

describe('mergeDeliveries', () => {
  it('lists the union newest first', () => {
    const merged = mergeDeliveries([view({ id: 'a', created_at: at(-1 * HOUR) })], [view({ id: 'b', created_at: at(-3 * HOUR) }), view({ id: 'c', created_at: at(-2 * HOUR) })]);
    expect(merged.map((d) => d.id)).toEqual(['a', 'c', 'b']);
  });

  it('keeps loaded history when a reload moves the latest few on', () => {
    const history = [view({ id: 'old1', created_at: at(-9 * HOUR) }), view({ id: 'old2', created_at: at(-10 * HOUR) })];
    const shown = mergeDeliveries([view({ id: 'a', created_at: at(-5 * HOUR) }), view({ id: 'b', created_at: at(-6 * HOUR) })], history);
    const reloaded = mergeDeliveries([view({ id: 'new', created_at: at(-1 * HOUR) }), view({ id: 'a', created_at: at(-5 * HOUR) })], shown);
    expect(reloaded.map((d) => d.id)).toEqual(['new', 'a', 'b', 'old1', 'old2']);
  });

  it('lets the reloaded copy win for a row both have', () => {
    const shown = [view({ id: 'a', state: 'accepted', can_retry: false, waiting: 'Waiting for a free slot' })];
    const [row] = mergeDeliveries([view({ id: 'a', state: 'accepted', can_retry: false, waiting: null })], shown);
    expect(row.waiting).toBeNull();
  });

  it('never takes a state back', () => {
    const retried = view({ id: 'a', attempt: 2, state: 'accepted', can_retry: false });
    expect(mergeDeliveries([view({ id: 'a', attempt: 1, state: 'failed' })], [retried])[0]).toBe(retried);
    const started = view({ id: 'a', attempt: 2, state: 'started', thread_id: 't1' });
    expect(mergeDeliveries([retried], [started])[0]).toBe(started);
  });

  it('moves a row forward when the incoming copy is ahead', () => {
    const skipped = view({ id: 'a', state: 'skipped', reason: 'Skipped by hand', can_retry: false, can_skip: false });
    expect(mergeDeliveries([skipped], [view({ id: 'a' })])[0]).toBe(skipped);
  });

  it('keeps the order of rows that arrived together when their times match', () => {
    const t = at(-HOUR);
    expect(mergeDeliveries([view({ id: 'x', created_at: t }), view({ id: 'y', created_at: t })], []).map((d) => d.id)).toEqual(['x', 'y']);
  });
});

describe('refusedDelivery', () => {
  it('reads the delivery a 409 sends back', () => {
    const d = view({ id: 'a', state: 'started', thread_id: 't1' });
    expect(refusedDelivery(new ApiError('It already started. Open its thread.', 409, { error: 'It already started. Open its thread.', delivery: d }))).toBe(d);
  });

  it('finds nothing in a reply without one', () => {
    expect(refusedDelivery(new ApiError('no delivery with this id', 404, { error: 'no delivery with this id' }))).toBeUndefined();
    expect(refusedDelivery(new ApiError('Cannot reach the Omni server. Is it running?', 0))).toBeUndefined();
    expect(refusedDelivery(new ApiError('bad', 409, { delivery: 'x' }))).toBeUndefined();
    expect(refusedDelivery(new ApiError('bad', 409, 'plain text'))).toBeUndefined();
    expect(refusedDelivery(new Error('boom'))).toBeUndefined();
  });
});
