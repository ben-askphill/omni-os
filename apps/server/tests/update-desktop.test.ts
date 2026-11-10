import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { DesktopUpdateView } from '@omni/shared/desktop-bridge.ts';
import type { DesktopUpdateReply, DesktopUpdateReport, FleetMachine, FleetView } from '@omni/shared/update-fleet.ts';
import { wireFixture } from './fixture-shape.ts';
import { startRunner } from './runner-boot.ts';

// The packaged desktop app's server. The app's main process reports its updater to POST /api/update/desktop and runs
// the command each reply names, so an update asked here or from another machine reaches the app's own updater. One
// server with sync off, so the list is this machine alone.

let app: typeof import('../app.ts').app;
let tracks: typeof import('../update-tracks.ts');
let fleet: typeof import('../update-fleet.ts');
let update: typeof import('../update.ts');
let running = 0;

beforeAll(async () => {
  await startRunner();
  ({ app } = await import('../app.ts'));
  tracks = await import('../update-tracks.ts');
  fleet = await import('../update-fleet.ts');
  update = await import('../update.ts');
  fleet.configureFleet({ track: new tracks.DesktopTrack({ runningTurns: () => running, sleep: () => new Promise((resolve) => setTimeout(resolve, 1)) }) });
});

const json = async (path: string, body?: unknown) => {
  const res = await app.request(`/api${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as any };
};
const report = (view: DesktopUpdateView, done: string | null = null): Promise<{ status: number; body: DesktopUpdateReply }> =>
  json('/update/desktop', { version: '0.4.1', view, done } satisfies DesktopUpdateReport);
const own = async (): Promise<FleetMachine> => ((await json('/update/fleet')).body as FleetView).machines[0];
const READY: DesktopUpdateView = { state: 'ready', version: '0.4.2' };

describe('the desktop app’s server', () => {
  it('is this machine alone, on the desktop track, not checked until the app reports', async () => {
    const v = (await json('/update/fleet')).body as FleetView;
    expect(v.synced).toBe(false);
    expect(v.machines).toEqual([expect.objectContaining({ id: 'here', current: true, state: 'idle', status: expect.objectContaining({ track: 'desktop', version: null }) })]);
    expect((await report({ state: 'idle', checkedAt: null })).body).toEqual({ command: null });
    expect(await own()).toMatchObject({ state: 'idle', status: { version: '0.4.1' } });
  });

  it('Download hands the app one download command with every reply until the app says it is done', async () => {
    expect((await json('/update/fleet', { action: 'download' })).status).toBe(202);
    const first = (await report({ state: 'checking' })).body;
    expect(first.command).toMatchObject({ action: 'download' });
    wireFixture('update-desktop.json', first);
    const downloading: DesktopUpdateReport = { version: '0.4.1', view: { state: 'downloading', version: '0.4.2', percent: 40 }, done: null };
    wireFixture('update-desktop-request.json', downloading);
    expect((await json('/update/desktop', downloading)).body.command).toEqual(first.command);
    expect(await own()).toMatchObject({ state: 'downloading', status: { progress: 40, available: '0.4.2' } });
    expect((await report(READY, first.command!.id)).body).toEqual({ command: null });
    expect((await own()).state).toBe('ready');
  });

  it('Update waits for the running turn before it has the app install', async () => {
    running = 1;
    expect((await json('/update/fleet', { action: 'update' })).status).toBe(202);
    expect(await own()).toMatchObject({ state: 'waiting', status: { waitingFor: 1 } });
    expect((await report(READY)).body).toEqual({ command: null });
    running = 0;
    const install = await vi.waitFor(async () => {
      const { command } = (await report(READY)).body;
      expect(command).toMatchObject({ action: 'install' });
      return command!;
    });
    expect((await own()).state).toBe('restarting');
    expect((await report(READY, install.id)).body).toEqual({ command: null });
    expect((await own()).state).toBe('restarting');
  });

  it('drops the update once the app finds nothing new, so a later download does not install by itself', async () => {
    expect((await report({ state: 'idle', checkedAt: null })).body).toEqual({ command: null });
    expect((await json('/update/fleet', { action: 'update' })).status).toBe(202);
    const { command } = (await report({ state: 'checking' })).body;
    expect(command).toMatchObject({ action: 'download' });
    await report({ state: 'idle', checkedAt: new Date(Date.now() + 1_000).toISOString() }, command!.id);
    expect((await report(READY)).body).toEqual({ command: null });
    expect((await own()).state).toBe('ready');
  });

  it('keeps an update asked while the app still shows its last failure, until the app has acted on it', async () => {
    await report({ state: 'error', message: 'net down' });
    expect((await json('/update/fleet', { action: 'update' })).status).toBe(202);
    const { command } = (await report({ state: 'error', message: 'net down' })).body;
    expect(command).toMatchObject({ action: 'download' });
    await report({ state: 'downloading', version: '0.4.3', percent: 50 }, command!.id);
    const install = await vi.waitFor(async () => {
      const next = (await report({ state: 'ready', version: '0.4.3' }, command!.id)).body.command;
      expect(next).toMatchObject({ action: 'install' });
      return next!;
    });
    await report({ state: 'ready', version: '0.4.3' }, install.id);
  });

  it('drops an update nobody finished in its window, so the app never relaunches long after the ask', async () => {
    await report({ state: 'available', version: '0.4.4' });
    await json('/update/fleet', { action: 'update' });
    const { command } = (await report({ state: 'available', version: '0.4.4' })).body;
    expect(command).toMatchObject({ action: 'download' });
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(Date.now() + 31 * 60_000);
      expect((await report({ state: 'ready', version: '0.4.4' }, command!.id)).body).toEqual({ command: null });
      expect((await report({ state: 'ready', version: '0.4.4' }, command!.id)).body).toEqual({ command: null });
      expect((await own()).state).toBe('ready');
    } finally {
      vi.useRealTimers();
    }
  });

  it('makes the pages refetch only for a report that moved something, not for each of the app’s ticks', async () => {
    const { bus } = await import('../bus.ts');
    await report(READY);
    const updates: unknown[] = [];
    const listen = (e: { type: string }) => e.type === 'update' && updates.push(e);
    bus.on('feed', listen);
    try {
      await report(READY);
      await report(READY);
      expect(updates).toHaveLength(0);
      await report({ state: 'downloading', version: '0.4.3', percent: 10 });
      expect(updates).toHaveLength(1);
    } finally {
      bus.off('feed', listen);
    }
  });

  it('a copy of the app that cannot update itself is applied by hand, and Update leaves it out', async () => {
    await report({ state: 'unsupported', reason: 'This build has no update feed.' });
    expect(await own()).toMatchObject({ status: { track: 'manual' } });
    const res = await json('/update/fleet', { action: 'update' });
    expect(res.body.skipped).toEqual([expect.objectContaining({ id: 'here', reason: expect.stringMatching(/by hand/) })]);
  });

  it('a server that is not the app’s answers no command, and refuses a report that is not one', async () => {
    const updater = new update.Updater({
      root: '/nowhere',
      current: () => 'abc',
      supervised: () => true,
      bundled: false,
      enabled: () => true,
      runningTurns: () => 0,
      install: async () => null,
      restart: () => {},
      sleep: async () => {},
      changed: () => {},
    });
    fleet.configureFleet({ track: new tracks.CheckoutTrack(updater) });
    expect((await report(READY)).body).toEqual({ command: null });
    expect((await own()).status?.track).toBe('checkout');
    const bad = await json('/update/desktop', { version: 1, view: { state: 'ready' } });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toEqual(expect.any(String));
  });
});
