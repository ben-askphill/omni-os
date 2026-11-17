import type { Fetch } from '@omni/client-core';
import { createYieldGate } from '@omni/shared/yield-gate.ts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { gatedFetch } from '../src/live/yield-gate';

/** A fetch whose answers the test hands out one at a time, recording every send and every abort. */
function heldFetch() {
  const sent: { url: string; method: string; aborted: boolean; answer(text: string): void }[] = [];
  const fetch: Fetch = (url, init) =>
    new Promise((resolve, reject) => {
      const call = {
        url,
        method: init.method,
        aborted: false,
        answer: (text: string) => resolve({ status: 200, headers: { get: () => null }, text: async () => text }),
      };
      sent.push(call);
      init.signal?.addEventListener('abort', () => {
        call.aborted = true;
        reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
      });
    });
  return { fetch, sent };
}

const init = (method: 'GET' | 'POST' = 'GET') => ({ method, headers: {}, redirect: 'manual' as const });

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('gatedFetch', () => {
  it('cuts off a GET in flight when a thread starts loading, sends it again after, and answers with the second body', async () => {
    const gate = createYieldGate();
    const { fetch, sent } = heldFetch();
    const answer = gatedFetch(gate, fetch)('/api/channels', init());
    await vi.advanceTimersByTimeAsync(0);
    const release = gate.hold();
    await vi.advanceTimersByTimeAsync(0);
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(sent.map((s) => [s.url, s.aborted])).toEqual([
      ['/api/channels', true],
      ['/api/channels', false],
    ]);
    sent[1]?.answer('["second"]');
    const res = await answer;
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('["second"]');
  });

  it('lets a write through while a thread loads', async () => {
    const gate = createYieldGate();
    const { fetch, sent } = heldFetch();
    gate.hold();
    void gatedFetch(gate, fetch)('/api/needs-you/read', init('POST'));
    await vi.advanceTimersByTimeAsync(0);
    expect(sent.map((s) => [s.url, s.method])).toEqual([['/api/needs-you/read', 'POST']]);
  });
});
