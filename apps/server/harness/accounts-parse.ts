// What each harness's account check may return, as pure functions: the parsers of each CLI's or API's answer, and the
// filter every field goes through before it leaves (harness-accounts.ts does the I/O). Only the fields picked here
// survive, and `clean` drops any string shaped like a credential.
import type { AccountIdentity, AccountState, HarnessAccount, RecordedAccount } from '@omni/shared/harness-accounts.ts';
import type { GetAccountResponse } from './codex/protocol.ts';

// ---------- what a reader may return ----------

/** Shapes of credentials: an Anthropic, OpenAI or Cursor key, a JWT, a bearer header, or a long run of key characters. */
const CREDENTIAL = /(?:sk-[A-Za-z0-9_-]{8,}|sk_[A-Za-z0-9]{8,}|key_[A-Za-z0-9]{12,}|crsr_[A-Za-z0-9]{8,}|eyJ[A-Za-z0-9_-]{8,}\.|bearer\s+\S{12,}|[A-Za-z0-9+/_=-]{40,})/i;

/** A field fit to show: a string, on one line, cut to `max`, and null when it is empty or shaped like a credential. */
export function clean(v: unknown, max = 120): string | null {
  if (typeof v !== 'string') return null;
  const s = v.replace(/\s+/g, ' ').trim();
  if (!s || CREDENTIAL.test(s)) return null;
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** "max" or "claude_max" as "Max"; "team" as "Team". */
export function planName(v: unknown): string | null {
  const s = clean(v, 40);
  if (!s) return null;
  const bare = s.replace(/^(claude|chatgpt|cursor)[_ -]/i, '').replace(/[_-]+/g, ' ');
  return bare.replace(/\b\w/g, (c) => c.toUpperCase());
}

export const account = (harness: string, state: AccountState, fields: Partial<Pick<HarnessAccount, 'label' | 'org' | 'plan' | 'note'>> = {}): HarnessAccount => ({
  harness,
  state,
  label: fields.label ?? null,
  org: fields.org ?? null,
  plan: fields.plan ?? null,
  note: fields.note ?? null,
  switched: null,
});

const signedIn = (harness: string, label: string | null, rest: Partial<Pick<HarnessAccount, 'org' | 'plan' | 'note'>> = {}) =>
  label ? account(harness, 'signed-in', { label, ...rest }) : account(harness, 'unknown', { note: 'Signed in, but it did not say as whom' });

const json = (text: string): Record<string, unknown> | null => {
  try {
    const v = JSON.parse(text.trim()) as unknown;
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
};

// ---------- the readers, pure ----------

/** `claude auth status --json`. */
export function parseClaudeStatus(stdout: string): HarnessAccount {
  const j = json(stdout);
  if (!j) return account('claude-code', 'unknown', { note: 'Claude Code did not say who is signed in' });
  if (j.loggedIn !== true) return account('claude-code', 'signed-out', { note: 'Run claude, then /login' });
  const method = clean(j.authMethod, 40);
  // An API key or a third-party provider bills that, not a Claude plan: worth saying next to the account.
  const note = method && method !== 'claude.ai' ? (method === 'api_key' || method === 'apiKey' ? 'API key' : method) : null;
  const provider = clean(j.apiProvider, 40);
  return signedIn('claude-code', clean(j.email) ?? clean(j.displayName), {
    org: clean(j.orgName),
    plan: planName(j.subscriptionType),
    note: provider && provider !== 'firstParty' ? provider : note,
  });
}

/** `account/read` from `codex app-server`. */
export function parseCodexAccount(res: unknown): HarnessAccount {
  const a = (res as GetAccountResponse | null)?.account;
  if (a === undefined) return account('codex', 'unknown', { note: 'Codex did not say who is signed in' });
  if (a === null) return account('codex', 'signed-out', { note: 'Run codex login' });
  if (a.type !== 'chatgpt') return account('codex', 'signed-out', { note: 'Signed in with an API key, not a ChatGPT plan. Run codex login' });
  const workspace = clean(a.workspaceName);
  return signedIn('codex', clean(a.email), { plan: planName(a.planType), org: workspace && workspace !== 'Personal' ? workspace : null });
}

/** `cursor-agent about --format json`. Signed out, it reports "Not logged in" as the email. */
export function parseCursorAbout(stdout: string): HarnessAccount {
  const j = json(stdout);
  if (!j) return account('cursor', 'unknown', { note: 'Cursor Agent did not say who is signed in' });
  const email = clean(j.userEmail);
  if (!email || !email.includes('@')) return account('cursor', 'signed-out', { note: 'Run cursor-agent login' });
  const tier = clean(j.subscriptionTier, 40);
  return signedIn('cursor', email, { plan: tier && tier !== 'Unknown' ? tier : null });
}

/** GET /v1/me on the Cursor API. */
export function parseCursorMe(body: unknown): HarnessAccount {
  const j = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  const name = [clean(j.userFirstName, 40), clean(j.userLastName, 40)].filter(Boolean).join(' ') || null;
  const key = clean(j.apiKeyName, 60);
  return signedIn('cursor-cloud', clean(j.userEmail) ?? name, { note: key ? `Key ${key}` : null });
}

const STATES = new Set<AccountState>(['signed-in', 'signed-out', 'not-installed', 'off', 'not-reported', 'unknown']);

const identity = (v: unknown): AccountIdentity | null => {
  const i = v as Partial<AccountIdentity> | null;
  const label = clean(i?.label);
  return label ? { label, org: clean(i?.org), plan: clean(i?.plan, 40) } : null;
};

/** Only the listed fields, each cleaned. Used on every reading here and on every record another machine wrote. */
export function sanitize(v: unknown, harness: string): RecordedAccount {
  const a = (v ?? {}) as Partial<RecordedAccount>;
  const state = typeof a.state === 'string' && STATES.has(a.state) ? a.state : 'unknown';
  const label = clean(a.label);
  const switchedFrom = identity(a.switched?.from);
  const at = typeof a.switched?.at === 'string' && Number.isFinite(Date.parse(a.switched.at)) ? a.switched.at : null;
  return {
    harness,
    state: state === 'signed-in' && !label ? 'unknown' : state,
    label,
    org: clean(a.org),
    plan: clean(a.plan, 40),
    note: clean(a.note, 160),
    switched: switchedFrom && at ? { from: switchedFrom, at } : null,
    last: identity(a.last),
  };
}

