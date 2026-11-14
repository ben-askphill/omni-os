import { describe, expect, it } from 'vitest';
import {
  accountDetail,
  accountLine,
  accountNotices,
  identityKey,
  machineAccounts,
  nextAccount,
  switchLine,
  switchNotice,
  threadAccountLine,
  type AccountsView,
  type HarnessAccount,
} from '../harness-accounts.ts';

const reading = (label: string | null, extra: Partial<HarnessAccount> = {}): HarnessAccount => ({
  harness: 'claude-code',
  state: label ? 'signed-in' : 'signed-out',
  label,
  org: label ? 'Acme' : null,
  plan: label ? 'Max' : null,
  note: null,
  switched: null,
  ...extra,
});

const T1 = '2026-11-14T10:00:00.000Z';
const T2 = '2026-11-14T11:00:00.000Z';
const T3 = '2026-11-14T12:00:00.000Z';

describe('nextAccount: telling a switch from a sign-in', () => {
  it('is no switch on the first account a machine reads', () => {
    expect(nextAccount(undefined, reading('a@example.com'), T1)).toMatchObject({ switched: null, last: { label: 'a@example.com' } });
  });

  it('is a switch when another account signs in, kept with the one before it', () => {
    const first = nextAccount(undefined, reading('a@example.com'), T1);
    const second = nextAccount(first, reading('b@example.com'), T2);
    expect(second.switched).toEqual({ from: { label: 'a@example.com', org: 'Acme', plan: 'Max' }, at: T2 });
    // Read again as the same account: the switch stays as it was.
    expect(nextAccount(second, reading('b@example.com'), T3).switched?.at).toBe(T2);
  });

  it('tells the same email in another org apart, but not a plan change or a case change', () => {
    const first = nextAccount(undefined, reading('a@example.com'), T1);
    expect(nextAccount(first, reading('a@example.com', { org: 'Personal' }), T2).switched).not.toBeNull();
    expect(nextAccount(first, reading('a@example.com', { plan: 'Pro' }), T2).switched).toBeNull();
    expect(nextAccount(first, reading('A@Example.com'), T2).switched).toBeNull();
  });

  it('is no switch on signing out and back in as the same account, and is one when another signs in after', () => {
    const first = nextAccount(undefined, reading('a@example.com'), T1);
    const out = nextAccount(first, reading(null), T2);
    expect(out).toMatchObject({ state: 'signed-out', switched: null, last: { label: 'a@example.com' } });
    expect(nextAccount(out, reading('a@example.com'), T3).switched).toBeNull();
    expect(nextAccount(out, reading('b@example.com'), T3).switched).toMatchObject({ from: { label: 'a@example.com' }, at: T3 });
  });

  it('keeps the last account through a failed check', () => {
    const first = nextAccount(undefined, reading('a@example.com'), T1);
    const failed = nextAccount(first, { ...reading(null), state: 'unknown' }, T2);
    expect(nextAccount(failed, reading('a@example.com'), T3).switched).toBeNull();
  });
});

describe('switchNotice', () => {
  it('shows a switch until the account it switched to is acknowledged', () => {
    const a = nextAccount(nextAccount(undefined, reading('a@example.com'), T1), reading('b@example.com'), T2);
    expect(switchNotice(a, null)).toBe(true);
    expect(switchNotice(a, identityKey({ label: 'a@example.com', org: 'Acme' }))).toBe(true);
    expect(switchNotice(a, identityKey(a))).toBe(false);
    // Switched back: the acknowledged account is the one it left.
    const back = nextAccount(a, reading('a@example.com'), T3);
    expect(switchNotice(back, identityKey(a))).toBe(true);
  });

  it('shows none while signed out', () => {
    const a = nextAccount(nextAccount(undefined, reading('a@example.com'), T1), reading('b@example.com'), T2);
    expect(switchNotice({ ...a, state: 'signed-out' }, null)).toBe(false);
  });
});

describe('words', () => {
  it('reads an account or what stands in for one', () => {
    expect(accountLine(reading('a@example.com'))).toBe('a@example.com · Max');
    expect(accountLine(reading('a@example.com', { plan: null }))).toBe('a@example.com');
    expect(accountLine(reading(null))).toBe('Signed out');
    expect(accountLine({ state: 'not-installed', label: null, plan: null })).toBe('Not installed');
    expect(accountLine(null)).toBe('Not checked yet');
  });

  it('says what a switch was, naming the org only when the label does not', () => {
    const a = nextAccount(nextAccount(undefined, reading('a@example.com'), T1), reading('b@example.com', { org: 'Personal' }), T2);
    expect(switchLine('omarchy', 'Claude Code', a)).toBe('Claude Code on omarchy now runs as b@example.com (Personal), was a@example.com (Acme)');
    // A personal plan's org is named after the email: no need to say it twice.
    const own = nextAccount(nextAccount(undefined, reading('a@example.com', { org: "a@example.com's Organization" }), T1), reading('b@example.com'), T2);
    expect(switchLine('omarchy', 'Claude Code', own)).toBe('Claude Code on omarchy now runs as b@example.com (Acme), was a@example.com');
    expect(accountDetail({ ...reading('a@example.com', { org: "a@example.com's Organization" }) })).toBeNull();
    expect(accountDetail(reading('a@example.com'))).toBe('Acme');
  });

  it("names the machine on a thread's stamp only when it is not this one", () => {
    const t = { harness: 'claude-code', machine: 'm1', machineName: 'omarchy', label: 'a@example.com', org: null, plan: 'Max', at: T1 };
    expect(threadAccountLine(t, 'omarchy')).toBe('a@example.com · Max');
    expect(threadAccountLine(t, 'MacBook Pro')).toBe('a@example.com · Max, on omarchy');
  });
});

describe('picking a machine', () => {
  const view: AccountsView = {
    synced: true,
    machines: [
      { id: 'm1', name: 'MacBook Pro', current: true, checkedAt: T1, accounts: [{ ...reading('a@example.com'), notice: false }] },
      { id: 'm2', name: 'omarchy', current: false, checkedAt: T1, accounts: [{ ...reading('b@example.com', { switched: { from: { label: 'a@example.com', org: null, plan: null }, at: T2 } }), notice: true }] },
    ],
  };

  it('finds this machine for "here" and another by id', () => {
    expect(machineAccounts(view, 'here')?.id).toBe('m1');
    expect(machineAccounts(view, null)?.id).toBe('m1');
    expect(machineAccounts(view, 'm2')?.id).toBe('m2');
    expect(machineAccounts(view, 'gone')).toBeNull();
  });

  it('lists the notices on every machine', () => {
    expect(accountNotices(view).map((n) => `${n.machine.name}:${n.account.label}`)).toEqual(['omarchy:b@example.com']);
  });
});
