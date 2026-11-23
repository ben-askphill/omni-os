import { describe, expect, it } from 'vitest';
import { EMPTY_USAGE_FEED, isAccountsMessage, mergeUsageMessage, nearlyFull, parsePlanUsage, usageRecords, usageRows, withAccountUsage, withHarnessUsage, type AccountUsage, type PlanUsage } from '../account-usage.ts';
import type { AccountsView, HarnessAccountView, MachineAccounts } from '../harness-accounts.ts';

const H = ['claude-code', 'codex', 'cursor', 'hermes'];

const acct = (harness: string, label: string | null, extra: Partial<HarnessAccountView> = {}): HarnessAccountView => ({
  harness,
  state: label ? 'signed-in' : 'signed-out',
  label,
  org: null,
  plan: label ? 'Max' : null,
  note: null,
  switched: null,
  notice: false,
  ...extra,
});

const machine = (id: string, accounts: HarnessAccountView[], current = false): MachineAccounts => ({ id, name: id, current, checkedAt: null, accounts });
const view = (...machines: MachineAccounts[]): AccountsView => ({ machines, synced: machines.length > 1 });

const week = (utilization: number): PlanUsage => ({ seven_day: { utilization, resetsAt: 2_000_000_000 } });
const rec = (harness: string, label: string, usage: PlanUsage | null, at = '2026-11-16T10:00:00.000Z', machine = 'omarchy'): AccountUsage => ({
  harness,
  label,
  org: null,
  plan: 'Max',
  machine,
  machineName: machine,
  at,
  usage,
});

describe('usageRows', () => {
  it('keeps one plain row per harness when each has a single account', () => {
    const v = view(
      machine('omarchy', [acct('claude-code', 'ben@askphill.com'), acct('codex', 'ben@askphill.com', { plan: 'Plus' }), acct('cursor', null), acct('hermes', null, { state: 'not-reported' })], true),
    );
    const rows = usageRows(H, v, [rec('claude-code', 'ben@askphill.com', week(0.32))]);
    expect(rows.map((r) => [r.harness, r.account?.label ?? null, r.several])).toEqual([
      ['claude-code', 'ben@askphill.com', false],
      ['codex', 'ben@askphill.com', false],
      // Cursor is signed out: no row. Hermes has no account to read: its plain row.
      ['hermes', null, false],
    ]);
    expect(rows[0]!.usage).toEqual(week(0.32));
    // Codex has no record of its own and none for any other Codex account yet: the per-harness reading fills in.
    expect(usageRows(H, v, [], { codex: week(0.37) }).find((r) => r.harness === 'codex')!.usage).toEqual(week(0.37));
  });

  it('gives each account on a harness its own row and its own numbers, never another account’s', () => {
    const v = view(
      machine('omarchy', [acct('claude-code', 'ben@askphill.com')], true),
      machine('air', [acct('claude-code', 'ben.rosenberg.personal.long.address@example-domain.com', { plan: 'Pro' })]),
      machine('mbp', [acct('claude-code', 'BEN@askphill.com')]),
    );
    const records = [
      rec('claude-code', 'ben@askphill.com', week(0.5), '2026-11-16T09:00:00.000Z', 'omarchy'),
      // The same account read later on another machine: the newer reading wins, the two are not added up.
      rec('claude-code', 'ben@askphill.com', week(0.6), '2026-11-16T10:00:00.000Z', 'mbp'),
    ];
    const rows = usageRows(H, v, records, { 'claude-code': week(0.9) });
    const claude = rows.filter((r) => r.harness === 'claude-code');
    expect(claude).toHaveLength(2);
    expect(claude.every((r) => r.several)).toBe(true);
    expect(claude[0]).toMatchObject({ account: { label: 'ben@askphill.com', plan: 'Max', machines: ['omarchy', 'mbp'] }, usage: week(0.6) });
    // The personal account has no reading of its own: "no data", not the work account's or the per-harness one.
    expect(claude[1]).toMatchObject({ account: { label: 'ben.rosenberg.personal.long.address@example-domain.com', plan: 'Pro' }, usage: null, waiting: true });
    expect(claude[0]!.waiting).toBe(false);
    // A reading of its own that went stale is "no data", not waiting for a first one.
    const stale = usageRows(H, v, [...records, rec('claude-code', 'ben.rosenberg.personal.long.address@example-domain.com', null)]);
    expect(stale.filter((r) => r.harness === 'claude-code')[1]).toMatchObject({ usage: null, waiting: false });
    expect(new Set(claude.map((r) => r.key)).size).toBe(2);
  });

  it('leaves out signed-out accounts, and stops using the per-harness reading once an account has its own', () => {
    const v = view(machine('omarchy', [acct('claude-code', 'a@x.com')], true), machine('air', [acct('claude-code', null)]));
    const rows = usageRows(['claude-code'], v, [rec('claude-code', 'old@x.com', week(0.1))], { 'claude-code': week(0.9) });
    // One account signed in, the other signed out. A record exists for an account that is gone: a@x.com still has none.
    expect(rows).toEqual([{ key: expect.any(String), harness: 'claude-code', account: { label: 'a@x.com', org: null, plan: 'Max', machines: ['omarchy'] }, usage: null, several: false, waiting: false }]);
  });

  it("never puts a reading from another login (Cursor's IDE session) on an account's row", () => {
    const v = view(machine('omarchy', [acct('cursor', 'ben@askphill.com', { plan: 'Pro' })], true));
    const ide: PlanUsage = { monthly: { utilization: 0.79, resetsAt: 2_000_000_000 }, unattributed: true };
    expect(usageRows(['cursor'], v, [], { cursor: ide })[0]).toMatchObject({ account: { label: 'ben@askphill.com' }, usage: null, waiting: false });
    // Read through cursor-agent's own login, the lone account's row still falls back to it until it has a record.
    expect(usageRows(['cursor'], v, [], { cursor: { ...ide, unattributed: undefined } })[0]!.usage).toMatchObject({ monthly: { utilization: 0.79 } });
  });

  it('waits for a first reading only on a harness that files one per account', () => {
    const two = (h: string) => view(machine('omarchy', [acct(h, 'a@x.com')], true), machine('air', [acct(h, 'b@x.com')]));
    const ide: PlanUsage = { monthly: { utilization: 0.5, resetsAt: 2_000_000_000 }, unattributed: true };
    // Cursor's dashboard fallback is never filed per account, so a Cursor row with nothing would wait for ever.
    expect(usageRows(['cursor'], two('cursor'), [], { cursor: ide }).map((r) => r.waiting)).toEqual([false, false]);
    expect(usageRows(['cursor'], two('cursor'), []).map((r) => r.waiting)).toEqual([false, false]);
    // Codex files each rate-limit read under its account: the one without a record is waiting, the other is not.
    const codex = usageRows(['codex'], two('codex'), [rec('codex', 'a@x.com', week(0.2))]);
    expect(codex.map((r) => [r.account!.label, r.waiting])).toEqual([['a@x.com', false], ['b@x.com', true]]);
  });

  it('shows a failed check as a plain row with no data, and every harness as today before the accounts load', () => {
    const v = view(machine('omarchy', [acct('codex', null, { state: 'unknown' })], true));
    expect(usageRows(['codex'], v, [], { codex: week(0.4) })).toEqual([{ key: 'codex', harness: 'codex', account: null, usage: null, several: false, waiting: false }]);
    expect(usageRows(['claude-code', 'codex'], undefined, [], { codex: week(0.4) }).map((r) => [r.harness, r.usage])).toEqual([
      ['claude-code', null],
      ['codex', week(0.4)],
    ]);
  });
});

describe('parsePlanUsage', () => {
  it('keeps only numeric windows and the known fields', () => {
    expect(parsePlanUsage({ five_hour: { utilization: 0.2, resetsAt: 5 }, seven_day: { utilization: 'x', resetsAt: 5 }, monthly: { utilization: 0.4, resetsAt: 9, spendCents: 10, evil: 'y' }, token: 'sk-abc' })).toEqual({
      five_hour: { utilization: 0.2, resetsAt: 5 },
      monthly: { utilization: 0.4, resetsAt: 9, spendCents: 10 },
    });
    for (const bad of [null, 'x', 1, []]) expect(parsePlanUsage(bad)).toBeNull();
  });
});

describe('nearlyFull', () => {
  it('turns a window the Needs you colour from 90% on', () => {
    expect([0, 0.5, 0.899, 0.9, 1].map(nearlyFull)).toEqual([false, false, false, true, true]);
    expect(nearlyFull(null)).toBe(false);
    expect(nearlyFull(undefined)).toBe(false);
  });
});

describe('the Usage card on the feed', () => {
  const a = rec('claude-code', 'one@example.com', week(0.2), '2026-11-16T10:00:00.000Z');
  const newer = rec('claude-code', 'one@example.com', week(0.6), '2026-11-16T11:00:00.000Z');

  it('replaces an account reading and the per-harness one, never another key', () => {
    const live = withAccountUsage({}, a);
    expect(Object.values(withAccountUsage(live, newer))).toEqual([newer]);
    expect(Object.values(withAccountUsage(live, rec('codex', 'one@example.com', null)))).toHaveLength(2);
    expect(withHarnessUsage({ codex: week(0.1) }, { usage: week(0.3) })).toEqual({ codex: week(0.1), 'claude-code': week(0.3) });
    expect(withHarnessUsage({ codex: week(0.1) }, { harness: 'codex', usage: null })).toEqual({ codex: null });
  });

  it('reads the listed records, then the feed ones, and the newer wins', () => {
    const v = view(machine('omarchy', [acct('claude-code', 'one@example.com')], true));
    const records = usageRecords({ ...v, usage: [newer] }, withAccountUsage({}, a));
    expect(records).toEqual([newer, a]);
    expect(usageRows(H, v, records)[0].usage).toEqual(week(0.6));
  });

  it('merges usage and account_usage messages, and leaves every other message and a malformed record alone', () => {
    let feed = mergeUsageMessage(EMPTY_USAGE_FEED, { type: 'usage', harness: 'codex', usage: { seven_day: { utilization: 0.5, resetsAt: 1 }, junk: 1 } });
    expect(feed.harness).toEqual({ codex: { seven_day: { utilization: 0.5, resetsAt: 1 } } });
    feed = mergeUsageMessage(feed, { type: 'account_usage', usage: { ...a, machineName: undefined, org: 7 } });
    expect(Object.values(feed.live)).toEqual([{ ...a, machineName: 'omarchy', org: null }]);
    for (const m of [null, 'usage', { type: 'thread' }, { type: 'account_usage', usage: { harness: 'codex' } }]) expect(mergeUsageMessage(feed, m)).toBe(feed);
    expect(isAccountsMessage({ type: 'accounts' })).toBe(true);
    expect(isAccountsMessage({ type: 'account_usage' })).toBe(false);
  });
});
