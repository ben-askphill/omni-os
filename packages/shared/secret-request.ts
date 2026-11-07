// Secrets an agent asks Ben for with Omni's request_secret tool (apps/mcp/ask.ts). The card in the thread posts the value
// to its own endpoint, which writes it to the secret store and nowhere else. Nothing in this module ever holds a value:
// the events carry the name, label, scope and outcome, so they persist, stream and sync like any event. Pure.
import { SECRET_NAME_RE } from './secret-store.ts';

/** Where the value goes: this thread's channel, or every channel. */
export type SecretScope = 'channel' | 'global';

/** What the agent asks for. The value goes into the env var `name`. */
export interface SecretAsk {
  name: string;
  /** What Ben is asked for, like "Stripe test secret key". */
  label: string;
  scope: SecretScope;
  /** Why the agent needs it, or null. */
  reason: string | null;
}

/** pending: waiting on Ben. saved: in the secret store. cancelled: Ben said no. dismissed: Ben wrote in the thread instead. */
export type SecretRequestState = 'pending' | 'saved' | 'cancelled' | 'dismissed';

export const LABEL_MAX = 80;
export const REASON_MAX = 300;
export const VALUE_MAX = 16_384;

/**
 * Names a request may not set, whatever the scope: Omni's own variables, the harness CLIs' own settings, and variables
 * that change how every program in the agent's shell runs.
 */
const RESERVED = /^(?:OMNI_\w*|CLAUDE_\w*|CODEX_\w*|PATH|HOME|USER|LOGNAME|SHELL|PWD|TMPDIR|TERM|LANG|LC_\w+|NODE_OPTIONS|NODE_PATH|LD_\w+|DYLD_\w+|GIT_\w+|SSH_\w+)$/;

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

/** A request_secret call, or why it is refused. The error goes back to the agent, so it says what to fix. */
export function parseSecretAsk(raw: unknown): Parsed<SecretAsk> {
  if (!isObj(raw)) return { ok: false, error: 'the request must be an object with name, label, scope and reason' };
  const name = text(raw.name);
  if (!SECRET_NAME_RE.test(name)) return { ok: false, error: 'name must be an UPPER_SNAKE_CASE env var name, like STRIPE_TEST_KEY' };
  if (RESERVED.test(name)) return { ok: false, error: `${name} is reserved for Omni or the shell: pick a name for the service, like STRIPE_TEST_KEY` };
  const label = text(raw.label);
  if (!label) return { ok: false, error: 'label is empty: say what the secret is, like "Stripe test secret key"' };
  if (label.length > LABEL_MAX) return { ok: false, error: `label is longer than ${LABEL_MAX} characters` };
  if (raw.scope !== undefined && raw.scope !== 'channel' && raw.scope !== 'global') return { ok: false, error: 'scope must be "channel" or "global"' };
  if (raw.reason !== undefined && raw.reason !== null && typeof raw.reason !== 'string') return { ok: false, error: 'reason must be a string' };
  const reason = text(raw.reason);
  if (reason.length > REASON_MAX) return { ok: false, error: `reason is longer than ${REASON_MAX} characters` };
  return { ok: true, value: { name, label, scope: raw.scope === 'global' ? 'global' : 'channel', reason: reason || null } };
}

/** Why the card cannot send this value, or null when it can. The secret store takes one non-empty line. */
export function valueProblem(value: string): string | null {
  if (!value) return 'Enter the value.';
  if (/[\r\n]/.test(value)) return 'The value must be one line.';
  if (value.length > VALUE_MAX) return `The value is longer than ${VALUE_MAX} characters.`;
  return null;
}

/** The secret store's scope for a request in a thread of this channel (apps/server/secrets.ts SCOPE_RE). */
export const secretScopeKey = (scope: SecretScope, channelId: string) => (scope === 'global' ? 'global' : `channel:${channelId}`);

/** The scope as the card and the agent read it. */
export const scopeWords = (scope: SecretScope) => (scope === 'global' ? 'every channel' : 'this channel');

/** What the waiting call returns to the agent. Names only: the value is never in it. */
export function secretResultText(ask: SecretAsk, state: SecretRequestState): string {
  const { name } = ask;
  if (state === 'saved') {
    return (
      `The user saved ${name} as a secret for ${scopeWords(ask.scope)}. Your shell does not have it yet: end your turn now with one short line. ` +
      `Omni then starts your next turn in a fresh process with $${name} set and tells you to go on. ` +
      `Use it as $${name} in commands. Never print, echo or write its value.`
    );
  }
  if (state === 'cancelled') return `The user cancelled the request for ${name}. Go on without it and say what you could not do.`;
  if (state === 'dismissed') return `The user did not enter ${name}. Read their latest message in the thread and go on from there.`;
  return `The user has not entered ${name} yet.`;
}

/** What a settled request says on the card and the iOS row: where it went and under what name. Empty while pending. */
export function settledWords(r: Pick<ThreadSecretRequest, 'ask' | 'state' | 'replaced'>): string {
  if (r.state === 'saved') return `Saved to ${scopeWords(r.ask.scope)} as ${r.ask.name}${r.replaced ? ', replacing the old value' : ''}`;
  if (r.state === 'cancelled') return 'Cancelled';
  if (r.state === 'dismissed') return 'Not entered';
  return '';
}

/** The message that starts the agent's next turn once a secret is saved, in a process whose env has it. */
export const secretSavedMessage = (ask: SecretAsk) =>
  `${ask.name} is now in your environment as $${ask.name}, a secret the user saved for ${scopeWords(ask.scope)}. ` +
  `Go on with the task. If it is already done, repeat your final report. Never print, echo or write its value.`;

/** The event kinds a request lives in: `secret_request` when the agent asks, `secret_request_answer` once Ben acts. */
export const SECRET_REQUEST_EVENT = 'secret_request';
export const SECRET_ANSWER_EVENT = 'secret_request_answer';

/** The tool's name as a harness reports the call, so clients can leave the raw call out of the transcript. */
export const isSecretTool = (name: string) => /^mcp__omni[-_]ask__request_secret$/.test(name);

export interface SecretRequestPayload {
  id: string;
  ask: SecretAsk;
  /** A secret of this name was set in the scope when the agent asked, so saving replaces it. */
  exists: boolean;
}

export interface SecretAnswerPayload {
  id: string;
  state: Exclude<SecretRequestState, 'pending'>;
  /** The saved value replaced one that was there. */
  replaced: boolean;
  /** How the agent heard: the waiting tool call, or only the message that starts its next turn (the call had ended). */
  via: 'tool' | 'message';
}

/** A request as a client shows it: where it was asked, and what became of it. */
export interface ThreadSecretRequest {
  id: string;
  /** The `secret_request` event's id, where the card sits in the transcript. */
  event_id: number;
  ask: SecretAsk;
  exists: boolean;
  state: SecretRequestState;
  replaced: boolean;
}

/** A request a thread delegated from this one waits on, so Ben enters it where he works. The card posts to `thread_id`. */
export interface CrewSecretRequest {
  thread_id: string;
  thread_title: string;
  task_id: string | null;
  channel_id: string;
  request: ThreadSecretRequest;
}

type EventLike = { id: number; kind: string; payload: string | object };
const payloadOf = <T>(e: EventLike) => (typeof e.payload === 'string' ? JSON.parse(e.payload) : e.payload) as T;

/** Every secret request in a thread's events, oldest first, each with its outcome when one came. The first answer wins. */
export function secretRequestsIn(events: readonly EventLike[]): ThreadSecretRequest[] {
  const out = new Map<string, ThreadSecretRequest>();
  for (const e of events) {
    if (e.kind === SECRET_REQUEST_EVENT) {
      const p = payloadOf<SecretRequestPayload>(e);
      if (!out.has(p.id)) out.set(p.id, { id: p.id, event_id: e.id, ask: p.ask, exists: p.exists, state: 'pending', replaced: false });
    } else if (e.kind === SECRET_ANSWER_EVENT) {
      const p = payloadOf<SecretAnswerPayload>(e);
      const r = out.get(p.id);
      if (r && r.state === 'pending') Object.assign(r, { state: p.state, replaced: p.replaced });
    }
  }
  return [...out.values()];
}
