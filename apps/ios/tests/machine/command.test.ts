import { describe, expect, it, vi } from 'vitest';

import { failureOf, SIGNED_OUT_ERROR } from '../../src/failure';
import { runMachineCommand, type MachineApi } from '../../src/machine/command';
import { thread } from '../thread/fixtures';
import { handoff, refusal, unreachable } from './fixtures';

function fakeApi(over: Partial<MachineApi> = {}) {
  const answer = (h = handoff()) => ({ thread: thread({ id: 't1', status: 'stopped' }), handoff: h });
  const api = {
    handOff: vi.fn(async (_id: string, _to: string) => answer()),
    takeOver: vi.fn(async (_id: string) => answer(handoff({ outgoing: false, requested: true, state: { phase: 'requested', stale: false } }))),
    cancelHandoff: vi.fn(async (_id: string) => answer(handoff({ state: { phase: 'cancelled' } }))),
    ...over,
  };
  return api as typeof api & MachineApi;
}

describe('failureOf', () => {
  it('names a machine that is asleep or off Tailscale', () => {
    const e = refusal(409, 'Studio is offline on Tailscale, last seen 2h ago. Wake it, then try again.');
    expect(failureOf(e)).toEqual({ kind: 'offline', error: 'Studio is offline on Tailscale, last seen 2h ago. Wake it, then try again.' });
  });

  it('calls any other 409 a busy thread and keeps the server words', () => {
    expect(failureOf(refusal(409, 'This thread is already being handed off.'))).toEqual({ kind: 'busy', error: 'This thread is already being handed off.' });
    expect(failureOf(refusal(409, 'This thread is running on another machine, so only that machine can hand it off.')).kind).toBe('busy');
  });

  it('says a 401 that survived the refresh means the phone was signed out', () => {
    const out = failureOf(refusal(401, 'unauthorized'));
    expect(out).toEqual({ kind: 'revoked', error: SIGNED_OUT_ERROR });
    expect(SIGNED_OUT_ERROR).toMatch(/signed out/);
    expect(SIGNED_OUT_ERROR).toMatch(/Pair it again/);
  });

  it('leaves the rest as other, an unreachable server included', () => {
    expect(failureOf(refusal(500, 'boom'))).toEqual({ kind: 'other', error: 'boom' });
    expect(failureOf(unreachable())).toEqual({ kind: 'other', error: 'Cannot reach the Omni server. Is it running?' });
    expect(failureOf('weird')).toEqual({ kind: 'other', error: 'Something went wrong' });
  });
});

describe('runMachineCommand', () => {
  it('hands the thread to the machine and returns the thread with its handoff', async () => {
    const api = fakeApi();
    const out = await runMachineCommand(api, 't1', { type: 'handOff', to: 'm2' });
    expect(api.handOff).toHaveBeenCalledWith('t1', 'm2');
    expect(out).toMatchObject({ ok: true, thread: { id: 't1', status: 'stopped' }, handoff: { id: 'h1' } });
  });

  it('takes a thread over and cancels a handoff', async () => {
    const api = fakeApi();
    expect(await runMachineCommand(api, 't1', { type: 'takeOver' })).toMatchObject({ ok: true, handoff: { requested: true } });
    expect(api.takeOver).toHaveBeenCalledWith('t1');
    expect(await runMachineCommand(api, 't1', { type: 'cancel' })).toMatchObject({ ok: true, handoff: { state: { phase: 'cancelled' } } });
    expect(api.cancelHandoff).toHaveBeenCalledWith('t1');
  });

  it('keeps a null handoff, which is what a cancel of a settled request answers', async () => {
    const api = fakeApi({ cancelHandoff: vi.fn(async () => ({ thread: thread(), handoff: null })) });
    expect(await runMachineCommand(api, 't1', { type: 'cancel' })).toMatchObject({ ok: true, handoff: null });
  });

  it('returns a refusal as a failed outcome instead of throwing', async () => {
    const offline = fakeApi({ handOff: vi.fn(async () => Promise.reject(refusal(409, 'Studio is offline on Tailscale. Wake it, then try again.'))) });
    expect(await runMachineCommand(offline, 't1', { type: 'handOff', to: 'm2' })).toEqual({
      ok: false,
      kind: 'offline',
      error: 'Studio is offline on Tailscale. Wake it, then try again.',
    });

    const busy = fakeApi({ takeOver: vi.fn(async () => Promise.reject(refusal(409, 'This thread is already on its way between machines.'))) });
    expect(await runMachineCommand(busy, 't1', { type: 'takeOver' })).toMatchObject({ ok: false, kind: 'busy' });

    const revoked = fakeApi({ cancelHandoff: vi.fn(async () => Promise.reject(refusal(401, 'unauthorized'))) });
    expect(await runMachineCommand(revoked, 't1', { type: 'cancel' })).toEqual({ ok: false, kind: 'revoked', error: SIGNED_OUT_ERROR });

    const down = fakeApi({ handOff: vi.fn(async () => Promise.reject(unreachable())) });
    expect(await runMachineCommand(down, 't1', { type: 'handOff', to: 'm2' })).toMatchObject({ ok: false, kind: 'other' });
  });
});
