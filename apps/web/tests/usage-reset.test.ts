import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AccountsView } from '@omni/shared/harness-accounts.ts';
import type { AccountUsage, PlanUsage } from '@omni/shared/account-usage.ts';

// Each limit on the Usage card and the dashboard's plan pill says when it resets, per account, and a limit whose
// source sent no reset time shows none.
const NOW = new Date(2026, 10, 16, 12, 0, 0).getTime();
const at = (h: number, m = 0, day = 16) => new Date(2026, 10, day, h, m).getTime() / 1000;

const state = vi.hoisted(() => ({
  usage: {} as Record<string, unknown>,
  accounts: null as unknown,
}));

vi.mock('../src/store.tsx', () => ({
  useApp: () => ({ usage: state.usage, status: null, feedLive: true }),
  useFeed: () => {},
  useNow: () => NOW,
  readPref: (key: string, fallback: unknown) => (key === 'usage.open' ? true : fallback),
  writePref: () => {},
}));
vi.mock('../src/accounts.ts', () => ({ useAccounts: () => ({ data: state.accounts }) }));

import { UsageCard } from '../src/components/sidebar/UsageCard.tsx';
import { UsageSection } from '../src/components/dashboard/UsageSection.tsx';

const html = (node: ReactNode) => renderToStaticMarkup(createElement('div', null, node));
const card = () => html(createElement(UsageCard));
const dashboard = () => html(createElement(UsageSection, { usage: undefined, range: 'today', loading: true }));

const signedIn = (harness: string, label: string) => ({ harness, state: 'signed-in', label, org: null, plan: 'Max', note: null, switched: null });
const reading = (harness: string, label: string, usage: PlanUsage): AccountUsage => ({
  harness,
  label,
  org: null,
  plan: 'Max',
  machine: 'm1',
  machineName: 'omarchy',
  at: '2026-11-16T11:00:00.000Z',
  usage,
});
const view = (accounts: ReturnType<typeof signedIn>[], usage: AccountUsage[]): AccountsView =>
  ({ machines: [{ id: 'm1', name: 'omarchy', self: true, accounts }], synced: true, usage }) as unknown as AccountsView;

beforeEach(() => {
  state.usage = {};
  state.accounts = null;
});

describe('Usage card reset times', () => {
  it('shows when each window resets, with the local time on hover', () => {
    state.usage = {
      'claude-code': { five_hour: { utilization: 0.42, resetsAt: at(14, 10) }, seven_day: { utilization: 0.18, resetsAt: at(9, 0, 20) }, updated_at: '' },
    };
    const markup = card();
    expect(markup).toContain('>in 2h 10m<');
    expect(markup).toContain('>in 3d 21h<');
    expect(markup).toContain('title="Claude 5h: Resets in 2h 10m, today 14:10."');
    expect(markup).toContain('title="Claude week: Resets in 3d 21h, Fri 20 Nov, 09:00."');
  });

  it('shows no reset for a window whose source sent none', () => {
    state.usage = { codex: { five_hour: { utilization: 0.5, resetsAt: 0 }, updated_at: '' } };
    const markup = card();
    expect(markup).toContain('50%');
    expect(markup).not.toContain('data-testid="usage-reset"');
    expect(markup).not.toMatch(/[Rr]esets? /);
  });

  it('hides a reset that has passed and says the numbers are from before it', () => {
    state.usage = { 'claude-code': { five_hour: { utilization: 0.9, resetsAt: at(11, 0) }, updated_at: '' } };
    const markup = card();
    expect(markup).not.toContain('data-testid="usage-reset"');
    expect(markup).toContain('Reset today 11:00; these numbers are from before it.');
  });

  it('gives each account on a harness its own reset', () => {
    state.accounts = view(
      [signedIn('claude-code', 'ben@askphill.com'), signedIn('claude-code', 'ben@br-creative.co')],
      [
        reading('claude-code', 'ben@askphill.com', { five_hour: { utilization: 0.3, resetsAt: at(13, 0) } }),
        reading('claude-code', 'ben@br-creative.co', { five_hour: { utilization: 0.6, resetsAt: at(16, 30) } }),
      ],
    );
    const markup = card();
    expect(markup).toContain('aria-label="Claude (ben@askphill.com) 5h resets in 1h, today 13:00"');
    expect(markup).toContain('aria-label="Claude (ben@br-creative.co) 5h resets in 4h 30m, today 16:30"');
  });

  it("shows when Cursor's month resets", () => {
    state.usage = { cursor: { monthly: { utilization: 0.43, resetsAt: at(9, 0, 28) }, updated_at: '' } };
    expect(card()).toContain('>in 11d<');
  });

  it('leaves a harness with no reading on "no data"', () => {
    state.usage = { hermes: null };
    const markup = card();
    expect(markup).toContain('no data');
    expect(markup).not.toContain('data-testid="usage-reset"');
  });
});

describe('dashboard plan pill reset times', () => {
  it("shows the week's reset beside the percent", () => {
    state.usage = { 'claude-code': { seven_day: { utilization: 0.18, resetsAt: at(9, 0, 20) }, updated_at: '' } };
    const markup = dashboard();
    expect(markup).toContain('data-testid="plan-pill"');
    expect(markup).toContain('resets in 3d 21h');
    expect(markup).toContain('title="Claude plan: 18% of this week used. Resets in 3d 21h, Fri 20 Nov, 09:00."');
  });

  it('gives each Claude account its own pill and reset', () => {
    state.accounts = view(
      [signedIn('claude-code', 'ben@askphill.com'), signedIn('claude-code', 'ben@br-creative.co')],
      [
        reading('claude-code', 'ben@askphill.com', { seven_day: { utilization: 0.3, resetsAt: at(9, 0, 18) } }),
        reading('claude-code', 'ben@br-creative.co', { seven_day: { utilization: 0.6, resetsAt: at(9, 0, 21) } }),
      ],
    );
    const markup = dashboard();
    expect(markup.match(/data-testid="plan-pill"/g)).toHaveLength(2);
    expect(markup).toContain('aria-label="Claude · ben@askphill.com week resets in 1d 21h, Wed 18 Nov, 09:00"');
    expect(markup).toContain('aria-label="Claude · ben@br-creative.co week resets in 4d 21h, Sat 21 Nov, 09:00"');
  });

  it('shows the pill without a reset when the week has no reset time', () => {
    state.usage = { 'claude-code': { seven_day: { utilization: 0.18, resetsAt: Number.NaN }, updated_at: '' } };
    const markup = dashboard();
    expect(markup).toContain('data-testid="plan-pill"');
    expect(markup).not.toContain('data-testid="usage-reset"');
    expect(markup).toContain('title="Claude plan: 18% of this week used."');
  });
});
