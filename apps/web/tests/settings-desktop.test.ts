// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { DEFAULT_DESKTOP_SETTINGS, type DesktopBridge, type DesktopReleaseNotes, type DesktopServerInfo, type DesktopUpdateView } from '@omni/shared/desktop-bridge.ts';

// The desktop app's settings against a fake bridge: About's rows for the server behind the window, the app's updates
// in Machines, and the Desktop app section linking to both.

vi.mock('../src/api.ts', () => ({ api: { get: async () => [], post: async () => ({}) }, errorText: String, useApi: () => ({ data: null }) }));

const { AppServerRows, AppUpdatesCard, DesktopSection } = await import('../src/pages/SettingsDesktop.tsx');

const bridgeWith = (info: DesktopServerInfo, update: DesktopUpdateView, calls: string[] = []) =>
  ({
    platform: 'linux',
    version: '0.2.0',
    packaged: true,
    loginItemSupported: false,
    onEvent: () => () => {},
    settings: { get: async () => DEFAULT_DESKTOP_SETTINGS, set: async () => DEFAULT_DESKTOP_SETTINGS },
    quickPrompt: { status: async () => ({ registered: true, wispr: false, visible: false }), open: () => {} },
    updates: {
      get: async () => update,
      check: async () => (calls.push('check'), update),
      download: async () => (calls.push('download'), update),
      install: () => void calls.push('install'),
    },
    server: { info: async () => info, showLog: () => {} },
  }) as unknown as DesktopBridge;

let root: Root | null = null;
let host: HTMLElement;
async function render(bridge: DesktopBridge, part: typeof DesktopSection = AppUpdatesCard) {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(createElement(part, { bridge })));
  await act(async () => void (await new Promise((r) => setTimeout(r, 5))));
  return host;
}
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host.remove();
});

const info = (startedHere: boolean): DesktopServerInfo => ({ port: 4803, dataDir: '/d', logFile: '/home/u/.local/state/omni-os/server.log', startedHere });
const buttons = (el: HTMLElement) => [...el.querySelectorAll('button')].map((b) => b.textContent?.trim());
const updates = (el: HTMLElement) => el.querySelector('#setting-desktop-updates') as HTMLElement;
const click = async (el: HTMLElement, label: string) => {
  const button = [...el.querySelectorAll('button')].find((b) => b.textContent?.trim() === label);
  if (!button) throw new Error(`no ${label} button`);
  await act(async () => button.click());
};

describe('Settings > Desktop app', () => {
  it("offers the log of the app's own server", async () => {
    const el = await render(bridgeWith(info(true), { state: 'idle', checkedAt: null }), AppServerRows);
    expect(el.textContent).toContain('Port 4803, started by this app');
    expect(el.textContent).toContain('/home/u/.local/state/omni-os/server.log');
    expect(buttons(el)).toContain('Show log');
  });

  it('shows no log for a server the app attached to, which writes somewhere else', async () => {
    const el = await render(bridgeWith(info(false), { state: 'idle', checkedAt: null }), AppServerRows);
    expect(el.textContent).toContain('Port 4803, started outside this app');
    expect(el.textContent).not.toContain('server.log');
    expect(buttons(el)).not.toContain('Show log');
  });

  it('links to the pages that hold zoom, updates and the server', async () => {
    const el = await render(bridgeWith(info(true), { state: 'idle', checkedAt: null }), DesktopSection);
    const links = [...el.querySelectorAll('a')].map((a) => [a.textContent, a.getAttribute('href')]);
    expect(links).toEqual([
      ['Zoom is in Appearance', '#/settings/appearance?focus=zoom'],
      ['Updates are in Machines', '#/settings/machines?focus=desktop-updates'],
      ['Server, data folder and log are in About', '#/settings/about?focus=server'],
    ]);
    expect(el.querySelector('#setting-desktop-updates')).toBeNull();
  });

  it('words a ready update as the sidebar does, and relaunches to install it', async () => {
    const calls: string[] = [];
    const el = await render(bridgeWith(info(true), { state: 'ready', version: '0.3.0' }, calls));
    expect(updates(el).textContent).toContain('Omni 0.3.0 is ready');
    await click(updates(el), 'Relaunch to update');
    expect(calls).toEqual(['install']);
  });

  it('shows this version with Check for updates and Check automatically', async () => {
    const calls: string[] = [];
    const el = await render(bridgeWith(info(true), { state: 'idle', checkedAt: null }, calls));
    expect(updates(el).textContent).toContain('Omni 0.2.0');
    expect(updates(el).textContent).toContain('Check automatically');
    expect(updates(el).querySelector('[role="switch"]')?.getAttribute('aria-checked')).toBe('true');
    await click(updates(el), 'Check for updates');
    expect(calls).toEqual(['check']);
  });

  it('offers Download for a found update, with its release notes and page', async () => {
    const notes: DesktopReleaseNotes = { lines: ['Show updates in Settings (#556)'], more: 4, url: 'https://github.com/o/r/releases/tag/v0.3.0' };
    const calls: string[] = [];
    const el = await render(bridgeWith(info(true), { state: 'available', version: '0.3.0', notes }, calls));
    const card = updates(el);
    expect(card.textContent).toContain('Omni 0.3.0 is available');
    expect(card.textContent).toContain('What is new in 0.3.0');
    expect(card.querySelector('li')?.textContent).toBe('Show updates in Settings (#556)');
    expect(card.textContent).toContain('And 4 more.');
    expect(card.querySelector('a')?.getAttribute('href')).toBe(notes.url);
    await click(card, 'Download');
    expect(calls).toEqual(['download']);
  });

  it('shows the download as ticks', async () => {
    const el = await render(bridgeWith(info(true), { state: 'downloading', version: '0.3.0', percent: 40 }));
    expect(updates(el).textContent).toContain('Downloading Omni 0.3.0');
    expect(updates(el).querySelector('[role="meter"]')?.getAttribute('aria-valuenow')).toBe('40');
  });

  it('says why a development build does not update, without a check or the switch', async () => {
    const el = await render(bridgeWith(info(true), { state: 'unsupported', reason: 'A development build does not update itself.' }));
    expect(updates(el).textContent).toContain('A development build does not update itself.');
    expect(updates(el).textContent).not.toContain('Check automatically');
    expect(buttons(updates(el))).not.toContain('Check for updates');
  });

  it('draws no login card where the OS opens no app at login', async () => {
    const el = await render(bridgeWith(info(true), { state: 'idle', checkedAt: null }), DesktopSection);
    expect(el.querySelector('#setting-desktop-quick-prompt')).not.toBeNull();
    expect(el.querySelector('#setting-desktop-login')).toBeNull();
  });
});
