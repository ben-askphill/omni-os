import { describe, expect, it } from 'vitest';
import { parsePlanUsage, usageRows, type AccountUsage, type PlanUsage } from '../account-usage.ts';
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
    expect(rows).toEqual([{ key: expect.any(String), harness: 'claude-code', account: { label: 'a@x.com', org: null, plan: 'Max', machines: ['omarchy'] }, usage: null, several: false, waiting: true }]);
  });

  it("never puts a reading from another login (Cursor's IDE session) on an account's row", () => {
    const v = view(machine('omarchy', [acct('cursor', 'ben@askphill.com', { plan: 'Pro' })], true));
    const ide: PlanUsage = { monthly: { utilization: 0.79, resetsAt: 2_000_000_000 }, unattributed: true };
    expect(usageRows(['cursor'], v, [], { cursor: ide })[0]).toMatchObject({ account: { label: 'ben@askphill.com' }, usage: null });
    // Read through cursor-agent's own login, the lone account's row still falls back to it until it has a record.
    expect(usageRows(['cursor'], v, [], { cursor: { ...ide, unattributed: undefined } })[0]!.usage).toMatchObject({ monthly: { utilization: 0.79 } });
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
