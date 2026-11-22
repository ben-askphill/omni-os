import type { OmniApi } from '@omni/client-core';
import type { UsageRow } from '@omni/shared/account-usage.ts';
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const now = new Date(2026, 10, 16, 12, 0).getTime();
type UsageData = { rows: UsageRow[]; slots: string };
const remote = vi.hoisted(() => ({
  data: null as UsageData | null,
  error: null as string | null,
  reload: vi.fn(),
  load: vi.fn<(api: OmniApi) => Promise<UsageData>>(),
}));

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
  useRemote: (load: (api: OmniApi) => Promise<UsageData>) => {
    remote.load.mockImplementation(load);
    return remote;
  },
}));
vi.mock('../../ui/Text', () => ({ Text: ({ children }: { children: ReactNode }) => createElement('span', null, children) }));
vi.mock('../../ui/Brand', () => ({ HarnessLogo: () => null }));
vi.mock('../../ui/Icon', () => ({ Icon: () => null }));
vi.mock('../../ui/Button', () => ({ Button: ({ label }: { label: string }) => createElement('button', null, label) }));

import { ActivityUsage } from './ActivityUsage';

const render = (open: boolean) => renderToStaticMarkup(createElement(ActivityUsage, { open, onToggle: vi.fn() }));

describe('Activity usage', () => {
  beforeEach(() => {
    remote.data = null;
    remote.error = null;
    remote.load.mockReset();
  });

  it('loads details after the Usage button is opened', () => {
    expect(render(false)).toContain('aria-expanded="false"');
    expect(remote.load.getMockImplementation()).toBeUndefined();
    expect(render(true)).toContain('aria-expanded="true"');
    expect(render(true)).toContain('Loading usage');
    remote.error = 'offline';
    expect(render(true)).toContain('Could not load usage.');
    expect(render(true)).toContain('>Retry<');
  });

  it('reads accounts and status and shows the same account-specific windows and limits', async () => {
    const reset = (now + 3_600_000) / 1000;
    const one = { harness: 'claude-code', state: 'signed-in', label: 'qa-one@example.com', plan: 'Max', org: 'QA Org' };
    const two = { ...one, label: 'qa-two@example.com' };
    const status = vi.fn(async () => ({
      usage: {
        'claude-code': { five_hour: { utilization: 100, resetsAt: reset } },
        codex: { five_hour: { utilization: 0.2, resetsAt: 0 } },
        cursor: { monthly: { utilization: 0.65, resetsAt: reset, api: 0.5, includedCents: 2000 } },
      },
      slots: { codex: { running: 1, cap: 4 } },
    }));
    const accounts = vi.fn(async () => ({
      machines: [{ name: 'QA Mac', accounts: [one] }, { name: 'QA Linux', accounts: [two] }],
      usage: [{ ...one, at: new Date(now).toISOString(), usage: { five_hour: { utilization: 0.42, resetsAt: reset }, seven_day: { utilization: 94, resetsAt: 0 } } }],
    }));
    render(true);
    remote.data = await remote.load({ status, accounts } as unknown as OmniApi);
    expect(status).toHaveBeenCalledOnce();
    expect(accounts).toHaveBeenCalledOnce();
    const markup = render(true);
    for (const text of [
      'qa-one@example.com · Max · QA Org, on QA Mac', '5-hour window', '42% used', 'Resets in 1h, today 13:00.',
      'Weekly window', '94% used', 'No reading for qa-two@example.com yet.', 'Codex', '20% used', 'Monthly cycle',
      '65% used', 'API 50% · $20.00 included', 'No data', 'Codex 1/4',
    ]) expect(markup).toContain(text);
    expect(markup).not.toContain('100% used');
  });
});
