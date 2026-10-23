import { describe, expect, it } from 'vitest';
import type { Device, HandoffPhase, HandoffView } from '@omni/shared/handoff.ts';
import { deviceRows, handoffBanner, handoffTargets } from '../src/handoff.ts';

// What the Web UI shows for handing a thread to another synced Mac (apps/web/src/handoff.ts): when "Hand off to…" is
// offered, which Macs can be picked and how each reads, and the banner per phase on the giving and the taking Mac.

const NOW = Date.parse('2026-10-23T12:00:00Z');
const SYNC = { configured: true, enabled: true, signedOut: false };
const air: Device = { id: 'm-air', name: "Ben's MacBook Air", reachability: 'online', dnsName: 'air.tail.ts.net', lastSeen: null };
const studio: Device = { id: 'm-studio', name: 'Studio', reachability: 'offline', dnsName: 'studio.tail.ts.net', lastSeen: '2026-10-23T11:40:00Z' };
const mini: Device = { id: 'm-mini', name: 'Mini', reachability: 'unknown', dnsName: null, lastSeen: null };

const view = (state: HandoffPhase, outgoing = true, leftBehind: string | null = null): HandoffView => ({
  id: 'offer-1',
  from: { id: 'm-pro', name: "Ben's MacBook Pro" },
  to: { id: 'm-air', name: "Ben's MacBook Air" },
  outgoing,
  at: '2026-10-23T11:59:00Z',
  state,
  leftBehind,
});

const base = { status: 'running', blocked: null, handoff: null, sync: SYNC, devices: [air] };

describe('when the thread offers "Hand off to…"', () => {
  it('offers a running or queued thread on this Mac when another synced Mac exists', () => {
    expect(handoffTargets(base)).toEqual({ state: 'ready', devices: [air] });
    expect(handoffTargets({ ...base, status: 'queued' }).state).toBe('ready');
  });

  it('does not offer a thread that is not running here', () => {
    for (const status of ['done', 'stopped', 'failed', undefined]) expect(handoffTargets({ ...base, status }).state).toBe('none');
    expect(handoffTargets({ ...base, blocked: "This thread is running on Ben's MacBook Air." }).state).toBe('none');
  });

  it('does not offer it again while a handoff is under way, and does once that one settled', () => {
    expect(handoffTargets({ ...base, handoff: view({ phase: 'preparing', step: 'stopping' }) }).state).toBe('none');
    expect(handoffTargets({ ...base, handoff: view({ phase: 'offered', stale: true }) }).state).toBe('none');
    expect(handoffTargets({ ...base, handoff: view({ phase: 'cancelled' }) }).state).toBe('ready');
    expect(handoffTargets({ ...base, handoff: view({ phase: 'failed', error: 'no session', where: 'here' }) }).state).toBe('ready');
  });

  it('needs sync to carry the offer, and says why not', () => {
    expect(handoffTargets({ ...base, sync: { ...SYNC, configured: false } })).toMatchObject({ state: 'none', reason: expect.stringMatching(/^Sign in to sync/) });
    expect(handoffTargets({ ...base, sync: { ...SYNC, signedOut: true } })).toMatchObject({ state: 'none', reason: expect.stringMatching(/^Sign in to sync/) });
    expect(handoffTargets({ ...base, sync: { ...SYNC, enabled: false } })).toMatchObject({ state: 'none', reason: expect.stringMatching(/paused/) });
  });

  it('waits for the answers, and offers nothing with no other Mac', () => {
    expect(handoffTargets({ ...base, sync: undefined }).state).toBe('loading');
    expect(handoffTargets({ ...base, devices: undefined }).state).toBe('loading');
    expect(handoffTargets({ ...base, devices: [] }).state).toBe('none');
  });
});

describe('the device picker', () => {
  it('lists online Macs first, then ones Tailscale cannot check, then asleep ones', () => {
    expect(deviceRows([studio, mini, air], NOW).map((d) => d.name)).toEqual(["Ben's MacBook Air", 'Mini', 'Studio']);
  });

  it('reads each Mac by reachability, and only an offline one cannot be picked', () => {
    const [online, unknown, offline] = deviceRows([studio, mini, air], NOW);
    expect(online).toMatchObject({ id: 'm-air', pickable: true, dot: 'done', label: 'Online on Tailscale' });
    expect(unknown).toMatchObject({ pickable: true, label: "Can't check Tailscale" });
    expect(offline).toMatchObject({ pickable: false, label: 'Asleep or offline, last seen 20m ago' });
    expect(deviceRows([{ ...studio, lastSeen: null }], NOW)[0]!.label).toBe('Asleep or offline');
  });
});

describe('the handoff banner', () => {
  it('shows nothing without a handoff', () => {
    expect(handoffBanner(null, 'running')).toBeNull();
  });

  it('on the giving Mac, is a card with Cancel until the other Mac takes it', () => {
    expect(handoffBanner(view({ phase: 'preparing', step: 'uploading' }), 'stopped')).toEqual({
      size: 'card',
      tone: 'working',
      cancel: true,
      text: "Handing off to Ben's MacBook Air: uploading the session.",
    });
    expect(handoffBanner(view({ phase: 'offered', stale: false }), 'stopped')).toMatchObject({ size: 'card', tone: 'waiting', cancel: true, text: "Waiting for Ben's MacBook Air to pick it up." });
    // Not picked up in time: it may still take it, so it stays cancellable, and reads as needing a look.
    expect(handoffBanner(view({ phase: 'offered', stale: true }), 'stopped')).toMatchObject({ size: 'card', tone: 'alert', cancel: true });
  });

  it('on the taking Mac, is a card with nothing to press while it picks the thread up', () => {
    expect(handoffBanner(view({ phase: 'offered', stale: false }, false), 'stopped')).toMatchObject({ size: 'card', cancel: false, text: "Picking this thread up from Ben's MacBook Pro." });
    expect(handoffBanner(view({ phase: 'preparing', step: 'packing' }, false), 'running')).toMatchObject({ size: 'card', cancel: false });
  });

  it('turns to one quiet line once accepted or cancelled', () => {
    expect(handoffBanner(view({ phase: 'accepted' }), 'stopped')).toEqual({ size: 'line', tone: 'done', text: "Running on Ben's MacBook Air. Handed off from this Mac." });
    expect(handoffBanner(view({ phase: 'accepted' }, false), 'running')).toMatchObject({ size: 'line', text: "Handed off from Ben's MacBook Pro. Running on this Mac." });
    expect(handoffBanner(view({ phase: 'cancelled' }), 'stopped')).toMatchObject({ size: 'line', tone: 'cancelled' });
  });

  it('shows a failure as an alert with no extra button, until the thread runs again', () => {
    const failed = view({ phase: 'failed', error: 'the upload failed', where: 'here' });
    expect(handoffBanner(failed, 'stopped')).toMatchObject({ size: 'card', tone: 'alert', cancel: false, text: expect.stringContaining('reply to continue it') });
    expect(handoffBanner(failed, 'running')).toBeNull();
    expect(handoffBanner(failed, 'queued')).toBeNull();
  });
});
