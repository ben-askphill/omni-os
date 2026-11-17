import type { Fetch, FetchResponse } from '@omni/client-core';
import type { YieldGate } from '@omni/shared/yield-gate.ts';

/**
 * A fetch for the reads the hub sends by itself, run through `gate` (packages/shared/yield-gate.ts) so they give way
 * to the thread Ben opens. Only GETs wait: a write goes out at once. The body is read inside the gate, so a thread
 * that starts loading during the download cuts that off too, and it comes back as text.
 */
export function gatedFetch(gate: YieldGate, send: Fetch): Fetch {
  return (url, init) => {
    if (init.method !== 'GET') return send(url, init);
    return gate.run(async (signal) => {
      const res = await send(url, { ...init, signal });
      const text = await res.text();
      return answered(res, text);
    }, init.signal);
  };
}

function answered(res: FetchResponse, text: string): FetchResponse {
  return { status: res.status, headers: res.headers, url: res.url, type: res.type, text: async () => text };
}
