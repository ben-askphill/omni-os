import { describe, expect, it } from 'vitest';
import { usageRows, type PlanUsage } from '../account-usage.ts';
import type { AccountsView, HarnessAccountView, MachineAccounts } from '../harness-accounts.ts';
import {
  DEFAULT_USAGE_PANEL,
  entryDetail,
  isDefaultUsagePanel,
  isUsagePanelMessage,
  PANEL_HARNESSES,
  panelEntries,
  panelKey,
  panelRows,
  panelSlots,
  parseUsagePanel,
  parseUsagePanelBody,
  sameUsagePanel,
  withMoved,
  withOrder,
  withShown,
  type UsagePanelPrefs,
} from '../usage-panel.ts';

const acct = (harness: string, label: string | null, extra: Partial<HarnessAccountView> = {}): HarnessAccountView => ({
  harness,
  state: label ? 'signed-in' : 'not-installed',
  label,
  org: null,
  plan: null,
  note: null,
  switched: null,
  notice: false,
  ...extra,
});
/** A machine reports every harness: the ones not given here are not installed there. */
const machine = (id: string, accounts: HarnessAccountView[], current = false): MachineAccounts => ({
  id,
  name: id,
  current,
  checkedAt: null,
  accounts: [...accounts, ...PANEL_HARNESSES.filter((h) => !accounts.some((a) => a.harness === h)).map((h) => acct(h, null))],
});
const view = (...machines: MachineAccounts[]): AccountsView => ({ machines, synced: machines.length > 1 });
const week = (utilization: number): PlanUsage => ({ seven_day: { utilization, resetsAt: 2_000_000_000 } });

/** Two Claude plans, Codex and Cursor signed in, Antigravity signed in with no reading, Hermes set up with no account. */
const home = view(
  machine(
    'laptop',
    [
      acct('claude-code', 'team@example.com', { plan: 'Team', org: 'Example Team' }),
      acct('codex', 'team@example.com', { plan: 'Plus' }),
      acct('cursor', 'team@example.com', { plan: 'Pro' }),
      acct('antigravity', 'me@example.com', { plan: 'Google AI Pro' }),
      acct('hermes', null, { state: 'not-reported' }),
    ],
    true,
  ),
  machine('desktop', [acct('claude-code', 'max@example.com', { plan: 'Max' }), acct('antigravity', null), acct('cursor', null), acct('codex', null), acct('hermes', null, { state: 'off' })]),
);
const rows = (v: AccountsView = home) => usageRows(PANEL_HARNESSES, v, [], { codex: week(0.4) });
const labels = (prefs: UsagePanelPrefs, v: AccountsView = home) =>
  panelRows(panelEntries(rows(v), prefs)).map((r) => (r.account ? `${r.harness} ${r.account.label}` : r.harness));
const keyOf = (harness: string, label: string, org: string | null = null) => panelKey({ harness, account: { label, org, plan: null, machines: [] } });

describe('usage panel defaults', () => {
  it('keeps the built-in order, shows Antigravity with no data and leaves Hermes off', () => {
    expect(labels(DEFAULT_USAGE_PANEL)).toEqual([
      'claude-code team@example.com',
      'claude-code max@example.com',
      'codex team@example.com',
      'cursor team@example.com',
      'antigravity me@example.com',
    ]);
    const agy = panelEntries(rows(), DEFAULT_USAGE_PANEL).find((e) => e.harness === 'antigravity')!;
    expect(agy).toMatchObject({ shown: true, row: { usage: null } });
    const hermes = panelEntries(rows(), DEFAULT_USAGE_PANEL).find((e) => e.harness === 'hermes')!;
    expect(hermes).toMatchObject({ key: 'hermes', shown: false, account: null });
    expect(hermes.row).not.toBeNull();
  });

  it('lists a harness with no account yet in Settings, but never as a panel row', () => {
    const v = view(machine('laptop', [acct('claude-code', 'team@example.com'), acct('cursor', null)], true));
    const entries = panelEntries(rows(v), DEFAULT_USAGE_PANEL);
    expect(entries.find((e) => e.key === 'cursor')).toMatchObject({ row: null, shown: true });
    expect(entryDetail(entries.find((e) => e.key === 'cursor')!)).toBe('Not set up or signed in on any machine yet');
    expect(panelRows(entries).map((r) => r.harness)).toEqual(['claude-code']);
  });

  it('turns Hermes on when chosen', () => {
    expect(labels({ order: [], visible: { hermes: true } })).toContain('hermes');
  });
});

describe('panelKey', () => {
  it('is the harness and a hash of the account, not its email', () => {
    const key = keyOf('claude-code', 'team@example.com', 'Example Team');
    expect(key).toMatch(/^claude-code:[0-9a-z]+$/);
    expect(key).not.toContain('example');
  });

  it('stays the same across case and plan changes, and differs per account, org and harness', () => {
    const key = keyOf('claude-code', 'team@example.com');
    expect(keyOf('claude-code', ' Team@Example.com ')).toBe(key);
    expect(panelKey({ harness: 'claude-code', account: { label: 'team@example.com', org: null, plan: 'Max', machines: ['x'] } })).toBe(key);
    expect(keyOf('claude-code', 'max@example.com')).not.toBe(key);
    expect(keyOf('claude-code', 'team@example.com', 'Other Org')).not.toBe(key);
    expect(keyOf('codex', 'team@example.com')).not.toBe(key);
  });

  it('is the harness id for a row with no account', () => {
    expect(panelKey({ harness: 'hermes', account: null })).toBe('hermes');
  });
});

describe('order and visibility', () => {
  const max = keyOf('claude-code', 'max@example.com');
  const team = keyOf('claude-code', 'team@example.com', 'Example Team');
  const agy = keyOf('antigravity', 'me@example.com');

  it('follows the saved order and puts rows it does not name after it, in the built-in order', () => {
    expect(labels({ order: [agy, max], visible: {} })).toEqual([
      'antigravity me@example.com',
      'claude-code max@example.com',
      'claude-code team@example.com',
      'codex team@example.com',
      'cursor team@example.com',
    ]);
  });

  it('leaves out a switched-off account and keeps its place', () => {
    const prefs = withShown(DEFAULT_USAGE_PANEL, panelEntries(rows(), DEFAULT_USAGE_PANEL), max, false);
    expect(labels(prefs)).not.toContain('claude-code max@example.com');
    const back = withShown(prefs, panelEntries(rows(), prefs), max, true);
    expect(labels(back)[1]).toBe('claude-code max@example.com');
  });

  it('adds an account that signs in later at the end, shown', () => {
    const before = view(machine('laptop', [acct('claude-code', 'team@example.com', { org: 'Example Team' }), acct('codex', 'team@example.com')], true));
    const prefs = withOrder(DEFAULT_USAGE_PANEL, panelEntries(rows(before), DEFAULT_USAGE_PANEL).map((e) => e.key).reverse());
    const after = view(machine('laptop', [acct('claude-code', 'team@example.com', { org: 'Example Team' }), acct('codex', 'team@example.com'), acct('cursor', 'new@example.com')], true));
    expect(labels(prefs, after)).toEqual(['codex team@example.com', 'claude-code team@example.com', 'cursor new@example.com']);
  });

  it('keeps a later account off when its harness was switched off as a whole', () => {
    const after = view(machine('laptop', [acct('cursor', 'new@example.com')], true));
    expect(labels({ order: [], visible: { cursor: false } }, after)).toEqual([]);
    expect(labels({ order: [], visible: { hermes: false } }, after)).toEqual(['cursor new@example.com']);
  });

  it('hides a harness row standing in for its accounts when every account is off', () => {
    const loading = usageRows(PANEL_HARNESSES, null, [], { 'claude-code': week(0.5) });
    const off = { order: [], visible: { [team]: false, [max]: false } };
    expect(panelRows(panelEntries(loading, off)).map((r) => r.harness)).toEqual(['codex', 'cursor', 'antigravity']);
    const one = { order: [], visible: { [team]: false, [max]: true } };
    expect(panelRows(panelEntries(loading, one)).map((r) => r.harness)).toContain('claude-code');
  });

  it('pins the order on a switch, so a row switched back on keeps its place', () => {
    const entries = panelEntries(rows(), DEFAULT_USAGE_PANEL);
    expect(withShown(DEFAULT_USAGE_PANEL, entries, 'hermes', true).order).toEqual(entries.map((e) => e.key));
  });

  it('keeps the saved place of an account that is not listed right now', () => {
    const away = view(machine('laptop', [acct('codex', 'team@example.com')], true));
    const saved = { order: [max, 'codex:x', team], visible: {} };
    const entries = panelEntries(rows(away), saved);
    const next = withOrder(saved, entries.map((e) => e.key).reverse());
    expect(next.order.slice(-3)).toEqual([max, 'codex:x', team]);
    expect(withShown(saved, entries, 'hermes', true).order.slice(-3)).toEqual([max, 'codex:x', team]);
  });

  it('moves a row one place up or down, and not past either end', () => {
    const entries = panelEntries(rows(), DEFAULT_USAGE_PANEL);
    const keys = entries.map((e) => e.key);
    expect(withMoved(DEFAULT_USAGE_PANEL, entries, max, -1).order.slice(0, 2)).toEqual([max, keys[0]]);
    expect(withMoved(DEFAULT_USAGE_PANEL, entries, keys[0]!, 1).order.slice(0, 2)).toEqual([keys[1], keys[0]]);
    expect(withMoved(DEFAULT_USAGE_PANEL, entries, keys[0]!, -1)).toBe(DEFAULT_USAGE_PANEL);
    expect(withMoved(DEFAULT_USAGE_PANEL, entries, keys.at(-1)!, 1)).toBe(DEFAULT_USAGE_PANEL);
  });
});

describe('parseUsagePanel', () => {
  it('keeps only well-formed keys, once each', () => {
    expect(parseUsagePanel({ order: ['a', 'a', 3, '', 'b'], visible: { a: true, b: 'yes', c: false } })).toEqual({ order: ['a', 'b'], visible: { a: true, c: false } });
    expect(parseUsagePanel(null)).toEqual(DEFAULT_USAGE_PANEL);
    expect(parseUsagePanel({ order: Array.from({ length: 500 }, (_, i) => `k${i}`) }).order).toHaveLength(200);
  });

  it('refuses a PUT body that is not a whole value', () => {
    expect(parseUsagePanelBody({ order: ['a'], visible: { a: false } })).toEqual({ order: ['a'], visible: { a: false } });
    expect(parseUsagePanelBody({ order: ['a'] })).toBeNull();
    expect(parseUsagePanelBody({ order: [1], visible: {} })).toBeNull();
    expect(parseUsagePanelBody({ order: [], visible: { a: 'no' } })).toBeNull();
    expect(parseUsagePanelBody([])).toBeNull();
  });

  it('compares values and tells the default apart', () => {
    expect(sameUsagePanel({ order: ['a'], visible: { b: true, c: false } }, { order: ['a'], visible: { c: false, b: true } })).toBe(true);
    expect(sameUsagePanel({ order: ['a'], visible: {} }, { order: ['b'], visible: {} })).toBe(false);
    expect(isDefaultUsagePanel(DEFAULT_USAGE_PANEL)).toBe(true);
    expect(isDefaultUsagePanel({ order: [], visible: { hermes: true } })).toBe(false);
  });

  it('reads the feed message', () => {
    expect(isUsagePanelMessage({ type: 'usage_panel' })).toBe(true);
    expect(isUsagePanelMessage({ type: 'usage' })).toBe(false);
  });
});

describe('panelSlots', () => {
  const slots = {
    'claude-code': { running: 1, cap: 12 },
    codex: { running: 0, cap: 12 },
    cursor: { running: 0, cap: 12 },
    hermes: { running: 0, cap: 12 },
    'cursor-cloud': { running: 0, cap: 12 },
    antigravity: { running: 2, cap: 12 },
  };

  it('drops a harness that is off and keeps Cursor Cloud last', () => {
    expect(panelSlots(slots, panelEntries(rows(), DEFAULT_USAGE_PANEL))).toBe('Claude 1/12 · Codex 0/12 · Cursor 0/12 · Antigravity 2/12 · Cursor Cloud 0/12');
  });

  it('follows the panel order and keeps a harness while one of its accounts shows', () => {
    const agy = keyOf('antigravity', 'me@example.com');
    const team = keyOf('claude-code', 'team@example.com', 'Example Team');
    const prefs = { order: [agy, 'hermes'], visible: { hermes: true, [team]: false } };
    expect(panelSlots(slots, panelEntries(rows(), prefs))).toBe('Antigravity 2/12 · Hermes 0/12 · Claude 1/12 · Codex 0/12 · Cursor 0/12 · Cursor Cloud 0/12');
  });

  it('lists every harness in the built-in order without the panel', () => {
    expect(panelSlots(slots)).toBe('Claude 1/12 · Codex 0/12 · Cursor 0/12 · Antigravity 2/12 · Hermes 0/12 · Cursor Cloud 0/12');
  });
});
