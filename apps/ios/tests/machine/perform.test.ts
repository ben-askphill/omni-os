import type { Fetch, SSEConnection, SSESink, SSETransport } from '@omni/client-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createLiveHub } from '../../src/live/hub';
import type { OmniSession } from '../../src/live/session';
import { hubMachineApi } from '../../src/machine/api';
import { performMachineCommand } from '../../src/machine/perform';
import { errorFor, IDLE, machineReducer, type MachineEvent } from '../../src/machine/state';
import { SIGNED_OUT_ERROR } from '../../src/failure';
import { handoff } from './fixtures';

const BASE = 'http://omni.test';

interface Reply {
  status?: number;
  body?: unknown;
}

/** Answers each request by method and path, and records them. */
function fakeFetch(reply: (method: string, path: string) => Reply) {
  const calls: string[] = [];
  const fetch: Fetch = async (url, init) => {
    const path = new URL(url).pathname;
    calls.push(`${init.method} ${path}`);
    const r = reply(init.method, path);
    return {
      status: r.status ?? 200,
      headers: { get: (name: string) => (name.toLowerCase() === 'content-type' ? 'application/json' : null) },
      text: async () => (r.body === undefined ? '' : JSON.stringify(r.body)),
    };
  };
  return { fetch, calls };
}

const transport: SSETransport = (_request, _sink: SSESink): SSEConnection => ({ close() {} });

const threadRow = (over: Record<string, unknown> = {}) => ({ id: 't1', channel_id: 'c', title: 'Fix build', status: 'running', updated_at: '', created_at: '', ...over });
const detail = () => ({
  thread: threadRow(),
  channel: { id: 'c', name: 'Client' },
  events: [],
  history: { from: 1, to: null, results_below: 0 },
  artifacts: [],
  children: [],
  parent: null,
  pending: [],
  live: false,
});

const session = (over: Partial<OmniSession> = {}): OmniSession => ({ serverUrl: BASE, token: async () => 'token', refreshAuth: async () => false, ...over });

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

/** The ui events a command emits, reduced as the hook would. */
function recorder() {
  const events: MachineEvent[] = [];
  let ui = IDLE;
  return {
    events,
    dispatch: (e: MachineEvent) => {
      events.push(e);
      ui = machineReducer(ui, e);
    },
    ui: () => ui,
  };
}

async function open(replyFor: (method: string, path: string) => Reply) {
  const { fetch, calls } = fakeFetch((m, p) => (m === 'GET' && p === '/api/threads/t1' ? { body: detail() } : replyFor(m, p)));
  const hub = createLiveHub({ session: session(), transport, fetch });
  const live = hub.openThread('t1');
  await vi.advanceTimersByTimeAsync(0);
  return { hub, live, calls, close: () => (live.close(), hub.close()) };
}

describe('performMachineCommand through the live hub', () => {
  it('hands a running thread off and shows its handoff and stopped status at once', async () => {
    const h = handoff({ state: { phase: 'preparing', step: 'stopping' } });
    const { hub, live, calls, close } = await open((m, p) => (m === 'POST' && p === '/api/threads/t1/handoff' ? { body: { thread: threadRow({ status: 'stopped' }), handoff: h } } : { body: [] }));
    expect(live.view.get().handoff).toBeNull();
    const r = recorder();
    const out = await performMachineCommand({ api: hubMachineApi(hub), apply: (t, x) => hub.applyHandoff(t, x), dispatch: r.dispatch }, 't1', { type: 'handOff', to: 'm2' });
    expect(out.ok).toBe(true);
    expect(calls).toContain('POST /api/threads/t1/handoff');
    expect(live.view.get()).toMatchObject({ thread: { status: 'stopped' }, handoff: h, takeover: null });
    expect(r.events.map((e) => e.type)).toEqual(['send', 'settle']);
    expect(r.ui()).toEqual(IDLE);
    close();
  });

  it('takes a thread over, showing the request as the handoff and clearing the Take over note', async () => {
    const asked = handoff({ outgoing: false, requested: true, state: { phase: 'requested', stale: false } });
    const { hub, live, close } = await open((m, p) => (m === 'POST' && p === '/api/threads/t1/takeover' ? { body: { thread: threadRow({ status: 'stopped' }), handoff: asked } } : { body: [] }));
    const r = recorder();
    r.dispatch({ type: 'ask' });
    const out = await performMachineCommand({ api: hubMachineApi(hub), apply: (t, x) => hub.applyHandoff(t, x), dispatch: r.dispatch }, 't1', { type: 'takeOver' });
    expect(out.ok).toBe(true);
    expect(live.view.get().handoff).toEqual(asked);
    expect(r.ui().asking).toBe(false);
    close();
  });

  it('cancels a handoff and shows it as cancelled', async () => {
    const cancelled = handoff({ state: { phase: 'cancelled' } });
    const { hub, live, close } = await open((m, p) => (m === 'POST' && p === '/api/threads/t1/handoff/cancel' ? { body: { thread: threadRow({ status: 'stopped' }), handoff: cancelled } } : { body: [] }));
    await performMachineCommand({ api: hubMachineApi(hub), apply: (t, x) => hub.applyHandoff(t, x), dispatch: () => {} }, 't1', { type: 'cancel' });
    expect(live.view.get().handoff).toEqual(cancelled);
    close();
  });

  it('leaves the thread alone and keeps the server words when the machine is offline', async () => {
    const text = 'Studio is offline on Tailscale. Wake it, then try again.';
    const { hub, live, close } = await open((m, p) => (m === 'POST' && p === '/api/threads/t1/handoff' ? { status: 409, body: { error: text } } : { body: [] }));
    const r = recorder();
    const out = await performMachineCommand({ api: hubMachineApi(hub), apply: (t, x) => hub.applyHandoff(t, x), dispatch: r.dispatch }, 't1', { type: 'handOff', to: 'm2' });
    expect(out).toEqual({ ok: false, kind: 'offline', error: text });
    expect(live.view.get()).toMatchObject({ handoff: null, thread: { status: 'running' } });
    expect(r.ui()).toMatchObject({ sending: null });
    expect(errorFor(r.ui(), 'handOff')).toBe(text);
    close();
  });

  it('reports a busy thread from a 409 on Take over', async () => {
    const { hub, close } = await open((m, p) => (m === 'POST' && p === '/api/threads/t1/takeover' ? { status: 409, body: { error: 'This thread is already on its way between machines.' } } : { body: [] }));
    const out = await performMachineCommand({ api: hubMachineApi(hub), apply: () => {}, dispatch: () => {} }, 't1', { type: 'takeOver' });
    expect(out).toMatchObject({ ok: false, kind: 'busy' });
    close();
  });

  it('retries once after a 401 that the session can refresh, and succeeds', async () => {
    let attempts = 0;
    const refreshAuth = vi.fn(async () => true);
    const fetchPair = fakeFetch((m, p) => {
      if (m === 'POST' && p === '/api/threads/t1/handoff') {
        attempts += 1;
        return attempts === 1 ? { status: 401, body: { error: 'expired' } } : { body: { thread: threadRow({ status: 'stopped' }), handoff: handoff() } };
      }
      return { body: p === '/api/threads/t1' ? detail() : [] };
    });
    const hub = createLiveHub({ session: session({ refreshAuth }), transport, fetch: fetchPair.fetch });
    const out = await performMachineCommand({ api: hubMachineApi(hub), apply: () => {}, dispatch: () => {} }, 't1', { type: 'handOff', to: 'm2' });
    expect(out.ok).toBe(true);
    expect(refreshAuth).toHaveBeenCalledOnce();
    hub.close();
  });

  it('says the phone was signed out when the 401 survives the refresh', async () => {
    const refreshAuth = vi.fn(async () => false);
    const { fetch } = fakeFetch((m, p) => (m === 'POST' && p === '/api/threads/t1/handoff' ? { status: 401, body: { error: 'unauthorized' } } : { body: p === '/api/threads/t1' ? detail() : [] }));
    const hub = createLiveHub({ session: session({ refreshAuth }), transport, fetch });
    const r = recorder();
    const out = await performMachineCommand({ api: hubMachineApi(hub), apply: () => {}, dispatch: r.dispatch }, 't1', { type: 'handOff', to: 'm2' });
    expect(out).toEqual({ ok: false, kind: 'revoked', error: SIGNED_OUT_ERROR });
    expect(refreshAuth).toHaveBeenCalledOnce();
    expect(errorFor(r.ui(), 'handOff')).toBe(SIGNED_OUT_ERROR);
    hub.close();
  });
});
