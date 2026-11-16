// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { DEFAULT_DESKTOP_SETTINGS, type DesktopBridge, type DesktopSettings } from '@omni/shared/desktop-bridge.ts';

// The setup wizard against what has shipped: the Harnesses step reads #757's reasons as text and offers Install only
// for a missing CLI, the copy follows the install (desktop app or checkout) and the layout, and a Notifications step
// asks up front.

let harnesses: unknown[] = [];
vi.mock('../src/api.ts', () => ({ api: { get: async () => harnesses, post: async () => ({}), put: async () => ({}) }, errorText: String }));

const { HarnessScreen, NotificationsScreen, STEPS } = await import('../src/components/onboarding-parts.tsx');
const { SavedNote, addChannelHint, offersNpmSetup } = await import('../src/components/Onboarding.tsx');

let root: Root | null = null;
let host: HTMLElement;
async function render(el: ReactElement) {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(el));
  await act(async () => void (await new Promise((r) => setTimeout(r, 5))));
  return host;
}
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host.remove();
});

const text = (el: Element | null) => el?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
const labels = (row: Element) => [...row.querySelectorAll('span.w-12')].map((s) => s.textContent);
const row = (el: HTMLElement, id: string) => el.querySelector(`[data-harness="${id}"]`)!;

describe('Harnesses step', () => {
  it('signed out, missing and a reason each read as what they are', async () => {
    const noCodex = 'Omni found no codex on its PATH. Install Codex or set OMNI_CODEX_BIN to its path';
    harnesses = [
      { id: 'claude-code', name: 'Claude Code', plan: 'Claude plan', available: true, models: [], running: 0, cap: 4 },
      { id: 'codex', name: 'Codex', plan: 'ChatGPT plan', available: false, missing: true, fix: noCodex, install: 'npm install -g @openai/codex', models: [], running: 0, cap: 2 },
      { id: 'cursor', name: 'Cursor Agent', plan: 'Cursor plan', available: false, fix: 'cursor-agent login', models: [], running: 0, cap: 2 },
      { id: 'hermes', name: 'Hermes', plan: 'Anthropic API via Hermes', available: false, fix: 'Set the Hermes URL', models: [], running: 0, cap: 2 },
    ];
    const el = await render(createElement(HarnessScreen));
    expect([...el.querySelectorAll('[data-harness]')].map((r) => [r.getAttribute('data-harness'), r.getAttribute('data-state')])).toEqual([
      ['claude-code', 'ready'],
      ['codex', 'missing'],
      ['cursor', 'signed-out'],
    ]);
    const codex = row(el, 'codex');
    expect(text(codex)).toContain('Not installed');
    expect(labels(codex)).toEqual(['Install']);
    expect(text(codex)).toContain(`${noCodex}.`);
    expect([...codex.querySelectorAll('code')].map((c) => c.textContent)).toEqual(['npm install -g @openai/codex']);
    const cursor = row(el, 'cursor');
    expect(text(cursor)).toContain('Signed out');
    expect(labels(cursor)).toEqual(['Sign in']);
  });

  it('an error is a sentence with nothing to copy', async () => {
    const exited = 'codex app-server exited (code 1) before it answered. Run codex app-server in a terminal to see why';
    harnesses = [{ id: 'codex', name: 'Codex', plan: 'ChatGPT plan', available: false, fix: exited, models: [], running: 0, cap: 2 }];
    const codex = row(await render(createElement(HarnessScreen)), 'codex');
    expect(codex.getAttribute('data-state')).toBe('error');
    expect(codex.querySelectorAll('code')).toHaveLength(0);
    expect(text(codex)).toContain(`${exited}.`);
  });

  it('says what Codex is for, and that the Conductor asks without it', async () => {
    harnesses = [
      { id: 'claude-code', name: 'Claude Code', plan: 'Claude plan', available: true, models: [], running: 0, cap: 4 },
      { id: 'codex', name: 'Codex', plan: 'ChatGPT plan', available: false, fix: 'codex login', models: [], running: 0, cap: 2 },
    ];
    const el = await render(createElement(HarnessScreen));
    expect(text(el)).not.toContain('Codex and Cursor Agent are optional');
    expect(text(el)).toContain('Codex reviews the pull requests Claude writes.');
    expect(text(row(el, 'codex'))).toContain('Reviews the pull requests Claude writes. Without it, the Conductor asks you what to do each time.');
    expect(text(el)).toContain('Set up Codex for PR reviews, or the Conductor asks you each time.');
  });
});

describe('copy for the install and the layout', () => {
  it('offers npm run setup only for a checkout seen outside the desktop app', () => {
    expect(offersNpmSetup('checkout', false)).toBe(true);
    expect(offersNpmSetup('checkout', true)).toBe(false);
    expect(offersNpmSetup('app', false)).toBe(false);
  });

  it('the Done note: a checkout gets npm run setup, the desktop app does not', async () => {
    let el = await render(createElement(SavedNote, { path: '~/omni-os/data/omni.config.json', install: 'checkout' }));
    expect(text(el)).toBe('Saved in ~/omni-os/data/omni.config.json, which stays out of git. Change it any time in Settings, or run npm run setup.');
    act(() => root?.unmount());
    host.remove();
    el = await render(createElement(SavedNote, { path: '~/Library/Application Support/Omni/data/omni.config.json', install: 'app' }));
    expect(text(el)).toBe('Saved in ~/Library/Application Support/Omni/data/omni.config.json. Change it any time in Settings.');
    expect(text(el)).not.toContain('npm run setup');
  });

  it('names where to add a channel later on each layout', () => {
    expect(addChannelHint('rail')).toBe('Skip it and add channels later with Add channel (+) at the foot of the rail.');
    expect(addChannelHint('classic')).toBe('Skip it and add channels later with Add channel in the sidebar.');
    expect(addChannelHint('phone')).toBe('Skip it and add channels later in Settings > Channels.');
  });
});

describe('Notifications step', () => {
  it('sits before Done', () => {
    expect(STEPS).toEqual(['You', 'Workspace', 'Harnesses', 'Channel', 'Notifications', 'Done']);
  });

  it('in the desktop app: a test notification so macOS asks now, and the switch saves the app setting', async () => {
    let settings: DesktopSettings = DEFAULT_DESKTOP_SETTINGS;
    const calls: string[] = [];
    const bridge = {
      platform: 'darwin',
      nativeNotifications: true,
      testNotification: async () => (calls.push('test'), true),
      settings: {
        get: async () => settings,
        set: async (patch: { notifications?: { enabled?: boolean } }) => {
          calls.push(`set:${patch.notifications?.enabled}`);
          settings = { ...settings, notifications: { ...settings.notifications, enabled: patch.notifications?.enabled ?? true } };
          return settings;
        },
      },
    } as unknown as DesktopBridge;
    const el = await render(createElement(NotificationsScreen, { bridge }));
    expect(text(el)).toContain('macOS asks once whether Omni may; send a test now so it asks here, not mid-task.');
    const button = [...el.querySelectorAll('button')].find((b) => b.textContent?.includes('Send a test notification'))!;
    await act(async () => button.click());
    expect(calls).toEqual(['test']);
    expect(text(el.querySelector('[data-sent]'))).toBe('Sent. If nothing showed, allow Omni in System Settings > Notifications > Omni.');
    await act(async () => (el.querySelector('[role="switch"]') as HTMLButtonElement).click());
    expect(calls).toEqual(['test', 'set:false']);
    expect(el.querySelector('[role="switch"]')!.getAttribute('aria-checked')).toBe('false');
  });

  it('in a browser that can notify: the switch asks the browser', async () => {
    const asked = vi.fn(async () => 'granted' as NotificationPermission);
    vi.stubGlobal('Notification', Object.assign(function () {}, { permission: 'default', requestPermission: asked }));
    try {
      const el = await render(createElement(NotificationsScreen, { bridge: null }));
      expect(text(el.querySelector('[data-permission]'))).toBe('Not asked yet');
      await act(async () => (el.querySelector('[role="switch"]') as HTMLButtonElement).click());
      expect(asked).toHaveBeenCalledOnce();
      expect(el.querySelector('[role="switch"]')!.getAttribute('aria-checked')).toBe('true');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('in a browser without notifications, such as Safari on an iPhone: points at the iPhone app', async () => {
    const keep = (globalThis as { Notification?: unknown }).Notification;
    delete (globalThis as { Notification?: unknown }).Notification;
    try {
      const el = await render(createElement(NotificationsScreen, { bridge: null }));
      expect(text(el.querySelector('[data-permission]'))).toBe('Not supported in this browser');
      expect(el.querySelector('[role="switch"]')!.hasAttribute('disabled')).toBe(true);
      expect(text(el)).toContain('On an iPhone, the Omni app sends push alerts instead. Pair it from Settings > Sharing & access.');
    } finally {
      if (keep) (globalThis as { Notification?: unknown }).Notification = keep;
    }
  });
});
