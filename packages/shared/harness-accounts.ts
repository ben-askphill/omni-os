// Which account each harness is signed in to, per machine: the wire shape of GET /api/accounts
// (apps/server/harness-accounts.ts) and the words the clients show for it. Only an account's label (an email or a
// name), its organization and its plan ever travel: never a token, a key or a file the harness keeps them in.
// Each machine reads its own harnesses and writes them to the synced kv `accounts.<machine id>`, so every machine
// lists the others as they last reported.

/**
 * - `signed-in`: the harness says who it runs as.
 * - `signed-out`: it is installed and says nobody is signed in, or the login is not one Omni runs on (Codex with an API key).
 * - `not-installed`: no CLI on that machine.
 * - `off`: a provider harness with no key or address set (Hermes, Cursor Cloud).
 * - `not-reported`: it runs, but has no account to read (Hermes bills a key on its own server).
 * - `unknown`: the check failed or timed out.
 */
export type AccountState = 'signed-in' | 'signed-out' | 'not-installed' | 'off' | 'not-reported' | 'unknown';

/** Who a harness runs as. `label` is an email, or a name when there is no email. */
export interface AccountIdentity {
  label: string;
  org: string | null;
  plan: string | null;
}

/** One harness on one machine, as that machine last read it. */
export interface HarnessAccount {
  harness: string;
  state: AccountState;
  /** The email or name, when signed in. */
  label: string | null;
  org: string | null;
  /** The plan or tier, as the harness names it ("Max", "Plus", "Premium"). */
  plan: string | null;
  /** One line for a state with no account, or how it signs in when that is worth saying ("API key"). */
  note: string | null;
  /** The account it ran as before, when the machine saw it change from one signed-in account to another. */
  switched: { from: AccountIdentity; at: string } | null;
}

/** A harness account as its machine records it: with the last account it saw signed in, which a switch is told from. */
export interface RecordedAccount extends HarnessAccount {
  last: AccountIdentity | null;
}

/** A machine's record: what it read, and when. Written only by that machine. */
export interface MachineAccountsRecord {
  id: string;
  name: string;
  checkedAt: string;
  accounts: RecordedAccount[];
}

/** A harness account as GET /api/accounts lists it: `notice` while a switch has not been acknowledged. */
export interface HarnessAccountView extends HarnessAccount {
  notice: boolean;
}

export interface MachineAccounts {
  id: string;
  name: string;
  /** The machine this server runs on. */
  current: boolean;
  /** When the machine last read its harnesses. For another machine, as of its last record that reached this one. */
  checkedAt: string | null;
  accounts: HarnessAccountView[];
}

/** GET /api/accounts. This machine first, then the others by name. `synced`: sync is on, so other machines can show. */
export interface AccountsView {
  machines: MachineAccounts[];
  synced: boolean;
}

/** POST /api/accounts/seen: acknowledge the switch shown for that harness on that machine. */
export interface AccountSeenRequest {
  machine: string;
  harness: string;
}

/** The thread's stamp: the account its harness ran as when the thread last started a process, and where. */
export interface ThreadAccount {
  harness: string;
  machine: string;
  machineName: string;
  label: string;
  org: string | null;
  plan: string | null;
  at: string;
}

/** The kv prefix of every machine's record, and of the switch acknowledgements and thread stamps. */
export const ACCOUNTS_PREFIX = 'accounts.';
export const SEEN_PREFIX = 'accounts-seen.';
export const RAN_PREFIX = 'accounts-ran.';

/** The kv key a switch is acknowledged under. One per machine and harness: acknowledging again replaces it. */
export const seenKey = (machine: string, harness: string) => `${SEEN_PREFIX}${machine}.${harness}`;

/** Who a signed-in account is, for telling one from another: the label and the org, any case. The plan is not part of it. */
export function identityKey(a: { label: string | null; org: string | null } | null | undefined): string | null {
  if (!a?.label) return null;
  return `${a.label.trim().toLowerCase()}\u0000${(a.org ?? '').trim().toLowerCase()}`;
}

export const identityOf = (a: HarnessAccount): AccountIdentity | null =>
  a.state === 'signed-in' && a.label ? { label: a.label, org: a.org, plan: a.plan } : null;

/**
 * The account a machine records after a new reading. A reading signed in as someone else than the last signed-in
 * account is a switch, kept with the account before it. A reading that is not signed in (signed out, a failed check)
 * keeps the last switch, so signing out and back in to the same account is never one, and the first account a
 * machine ever reads is not one either.
 */
export function nextAccount(prev: RecordedAccount | undefined, reading: HarnessAccount, now: string): RecordedAccount {
  const last = prev ? (prev.last ?? identityOf(prev)) : null;
  const current = identityOf(reading);
  if (!current) return { ...reading, switched: prev?.switched ?? null, last };
  const changed = last && identityKey(last) !== identityKey(current);
  return { ...reading, switched: changed ? { from: last, at: now } : (prev?.switched ?? null), last: current };
}

/** Whether a switch still wants a notice: one happened and the account it switched to is not the one acknowledged. */
export const switchNotice = (a: HarnessAccount, seen: string | null | undefined): boolean =>
  !!a.switched && a.state === 'signed-in' && identityKey(a) !== (seen ?? null);

const STATE_LINE: Record<Exclude<AccountState, 'signed-in'>, string> = {
  'signed-out': 'Signed out',
  'not-installed': 'Not installed',
  off: 'Not set up',
  'not-reported': 'No account to read',
  unknown: 'Could not check',
};

/** One short line for the pickers: "ben@askphill.com · Max", or what stands in for an account. */
export function accountLine(a: Pick<HarnessAccount, 'state' | 'label' | 'plan'> | null | undefined): string {
  if (!a) return 'Not checked yet';
  if (a.state === 'signed-in' && a.label) return a.plan ? `${a.label} · ${a.plan}` : a.label;
  return STATE_LINE[a.state === 'signed-in' ? 'unknown' : a.state];
}

/** The org worth naming: none when it is the account's own ("ben@example.com's Organization", a personal Claude plan). */
const orgOf = (i: { label: string | null; org: string | null }) => (i.org && !(i.label && i.org.toLowerCase().includes(i.label.toLowerCase())) ? i.org : null);

/** The second line in Settings: the org and how it signs in, or why there is no account. */
export function accountDetail(a: HarnessAccount): string | null {
  if (a.state === 'signed-in') return [orgOf(a), a.note].filter(Boolean).join(' · ') || null;
  return a.note;
}

/** StatusDot's status for an account: signed in, needs you, or grey. */
export function accountTone(a: Pick<HarnessAccount, 'state'> | null | undefined): 'done' | 'needs' | 'idle' {
  if (a?.state === 'signed-in') return 'done';
  if (a?.state === 'signed-out' || a?.state === 'unknown') return 'needs';
  return 'idle';
}

const who = (i: AccountIdentity) => (orgOf(i) ? `${i.label} (${i.org})` : i.label);

/** "Claude Code on omarchy now runs as b@x.com (Acme), was a@x.com (Personal)". */
export function switchLine(machineName: string, harnessName: string, a: HarnessAccount): string {
  const now = identityOf(a);
  if (!a.switched || !now) return '';
  return `${harnessName} on ${machineName} now runs as ${who(now)}, was ${who(a.switched.from)}`;
}

/** The stamp's line on a thread: "ben@askphill.com · Max, on omarchy". */
export const threadAccountLine = (t: ThreadAccount, hereName?: string | null) =>
  `${t.plan ? `${t.label} · ${t.plan}` : t.label}${hereName && hereName === t.machineName ? '' : `, on ${t.machineName}`}`;

/** The accounts of one machine by harness, for the pickers. */
export const accountsByHarness = (m: MachineAccounts | null | undefined): Record<string, HarnessAccountView> =>
  Object.fromEntries((m?.accounts ?? []).map((a) => [a.harness, a]));

/** The machine a pick names: "here" or an id. */
export const machineAccounts = (view: AccountsView | null | undefined, pick: string | null | undefined): MachineAccounts | null => {
  if (!view) return null;
  return (pick && pick !== 'here' ? view.machines.find((m) => m.id === pick) : view.machines.find((m) => m.current)) ?? null;
};

/** The notices to show, newest first: every switch on any machine not acknowledged yet. */
export function accountNotices(view: AccountsView | null | undefined): { machine: MachineAccounts; account: HarnessAccountView }[] {
  return (view?.machines ?? [])
    .flatMap((machine) => machine.accounts.filter((a) => a.notice).map((account) => ({ machine, account })))
    .sort((x, y) => (y.account.switched?.at ?? '').localeCompare(x.account.switched?.at ?? ''));
}
