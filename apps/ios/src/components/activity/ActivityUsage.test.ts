import type { OmniApi } from '@omni/client-core';
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const now = new Date(2026, 10, 16, 12, 0).getTime();
type Remote = { data: unknown; error: string | null; reload: ReturnType<typeof vi.fn>; load?: (api: OmniApi) => Promise<unknown> };
// One remote per load in call order: GET /status, GET /api/accounts, then GET /api/usage-panel.
const remotes = vi.hoisted(() => ({
  list: [] as Remote[],
  next: 0,
}));
const fresh = (): Remote => ({ data: null, error: null, reload: vi.fn() });

vi.mock('react-native', () => ({
  View: ({ children }: { children: ReactNode }) => createElement('div', null, children),
  Pressable: ({ children, accessibilityState }: { children: ReactNode; accessibilityState: { expanded: boolean } }) =>
    createElement('button', { 'aria-expanded': accessibilityState.expanded }, children),
  StyleSheet: { create: (styles: unknown) => styles },
  useColorScheme: () => 'light',
  Platform: { OS: 'ios', select: (choices: { ios?: unknown }) => choices.ios },
}));
vi.mock('../../live/react', () => ({ useLink: () => ({ kind: 'live' }), useLiveHub: () => ({ watchFeed: () => () => {} }) }));
vi.mock('../../live/use-minute-clock', () => ({ useMinuteClock: () => now }));
vi.mock('../../live/use-remote', () => ({
  useRemote: (load: (api: OmniApi) => Promise<unknown>) => {
    const r = remotes.list[remotes.next++ % 3];
    r.load = load;
    return r;
  },
}));
vi.mock('../../ui/Text', () => ({ Text: ({ children }: { children: ReactNode }) => createElement('span', null, children) }));
vi.mock('../../ui/Brand', () => ({ HarnessLogo: () => null }));
vi.mock('../../ui/Icon', () => ({ Icon: () => null }));
vi.mock('../../ui/Button', () => ({ Button: ({ label }: { label: string }) => createElement('button', null, label) }));

import { ActivityUsage } from './ActivityUsage';

const render = (open: boolean) => {
  remotes.next = 0;
  return renderToStaticMarkup(createElement(ActivityUsage, { open, onToggle: vi.fn() }));
};
const [status, accounts, panel] = [() => remotes.list[0], () => remotes.list[1], () => remotes.list[2]];

const reset = (now + 3_600_000) / 1000;
const one = { harness: 'claude-code', state: 'signed-in', label: 'qa-one@example.com', plan: 'Max', org: 'QA Org' };
const two = { ...one, label: 'qa-two@example.com' };
const api = {
  status: vi.fn(async () => ({
    usage: {
      'claude-code': { five_hour: { utilization: 100, resetsAt: reset } },
      codex: { five_hour: { utilization: 0.2, resetsAt: 0 } },
      cursor: { monthly: { utilization: 0.65, resetsAt: reset, api: 0.5, includedCents: 2000 } },
    },
    slots: { codex: { running: 1, cap: 4 } },
  })),
  accounts: vi.fn(async () => ({
    machines: [{ name: 'QA Mac', accounts: [one] }, { name: 'QA Linux', accounts: [two] }],
    usage: [{ ...one, at: new Date(now).toISOString(), usage: { five_hour: { utilization: 0.42, resetsAt: reset }, seven_day: { utilization: 94, resetsAt: 0 } } }],
  })),
  usagePanel: vi.fn(async () => ({ order: [], visible: {} })),
} as unknown as OmniApi;

describe('Activity usage', () => {
  beforeEach(() => {
    remotes.list = [fresh(), fresh(), fresh()];
  });

  it('loads details after the Usage button is opened', () => {
    expect(render(false)).toContain('aria-expanded="false"');
    expect(status().load).toBeUndefined();
    expect(render(true)).toContain('aria-expanded="true"');
    expect(render(true)).toContain('Loading usage');
    accounts().error = 'offline';
    expect(render(true)).toContain('Could not load usage.');
    expect(render(true)).toContain('>Retry<');
  });

  it('reads accounts and status and shows the same account-specific windows and limits', async () => {
    render(true);
    status().data = await status().load!(api);
    accounts().data = await accounts().load!(api);
    panel().data = await panel().load!(api);
    const markup = render(true);
    for (const text of [
      'qa-one@example.com · Max · QA Org, on QA Mac', '5-hour window', '42% used', 'Resets in 1h, today 13:00.',
      'Weekly window', '94% used', 'No reading for qa-two@example.com yet.', 'Codex', '20% used', 'Monthly cycle',
      '65% used', 'API 50% · $20.00 included', 'No data', 'Codex 1/4',
    ]) expect(markup).toContain(text);
    expect(markup).not.toContain('100% used');
  });

  it('follows Settings > Usage panel: its order, and the rows switched off', async () => {
    render(true);
    status().data = await status().load!(api);
    accounts().data = await accounts().load!(api);
    panel().data = await panel().load!({ usagePanel: async () => ({ order: ['codex'], visible: { cursor: false } }) } as unknown as OmniApi);
    const markup = render(true);
    expect(markup.indexOf('Codex')).toBeLessThan(markup.indexOf('qa-one@example.com'));
    expect(markup).not.toContain('Monthly cycle');
  });

  it('keeps the built-in order with Hermes off on a server without the setting', async () => {
    render(true);
    const older = { usagePanel: async () => Promise.reject(new Error('404')) } as unknown as OmniApi;
    expect(await panel().load!(older)).toEqual({ order: [], visible: {} });
  });

});
