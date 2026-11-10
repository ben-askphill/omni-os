// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { rowState, type FleetMachine, type FleetRequest, type FleetSkip, type FleetView, type MachineUpdateStatus } from '@omni/shared/update-fleet.ts';

// Settings, Machines, Update all machines: one row per machine in the state that machine reports, a Retry or Update
// button where one helps, a confirm before Update all that names who is left out, and a list that follows the feed.

const NOW = Date.parse('2026-11-10T12:00:00Z');
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();

const status = (id: string, over: Partial<MachineUpdateStatus>): MachineUpdateStatus => ({
  id,
  name: id,
  track: 'checkout',
  version: 'a1b2c3d4',
  available: null,
  behind: null,
  phase: 'up-to-date',
  progress: null,
  waitingFor: 0,
  error: null,
  taken: {},
  since: ago(1),
  ...over,
});

const machine = (m: Pick<FleetMachine, 'id' | 'name'> & Partial<FleetMachine>): FleetMachine => {
  const row = { current: false, reach: 'online' as const, status: null, ask: null, ...m };
  return { ...row, state: rowState(row, NOW) };
};

const fleet = (): FleetView => ({
  synced,
  machines: [
    machine({ id: 'here', name: 'omarchy', current: true, status: status('here', { phase: 'downloading', progress: 42, available: 'e5f6a7b8' }) }),
    machine({ id: 'studio', name: 'studio', status: status('studio', { track: 'desktop', version: '0.4.1', phase: 'waiting', waitingFor: 2, since: ago(5) }) }),
    machine({
      id: 'laptop',
      name: 'laptop',
      status: status('laptop', { phase: 'failed', error: 'git fetch failed: network unreachable', taken: { here: 'a' } }),
      ask: { id: 'a', sender: 'here', target: 'laptop', action: 'download', at: ago(10), expiresAt: ago(-20) },
    }),
    machine({ id: 'mini', name: 'mini', reach: 'offline', status: status('mini', {}) }),
    machine({ id: 'old', name: 'old-mac' }),
    machine({ id: 'nuc', name: 'nuc', status: status('nuc', { phase: 'ready', available: 'ffff0000', behind: 3 }) }),
    machine({ id: 'pi', name: 'pi', status: status('pi', { track: 'manual', phase: 'available', available: 'ffff0000' }) }),
  ],
});

const HERE_COMMIT = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3';
let synced = true;
let skippedReply: FleetSkip[] = [];
const gets: string[] = [];
const fleetGets = () => gets.filter((p) => p === '/update/fleet');
const posts: { path: string; body: FleetRequest }[] = [];
const feed = vi.hoisted(() => ({ fn: null as null | ((e: { type: string }) => void) }));

vi.mock('../src/api.ts', async (importActual) => {
  const actual = await importActual<typeof import('../src/api.ts')>();
  actual.api.get = vi.fn(async (path: string) => {
    gets.push(path);
    if (path === '/update') return { current: HERE_COMMIT, phase: 'idle', behind: 3, commits: [], waitingFor: 0, error: null, canApply: true };
    return fleet();
  }) as typeof actual.api.get;
  actual.api.post = vi.fn(async (path: string, body: unknown) => {
    posts.push({ path, body: body as FleetRequest });
    return { ...fleet(), skipped: skippedReply };
  }) as typeof actual.api.post;
  return actual;
});

vi.mock('../src/store.tsx', async (importActual) => ({
  ...(await importActual<typeof import('../src/store.tsx')>()),
  useFeed: (fn: (e: { type: string }) => void) => {
    feed.fn = fn;
  },
}));

import { UpdateMachinesCard } from '../src/pages/UpdateMachines.tsx';

let root: Root;
let host: HTMLDivElement;
const flush = () => act(async () => {});
const rows = () => [...host.querySelectorAll('li')].filter((li) => !li.closest('[role="dialog"]'));
const row = (name: string) => rows().find((li) => li.querySelector('span.truncate')?.textContent === name)!;
const button = (scope: ParentNode, label: string) => [...scope.querySelectorAll('button')].find((b) => b.textContent === label) as HTMLButtonElement | undefined;
const click = async (b: HTMLButtonElement | undefined) => {
  await act(async () => b!.click());
  await flush();
};
const dialog = () => host.querySelector('[role="dialog"]');

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  synced = true;
  skippedReply = [];
  gets.length = 0;
  posts.length = 0;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(createElement(UpdateMachinesCard)));
  await flush();
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('says each machine\'s state, how long it has lasted, its version, its progress and its error', () => {
  expect(host.textContent).toContain('0 of 7 up to date, 2 in progress, 1 failed');

  const here = row('omarchy');
  expect(here.textContent).toContain('Downloading 42%');
  expect(here.textContent).toContain('This machine');
  expect(here.textContent).toContain('a1b2c3d4 → e5f6a7b8');
  expect(here.querySelector('[role="meter"]')?.getAttribute('aria-valuenow')).toBe('42');

  expect(row('studio').textContent).toContain('Waiting for 2 running turns');
  expect(row('studio').textContent).toContain('since 5m ago');
  expect(row('studio').textContent).toContain('Desktop app');

  expect(row('laptop').textContent).toContain('Failed');
  expect(row('laptop').textContent).toContain('git fetch failed: network unreachable');
  expect(row('mini').textContent).toContain('Offline');
  expect(row('mini').textContent).toContain('Retry asks it anyway');
  expect(row('old-mac').textContent).toContain('Not reporting');
  expect(row('nuc').textContent).toContain('3 new commits, ready to update');
  expect(row('pi').textContent).toContain('It cannot apply an update by itself');
});

it('puts Retry on a failed or offline machine and Update on one that is ready, and nowhere else', () => {
  const buttons = rows().map((li) => [li.querySelector('span.truncate')?.textContent, [...li.querySelectorAll('button')].map((b) => b.textContent)]);
  expect(buttons).toEqual([
    ['omarchy', []],
    ['studio', []],
    ['laptop', ['Retry']],
    ['mini', ['Retry']],
    ['old-mac', []],
    ['nuc', ['Update']],
    ['pi', []],
  ]);
});

it('sends a failed machine\'s last ask again to it alone, and an offline one with force', async () => {
  await click(button(row('laptop'), 'Retry'));
  expect(posts.at(-1)).toEqual({ path: '/update/fleet', body: { action: 'download', machines: ['laptop'], force: true } });

  await click(button(row('mini'), 'Retry'));
  expect(posts.at(-1)?.body).toEqual({ action: 'check', machines: ['mini'], force: true });

  await click(button(row('nuc'), 'Update'));
  expect(posts.at(-1)?.body).toEqual({ action: 'update', machines: ['nuc'] });
});

it('checks and downloads everywhere without asking first', async () => {
  await click(button(host, 'Check'));
  expect(posts.at(-1)?.body).toEqual({ action: 'check' });
  await click(button(host, 'Download all'));
  expect(posts.at(-1)?.body).toEqual({ action: 'download' });
  expect(dialog()).toBeNull();
});

it('asks before Update all, names who is asked and who is left out, and then sends it', async () => {
  await click(button(host, 'Update all'));
  expect(posts).toEqual([]);

  const d = dialog()!;
  expect(d.textContent).toContain('Update 3 machines?');
  const asked = [...d.querySelectorAll('li div.truncate')].map((n) => n.textContent);
  expect(asked).toEqual(['omarchy', 'laptop', 'nuc']);
  expect(d.textContent).toContain('a1b2c3d4 → e5f6a7b8');
  expect(d.textContent).toContain('studio.');
  expect(d.textContent).toContain('Already updating.');
  expect(d.textContent).toContain('old-mac.');
  expect(d.textContent).toContain('Runs an older Omni');
  expect(d.textContent).toContain('A machine with running turns restarts once they finish.');
  expect(d.textContent).toContain('this page reconnects when it is back');

  await click(button(d, 'Cancel'));
  expect(dialog()).toBeNull();
  expect(posts).toEqual([]);

  await click(button(host, 'Update all'));
  await click(button(dialog()!, 'Update 3 machines'));
  expect(posts).toEqual([{ path: '/update/fleet', body: { action: 'update' } }]);
  expect(dialog()).toBeNull();
});

it('marks the page to load the new build when Update all restarts this checkout, and not when the server left it out', async () => {
  sessionStorage.clear();
  skippedReply = [{ id: 'here', name: 'omarchy', reason: 'Already updating.' }];
  await click(button(host, 'Update all'));
  await click(button(dialog()!, 'Update 3 machines'));
  expect(sessionStorage.getItem('omni.update.from')).toBeNull();

  skippedReply = [];
  await click(button(host, 'Update all'));
  await click(button(dialog()!, 'Update 3 machines'));
  expect(sessionStorage.getItem('omni.update.from')).toBe(HERE_COMMIT);
  sessionStorage.clear();
});

it('shows who the server left out after a request, then lets it go', async () => {
  skippedReply = [{ id: 'mini', name: 'mini', reason: 'Offline. Retry asks it anyway: it takes the ask when it next syncs.' }];
  await click(button(host, 'Download all'));
  expect(host.querySelector('[role="status"]')?.textContent).toContain('mini. Offline. Retry asks it anyway');

  await act(async () => vi.advanceTimersByTime(10_000));
  expect(host.querySelector('[role="status"]')).toBeNull();
});

it('reads the list again on a feed update or reconnect and every 15 seconds', async () => {
  expect(fleetGets()).toEqual(['/update/fleet']);
  await act(async () => feed.fn!({ type: 'update' }));
  await flush();
  expect(fleetGets()).toHaveLength(2);
  await act(async () => feed.fn!({ type: 'reconnect' }));
  await flush();
  expect(fleetGets()).toHaveLength(3);
  await act(async () => feed.fn!({ type: 'thread' }));
  await flush();
  expect(fleetGets()).toHaveLength(3);

  await act(async () => vi.advanceTimersByTime(15_000));
  await flush();
  expect(fleetGets()).toHaveLength(4);
});

it('points at Sync when no other machine is synced', async () => {
  expect(host.textContent).not.toContain('Only this machine is listed');
  synced = false;
  await act(async () => feed.fn!({ type: 'update' }));
  await flush();
  expect(host.textContent).toContain('Only this machine is listed');
  expect(host.querySelector('a')?.getAttribute('href')).toBe('#/settings/sync');
});
