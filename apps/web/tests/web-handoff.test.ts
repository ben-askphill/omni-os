import { describe, expect, it } from 'vitest';
import type { Device, HandoffPhase, HandoffView, Takeover } from '@omni/shared/handoff.ts';
import { blockedNote, deviceRows, handoffBanner, handoffTargets, mayTakeOver, takeoverShown } from '../src/handoff.ts';

// What the Web UI shows for handing a thread to another synced Mac (apps/web/src/handoff.ts): when "Hand off to…" is
// offered, which Macs can be picked and how each reads, the banner per phase on the giving and the taking Mac, and when
// Take over is on offer for a thread another Mac holds.

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
  idle: false,
  requested: false,
});

/** A Take over as the asking Mac (the Air) sees it: the Pro holds the thread. */
const asked = (state: HandoffPhase): HandoffView => ({ ...view(state, false), requested: true });
const held = (over: Partial<Takeover> = {}): Takeover => ({
  from: { id: 'm-pro', name: "Ben's MacBook Pro" },
  to: { id: 'm-air', name: "Ben's MacBook Air" },
  running: true,
  refused: null,
  ...over,
});

const base = { status: 'running', blocked: null, handoff: null, takeover: null, sync: SYNC, devices: [air] };

describe('when the thread offers "Hand off to…"', () => {
  it('offers a running or queued thread on this Mac when another synced Mac exists', () => {
    expect(handoffTargets(base)).toEqual({ state: 'ready', devices: [air] });
    expect(handoffTargets({ ...base, status: 'queued' }).state).toBe('ready');
  });

  it('offers an idle thread too, to continue on the other Mac from the next message', () => {
    for (const status of ['done', 'stopped', 'failed']) expect(handoffTargets({ ...base, status }).state).toBe('ready');
    expect(handoffTargets({ ...base, status: undefined }).state).toBe('none');
  });

  it('does not offer a thread that runs on another Mac', () => {
    expect(handoffTargets({ ...base, blocked: "This thread is running on Ben's MacBook Air." }).state).toBe('none');
  });

  it('does not offer a thread another Mac holds between turns: only that Mac hands it off, this one takes it over', () => {
    expect(handoffTargets({ ...base, status: 'done', takeover: held({ running: false }) }).state).toBe('none');
    expect(handoffTargets({ ...base, status: 'done', takeover: held({ running: false, refused: 'It has crew threads running.' }) }).state).toBe('none');
  });

  it('does not offer it again while a handoff is under way, and does once that one settled', () => {
    expect(handoffTargets({ ...base, handoff: view({ phase: 'preparing', step: 'stopping' }) }).state).toBe('none');
    expect(handoffTargets({ ...base, handoff: view({ phase: 'offered', stale: true }) }).state).toBe('none');
    expect(handoffTargets({ ...base, handoff: asked({ phase: 'requested', stale: false }) }).state).toBe('none');
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
    const idle = { ...view({ phase: 'accepted' }), idle: true };
    expect(handoffBanner(idle, 'done')).toMatchObject({ size: 'line', text: "Handed off to Ben's MacBook Air. Your next message continues it there." });
    expect(handoffBanner({ ...idle, outgoing: false }, 'done')).toMatchObject({ text: "Handed off from Ben's MacBook Pro. Your next message continues it here." });
    expect(handoffBanner(view({ phase: 'cancelled' }), 'stopped')).toMatchObject({ size: 'line', tone: 'cancelled' });
  });

  it('shows a failure as an alert with no extra button, until the thread runs again', () => {
    const failed = view({ phase: 'failed', error: 'the upload failed', where: 'here' });
    expect(handoffBanner(failed, 'stopped')).toMatchObject({ size: 'card', tone: 'alert', cancel: false, text: expect.stringContaining('reply to continue it') });
    expect(handoffBanner(failed, 'running')).toBeNull();
    expect(handoffBanner(failed, 'queued')).toBeNull();
  });
});

describe('the handoff banner for a Take over', () => {
  it('on the asking Mac, is a card with Cancel while the other Mac has not answered, and an alert once it waited long', () => {
    expect(handoffBanner(asked({ phase: 'requested', stale: false }), 'running')).toEqual({
      size: 'card',
      tone: 'waiting',
      cancel: true,
      text: "Asking Ben's MacBook Pro to hand this thread over.",
    });
    expect(handoffBanner(asked({ phase: 'requested', stale: true }), 'running')).toMatchObject({
      size: 'card',
      tone: 'alert',
      cancel: true,
      text: expect.stringMatching(/^Ben's MacBook Pro has not answered\. It may be asleep/),
    });
  });

  it('shows a refusal or an expired request as an alert with nothing to cancel', () => {
    expect(handoffBanner(asked({ phase: 'declined', error: 'It has crew threads running' }), 'running')).toEqual({
      size: 'card',
      tone: 'alert',
      cancel: false,
      text: "Ben's MacBook Pro kept this thread: It has crew threads running.",
    });
    expect(handoffBanner(asked({ phase: 'expired' }), 'done')).toEqual({
      size: 'card',
      tone: 'alert',
      cancel: false,
      text: "Ben's MacBook Pro did not answer within an hour, so the request expired.",
    });
  });

  it('settles to one line in Take over words on both Macs', () => {
    expect(handoffBanner(asked({ phase: 'accepted' }), 'running')).toEqual({ size: 'line', tone: 'done', text: "Taken over from Ben's MacBook Pro. Running on this Mac." });
    expect(handoffBanner({ ...asked({ phase: 'accepted' }), outgoing: true }, 'stopped')).toMatchObject({ text: "Ben's MacBook Air took this thread over. Running there." });
  });
});

describe('Take over', () => {
  it('is on offer while another Mac holds the thread and nothing is moving it', () => {
    expect(mayTakeOver(held(), null)).toBe(true);
    expect(mayTakeOver(held({ running: false }), null)).toBe(true);
    for (const state of [{ phase: 'accepted' }, { phase: 'cancelled' }, { phase: 'expired' }, { phase: 'declined', error: 'busy' }, { phase: 'failed', error: 'x', where: 'here' }] as HandoffPhase[]) {
      expect(mayTakeOver(held(), asked(state))).toBe(true);
    }
  });

  it('is not on offer when no other Mac holds it, when that Mac refuses for now, or while a request or handoff is under way', () => {
    expect(mayTakeOver(null, null)).toBe(false);
    expect(mayTakeOver(undefined, null)).toBe(false);
    expect(mayTakeOver(held({ refused: 'It has crew threads running.' }), null)).toBe(false);
    for (const state of [{ phase: 'requested', stale: true }, { phase: 'preparing', step: 'stopping' }, { phase: 'offered', stale: false }] as HandoffPhase[]) {
      expect(mayTakeOver(held(), asked(state))).toBe(false);
    }
  });

  it('shows its note with the refusal too, and hides it while the handoff card has the floor', () => {
    const refused = held({ refused: 'It has crew threads running.' });
    expect(takeoverShown(refused, null)).toBe(refused);
    expect(takeoverShown(held(), asked({ phase: 'requested', stale: false }))).toBeNull();
    expect(takeoverShown(null, null)).toBeNull();
  });
});

describe('the note over the composer', () => {
  it('stays out while the handoff card says the same thing, and shows otherwise', () => {
    const waiting = view({ phase: 'offered', stale: false });
    const text = handoffBanner(waiting, 'stopped')!.text;
    expect(blockedNote(text, waiting, 'stopped', null)).toBeNull();
    expect(blockedNote('This thread is running on Ben\'s MacBook Air.', view({ phase: 'accepted' }), 'running', null)).toBe("This thread is running on Ben's MacBook Air.");
    expect(blockedNote("Omni is still preparing this thread's worktree.", null, 'queued', null)).toBe("Omni is still preparing this thread's worktree.");
  });

  it('stays out while the Take over note says the thread runs on the other Mac', () => {
    const running = "This thread is running on Ben's MacBook Pro.";
    expect(blockedNote(running, null, 'running', held())).toBeNull();
    expect(blockedNote(running, null, 'running', held({ refused: 'It has crew threads running.' }))).toBeNull();
    expect(blockedNote(running, null, 'running', null)).toBe(running);
  });

  it('stays out while a Take over waits, since its card says why no turn starts here', () => {
    const waiting = asked({ phase: 'requested', stale: false });
    expect(blockedNote(handoffBanner(waiting, 'running')!.text, waiting, 'running', null)).toBeNull();
    expect(blockedNote("This thread is running on Ben's MacBook Air.", waiting, 'running', null)).toBeNull();
  });
});
