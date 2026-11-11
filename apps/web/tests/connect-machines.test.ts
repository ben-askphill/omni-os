// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

// Settings, Machines, Omni Connect: the relay sees this machine as offline until its tunnel is up, so the machine list
// asks again when the tunnel changes state, and every 30 seconds, rather than keeping the answer from when it opened.

let tunnel = 'starting';
let online = false;
const gets: string[] = [];

vi.mock('../src/api.ts', async (importActual) => {
  const actual = await importActual<typeof import('../src/api.ts')>();
  actual.api.get = vi.fn(async (path: string) => {
    gets.push(path);
    if (path === '/connect/machines')
      return { machines: [{ id: 'm1', name: 'omarchy', hostname: 'omarchy-1.omni-os.app', url: 'https://omarchy-1.omni-os.app', online, problem: null, current: true }] };
    return { enabled: true, relayReady: true, signedIn: true, hostname: 'omarchy-1.omni-os.app', url: 'https://omarchy-1.omni-os.app', connectPage: null, tunnel: { state: tunnel, error: null }, error: null };
  }) as typeof actual.api.get;
  return actual;
});

import { ConnectMachinesCard } from '../src/pages/Connect.tsx';

let root: Root;
let host: HTMLDivElement;
const machineGets = () => gets.filter((p) => p === '/connect/machines').length;
const flush = () => act(async () => {});

beforeEach(async () => {
  vi.useFakeTimers();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  tunnel = 'starting';
  online = false;
  gets.length = 0;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(createElement(ConnectMachinesCard)));
  await flush();
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('checks the machines again when the tunnel comes up', async () => {
  expect(machineGets()).toBe(1);
  expect(host.textContent).toContain('Offline · omarchy-1.omni-os.app');

  // The status poll sees the tunnel unchanged: no new health check.
  await act(async () => vi.advanceTimersByTime(5000));
  await flush();
  expect(machineGets()).toBe(1);

  tunnel = 'connected';
  online = true;
  await act(async () => vi.advanceTimersByTime(5000));
  await flush();
  expect(machineGets()).toBe(2);
  expect(host.textContent).not.toContain('Offline');
});

it('checks the machines every 30 seconds', async () => {
  online = true;
  await act(async () => vi.advanceTimersByTime(30_000));
  await flush();
  expect(machineGets()).toBe(2);
  expect(host.textContent).not.toContain('Offline');
});
