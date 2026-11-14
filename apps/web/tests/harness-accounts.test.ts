// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { AccountsView } from '@omni/shared/harness-accounts.ts';
import type { Channel, CrewRole } from '../src/api.ts';

const state = vi.hoisted(() => ({ channels: [] as Channel[], crew: [] as CrewRole[] }));
vi.mock('../src/store.tsx', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/store.tsx')>()),
  useApp: () => ({ ...state, status: null }),
  useHereName: () => 'MacBook Pro',
  useFeed: () => {},
  useNow: () => Date.parse('2026-11-14T12:00:00Z'),
}));
vi.mock('../src/mobile/shell.tsx', () => ({ useShell: () => ({ open: vi.fn(), sheet: vi.fn() }) }));

import { NewThreadComposer } from '../src/components/Composer.tsx';
import { NewSheet } from '../src/mobile/NewSheet.tsx';
import { AccountsSection } from '../src/pages/SettingsAccounts.tsx';

// Which account each harness runs as (GET /api/accounts): named in the new thread's model list, a notice under the
// composer while a switch is not acknowledged, and Settings > Accounts with every machine.

const harnesses = [
  { id: 'claude-code', name: 'Claude Code', available: true, plan: 'Claude plan', models: [{ id: 'claude-sonnet-5-5', label: 'Sonnet 5.5', efforts: [], defaultEffort: '', default: true }] },
];

const account = (harness: string, label: string | null, extra: Record<string, unknown> = {}) => ({
  harness,
  state: label ? 'signed-in' : 'not-installed',
  label,
  org: null,
  plan: label ? 'Max' : null,
  note: null,
  switched: null,
  notice: false,
  ...extra,
});

let view: AccountsView;
let root: Root;
let host: HTMLDivElement;
let calls: { url: string; body?: unknown }[];

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  Element.prototype.scrollIntoView = vi.fn();
  calls = [];
  state.channels = [{ id: 'web', name: 'web', kind: 'system', default_model: 'claude-sonnet-5-5' }] as Channel[];
  view = {
    synced: true,
    machines: [
      {
        id: 'mac',
        name: 'MacBook Pro',
        current: true,
        checkedAt: '2026-11-14T11:58:00Z',
        accounts: [
          account('claude-code', 'ben@work.example', {
            switched: { from: { label: 'ben@personal.example', org: null, plan: 'Pro' }, at: '2026-11-14T11:00:00Z' },
            notice: true,
          }),
          account('codex', null),
        ],
      },
      { id: 'omarchy', name: 'omarchy', current: false, checkedAt: '2026-11-14T11:30:00Z', accounts: [account('claude-code', 'ben@personal.example')] },
    ],
  } as AccountsView;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, body: init?.body ? JSON.parse(init.body as string) : undefined });
    if (url.startsWith('/api/accounts/seen')) {
      view = { ...view, machines: view.machines.map((m) => ({ ...m, accounts: m.accounts.map((a) => ({ ...a, notice: false })) })) };
      return Response.json(view);
    }
    if (url.startsWith('/api/accounts')) return Response.json(view);
    if (url.startsWith('/api/harnesses')) return Response.json(harnesses);
    if (url.startsWith('/api/commands')) return Response.json({ status: 'ready', commands: [] });
    if (url.startsWith('/api/devices')) return Response.json([]);
    if (url.startsWith('/api/setup')) return Response.json({ config: {} });
    if (url.endsWith('/bases')) return Response.json({ available: false });
    throw new Error(`Unexpected request: ${url}`);
  }));
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

const click = async (el: Element | undefined | null) => {
  expect(el).toBeTruthy();
  await act(async () => (el as HTMLElement).click());
};
const button = (text: string) => [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === text);
const settle = () => act(async () => new Promise((r) => setTimeout(r, 0)));

describe.each([false, true])('the new thread, phone=%s', (phone) => {
  const mount = async () => {
    await act(async () => root.render(phone ? createElement(NewSheet, { channel: 'web' }) : createElement(NewThreadComposer, { channelId: 'web' })));
    await settle();
  };

  it('says the picked harness switched accounts here, until Got it acknowledges it for everyone', async () => {
    await mount();
    expect(host.textContent).toContain('Claude Code on MacBook Pro now runs as ben@work.example, was ben@personal.example');
    await click(button('Got it'));
    await settle();
    expect(calls.find((c) => c.url === '/api/accounts/seen')?.body).toEqual({ machine: 'mac', harness: 'claude-code' });
    expect(host.textContent).not.toContain('now runs as');
  });

  it('names the account in the harness heading of the model list', async () => {
    await mount();
    await click(phone ? [...host.querySelectorAll('button')].find((b) => b.textContent?.includes('Sonnet 5.5')) : host.querySelector('button[aria-label^="Model:"]'));
    await settle();
    expect(document.body.textContent).toContain('ben@work.example · Max');
  });
});

describe('Settings > Accounts', () => {
  it('lists every machine with each harness and its account, the switch on top', async () => {
    await act(async () => root.render(createElement(AccountsSection)));
    await settle();
    const text = host.textContent ?? '';
    expect(text).toContain('MacBook Pro');
    expect(text).toContain('This machine');
    expect(text).toContain('omarchy');
    expect(text).toContain('ben@personal.example · Max');
    expect(text).toContain('Not installed');
    expect(text).toContain('Claude Code on MacBook Pro now runs as ben@work.example');
  });

  it('reads this machine again on Check again', async () => {
    await act(async () => root.render(createElement(AccountsSection)));
    await settle();
    await click(button('Check again'));
    await settle();
    expect(calls.some((c) => c.url === '/api/accounts?refresh=1')).toBe(true);
  });
});
