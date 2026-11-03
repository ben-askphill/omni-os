// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { DEFAULT_DESKTOP_SETTINGS, type DesktopBridge, type DesktopServerInfo, type DesktopUpdateView } from '@omni/shared/desktop-bridge.ts';

// Settings > Desktop app, against a fake bridge: what it says about the server behind the window and the app's update.

vi.mock('../src/api.ts', () => ({ api: { get: async () => [], post: async () => ({}) }, errorText: String, useApi: () => ({ data: null }) }));

const { DesktopSection } = await import('../src/pages/SettingsDesktop.tsx');

const bridgeWith = (info: DesktopServerInfo, update: DesktopUpdateView) =>
  ({
    platform: 'linux',
    version: '0.2.0',
    packaged: true,
    loginItemSupported: false,
    onEvent: () => () => {},
    settings: { get: async () => DEFAULT_DESKTOP_SETTINGS, set: async () => DEFAULT_DESKTOP_SETTINGS },
    quickPrompt: { status: async () => ({ registered: true, wispr: false, visible: false }), open: () => {} },
    updates: { get: async () => update, check: async () => update, install: () => {} },
    server: { info: async () => info, showLog: () => {} },
  }) as unknown as DesktopBridge;

let root: Root | null = null;
let host: HTMLElement;
async function render(bridge: DesktopBridge) {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(createElement(DesktopSection, { bridge })));
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

describe('Settings > Desktop app', () => {
  it("offers the log of the app's own server", async () => {
    const el = await render(bridgeWith(info(true), { state: 'idle', checkedAt: null }));
    expect(el.textContent).toContain('Port 4803, started by this app');
    expect(el.textContent).toContain('/home/u/.local/state/omni-os/server.log');
    expect(buttons(el)).toContain('Show Log');
  });

  it('shows no log for a server the app attached to, which writes somewhere else', async () => {
    const el = await render(bridgeWith(info(false), { state: 'idle', checkedAt: null }));
    expect(el.textContent).toContain('Port 4803, started outside this app');
    expect(el.textContent).not.toContain('server.log');
    expect(buttons(el)).not.toContain('Show Log');
  });

  it('words a ready update as the sidebar does', async () => {
    const el = await render(bridgeWith(info(true), { state: 'ready', version: '0.3.0' }));
    expect(el.textContent).toContain('Omni 0.3.0 is ready');
    expect(buttons(el)).toContain('Relaunch to Update');
  });

  it('draws no login card where the OS opens no app at login', async () => {
    const el = await render(bridgeWith(info(true), { state: 'idle', checkedAt: null }));
    expect(el.querySelector('#setting-desktop-quick-prompt')).not.toBeNull();
    expect(el.querySelector('#setting-desktop-login')).toBeNull();
  });
});
