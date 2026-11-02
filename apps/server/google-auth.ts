// Google sign-in for new devices, through Clerk (apps/server/clerk.ts). An install has one owner: the Clerk user a
// client already holding the API token linked from Settings. A device that signs in with Google as that user gets a
// session of its own (`device_sessions`), which the owner can see and revoke, instead of the install's token.
// Anyone with a Google account can make a Clerk account; signing in as anyone but the owner gets nothing here.
//
// Sign-in is the device authorization grant: the server asks Clerk for a code, the client shows it and opens Clerk's
// page, the person approves there, and the client polls the server until Clerk says yes. The device code never
// leaves the server, and the client proves each poll with a secret only it got.
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { db, tx } from './db.ts';
import { closeSessionStreams, sessionsWithStreams } from './session-streams.ts';
import { clerk as defaultClerk, type ClerkClient, type DeviceCode, type Identity } from './clerk.ts';

export type SessionKind = 'browser' | 'app';

/**
 * How a session was granted. `google`: the owner signed in with Google, and it ends when the owner changes or is
 * unlinked. `pairing`: an app redeemed a one-time code (apps/server/app-pairing.ts) from an already authenticated
 * device, and it needs no Google owner.
 */
export type SessionMethod = 'google' | 'pairing';

export interface Owner {
  issuer: string;
  sub: string;
  email: string | null;
  name: string | null;
  linkedAt: string;
}

export interface DeviceSession {
  id: string;
  name: string;
  kind: SessionKind;
  method: SessionMethod;
  createdAt: string;
  lastSeenAt: string;
}

/** A session unused this long stops working. */
const IDLE_DAYS = 90;
/** last_seen_at is written at most this often per session. */
const TOUCH_MS = 60_000;
/** Open sign-ins at once, and new ones a minute: the start route takes no token. */
const MAX_OPEN = 10;
const MAX_STARTS_PER_MIN = 20;

const now = () => new Date().toISOString();
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

// ---------- owner ----------

export function owner(): Owner | null {
  const r = db.prepare('SELECT issuer, sub, email, name, linked_at FROM auth_owner WHERE id = 1').get() as
    | { issuer: string; sub: string; email: string | null; name: string | null; linked_at: string }
    | undefined;
  return r ? { issuer: r.issuer, sub: r.sub, email: r.email, name: r.name, linkedAt: r.linked_at } : null;
}

/**
 * End the live sessions `where` selects: mark them revoked, drop their push tokens and alert choices, and close the SSE
 * streams they hold. Returns their ids. The streams close after the rows commit, so a client that reconnects at once is refused.
 */
function endSessions(where: string, ...params: string[]): string[] {
  const ids = tx(() => {
    const rows = db.prepare(`SELECT id FROM device_sessions WHERE revoked_at IS NULL AND (${where})`).all(...params) as { id: string }[];
    const ids = rows.map((r) => r.id);
    const at = now();
    for (const id of ids) db.prepare('UPDATE device_sessions SET revoked_at = ? WHERE id = ?').run(at, id);
    // Their push tokens and alert choices go with them (push-tokens.ts, push-preferences.ts), in the same commit as the revoke.
    for (const id of ids) db.prepare('DELETE FROM push_tokens WHERE session_id = ?').run(id);
    for (const id of ids) db.prepare('DELETE FROM push_preferences WHERE session_id = ?').run(id);
    return ids;
  });
  closeSessionStreams(ids);
  return ids;
}

/** Make `who` the owner. Google sessions another user's sign-ins made stop working with the change. Paired apps do not depend on the owner. */
export function linkOwner(who: Identity): Owner {
  db.prepare(
    `INSERT INTO auth_owner (id, issuer, sub, email, name, linked_at) VALUES (1, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET issuer = excluded.issuer, sub = excluded.sub, email = excluded.email, name = excluded.name, linked_at = excluded.linked_at`,
  ).run(who.issuer, who.sub, who.email, who.name, now());
  endSessions(`method = 'google' AND sub != ?`, who.sub);
  return owner()!;
}

/** Forget the owner and end every Google session: Google sign-in is off until someone links again. Paired apps keep working. */
export function unlinkOwner() {
  db.prepare('DELETE FROM auth_owner WHERE id = 1').run();
  endSessions(`method = 'google'`);
}

const isOwner = (who: Identity, o = owner()) => !!o && o.issuer === who.issuer && o.sub === who.sub;

// ---------- sessions ----------

/** A new session. Returns the token, which is never stored or shown again. `sub` is the owner's for a Google session and '' for a pairing. */
export function createSession(name: string, kind: SessionKind, sub: string, method: SessionMethod = 'google'): { id: string; token: string } {
  const id = randomUUID();
  const token = `omni_s_${randomBytes(32).toString('hex')}`;
  const at = now();
  db.prepare('INSERT INTO device_sessions (id, token_hash, name, kind, method, sub, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
    id,
    sha256(token),
    name.slice(0, 100) || 'Device',
    kind,
    method,
    sub,
    at,
    at,
  );
  return { id, token };
}

interface SessionRow {
  id: string;
  sub: string;
  kind: SessionKind;
  method: SessionMethod;
  last_seen_at: string;
  revoked_at: string | null;
}

/** Whether a row still opens the door: not revoked, used within IDLE_DAYS, and, for Google, the owner's. */
function liveRow(r: SessionRow | undefined, at: number): r is SessionRow {
  if (!r || r.revoked_at) return false;
  if (at - Date.parse(r.last_seen_at) > IDLE_DAYS * 86_400_000) return false;
  return r.method === 'pairing' || owner()?.sub === r.sub;
}

/** The session a token names, while it is live. */
export function sessionFor(token: string | undefined | null, at = Date.now()): { id: string; kind: SessionKind; method: SessionMethod } | null {
  if (!token?.startsWith('omni_s_')) return null;
  const r = db.prepare('SELECT id, sub, kind, method, last_seen_at, revoked_at FROM device_sessions WHERE token_hash = ?').get(sha256(token)) as SessionRow | undefined;
  if (!liveRow(r, at)) return null;
  touch(r, at);
  return { id: r.id, kind: r.kind, method: r.method };
}

function touch(r: SessionRow, at: number) {
  if (at - Date.parse(r.last_seen_at) > TOUCH_MS) db.prepare('UPDATE device_sessions SET last_seen_at = ? WHERE id = ?').run(new Date(at).toISOString(), r.id);
}

/** The live sessions, most recently used first: the owner's Google sessions, and every paired app. */
export function listSessions(): DeviceSession[] {
  const o = owner();
  const cutoff = new Date(Date.now() - IDLE_DAYS * 86_400_000).toISOString();
  const rows = db
    .prepare(
      `SELECT id, name, kind, method, created_at, last_seen_at FROM device_sessions
       WHERE revoked_at IS NULL AND last_seen_at > ? AND (method = 'pairing' OR sub = ?) ORDER BY last_seen_at DESC`,
    )
    .all(cutoff, o?.sub ?? null) as { id: string; name: string; kind: SessionKind; method: SessionMethod; created_at: string; last_seen_at: string }[];
  return rows.map((r) => ({ id: r.id, name: r.name, kind: r.kind, method: r.method, createdAt: r.created_at, lastSeenAt: r.last_seen_at }));
}

/** How many paired apps are live. */
export function pairedSessionCount(): number {
  const cutoff = new Date(Date.now() - IDLE_DAYS * 86_400_000).toISOString();
  return (db.prepare(`SELECT COUNT(*) AS n FROM device_sessions WHERE revoked_at IS NULL AND method = 'pairing' AND last_seen_at > ?`).get(cutoff) as { n: number }).n;
}

/** End one session and its streams and push token. False when there was no live one by that id. */
export function revokeSession(id: string): boolean {
  return endSessions('id = ?', id).length > 0;
}

/** Whether the session is live now, without counting as use. */
export function sessionIsLive(id: string, at = Date.now()): boolean {
  return liveRow(db.prepare('SELECT id, sub, kind, method, last_seen_at, revoked_at FROM device_sessions WHERE id = ?').get(id) as SessionRow | undefined, at);
}

/**
 * Close the streams of sessions that stopped being live without a revoke: idle past IDLE_DAYS, or the owner changed
 * underneath them. An open stream is not use, so a connection held open past its session's expiry ends here, without
 * waiting for another request. sse.ts runs this every few seconds while a stream is open.
 */
export function reconcileStreams(at = Date.now()) {
  closeSessionStreams(sessionsWithStreams().filter((id) => !sessionIsLive(id, at)));
}

// ---------- sign-in flows ----------

/** `relay`: sign this machine in to the sync relay (apps/server/sync/setup.ts), which checks the ID token itself. */
export type FlowPurpose = 'device' | 'link' | 'relay';

/** What a `relay` flow does once Clerk approves. A throw ends the flow as refused, with its message. */
export type FlowFinish = (who: Identity, idToken: string) => Promise<FlowOutcome>;

interface Flow {
  id: string;
  secretHash: string;
  purpose: FlowPurpose;
  name: string;
  kind: SessionKind;
  code: DeviceCode;
  finish: FlowFinish | null;
  expiresAt: number;
  /** Clerk is asked no sooner than this, whatever the client's pace. */
  nextPollAt: number;
  interval: number;
  /** Set once the flow is over, so a late poll gets the same answer. */
  outcome: FlowOutcome | null;
}

export type FlowOutcome =
  | { state: 'signed_in'; kind: SessionKind; session: { id: string; token: string } }
  | { state: 'linked'; owner: Owner }
  | { state: 'relay_signed_in'; email: string | null; relayChanged: boolean }
  | { state: 'refused'; error: string }
  | { state: 'denied' }
  | { state: 'expired' };

export type PollResult = { state: 'pending' } | FlowOutcome;

/** What a client shows: the code to compare, and where to approve it. */
export interface FlowStart {
  flow: string;
  secret: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string | null;
  expiresAt: string;
  interval: number;
}

/** A refusal the API answers with this status. */
export class SignInError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409 | 429 | 502,
  ) {
    super(message);
  }
}

const flows = new Map<string, Flow>();
const starts: number[] = [];

function prune(at: number) {
  // A finished flow stays a minute past its expiry, so a client's last poll still finds its answer.
  for (const [id, f] of flows) if (at > f.expiresAt + 60_000) flows.delete(id);
  while (starts.length && at - starts[0] > 60_000) starts.shift();
}

export interface FlowDeps {
  clerk: () => ClerkClient | null;
  now: () => number;
}

const defaultDeps: FlowDeps = { clerk: defaultClerk, now: Date.now };

/**
 * Begin a sign-in. `device` makes a session for the owner and needs one linked; `link` makes the signer the owner,
 * and only a client holding the API token may start it (auth-api.ts checks that). `relay` runs opts.finish.
 */
export async function startFlow(
  purpose: FlowPurpose,
  opts: { name: string; kind: SessionKind; finish?: FlowFinish },
  deps: FlowDeps = defaultDeps,
): Promise<FlowStart> {
  const client = deps.clerk();
  if (!client) throw new SignInError('Google sign-in is not set up on this Omni', 409);
  if (purpose === 'device' && !owner()) throw new SignInError('No Google account is linked to this Omni yet. Link one in Settings, Sharing & access, on a device that is already paired', 409);
  const at = deps.now();
  prune(at);
  const open = [...flows.values()].filter((f) => !f.outcome).length;
  if (open >= MAX_OPEN || starts.length >= MAX_STARTS_PER_MIN) throw new SignInError('Too many sign-ins at once. Try again in a minute', 429);
  starts.push(at);
  let code: DeviceCode;
  try {
    code = await client.startDevice();
  } catch (err) {
    throw new SignInError((err as Error).message, 502);
  }
  const id = randomUUID();
  const secret = randomBytes(24).toString('hex');
  const expiresAt = at + code.expiresIn * 1000;
  flows.set(id, { id, secretHash: sha256(secret), purpose, name: opts.name, kind: opts.kind, code, finish: opts.finish ?? null, expiresAt, nextPollAt: at + code.interval * 1000, interval: code.interval, outcome: null });
  return {
    flow: id,
    secret,
    userCode: code.userCode,
    verificationUri: code.verificationUri,
    verificationUriComplete: code.verificationUriComplete,
    expiresAt: new Date(expiresAt).toISOString(),
    interval: code.interval,
  };
}

const secretMatches = (f: Flow, secret: string) => timingSafeEqual(Buffer.from(f.secretHash), Buffer.from(sha256(secret)));

/** One poll from the client. Asks Clerk only when the interval Clerk set has passed. `relay` flows only answer when `relay` is set, and only they do then. */
export async function pollFlow(id: string, secret: string, deps: FlowDeps = defaultDeps, relay = false): Promise<PollResult> {
  const at = deps.now();
  prune(at);
  const f = flows.get(id);
  if (!f || !secretMatches(f, secret) || (f.purpose === 'relay') !== relay) throw new SignInError('No such sign-in. Start again', 404);
  if (f.outcome) return f.outcome;
  if (at > f.expiresAt) return (f.outcome = { state: 'expired' });
  if (at < f.nextPollAt) return { state: 'pending' };
  const client = deps.clerk();
  if (!client) return (f.outcome = { state: 'refused', error: 'Google sign-in is no longer set up on this Omni' });
  f.nextPollAt = at + f.interval * 1000;
  let r;
  try {
    r = await client.pollDevice(f.code.deviceCode);
  } catch (err) {
    // A Clerk outage or a bad token ends this sign-in with why; the client can start another.
    return (f.outcome = { state: 'refused', error: (err as Error).message });
  }
  if (r.state === 'pending') return r;
  if (r.state === 'slow_down') {
    f.interval += 5;
    f.nextPollAt = at + f.interval * 1000;
    return { state: 'pending' };
  }
  if (r.state !== 'done') return (f.outcome = r);
  if (f.finish) {
    const finish = f.finish;
    f.finish = null;
    // Polls that come while it runs (a relay call) wait for its outcome instead of asking Clerk with a spent code.
    f.nextPollAt = Infinity;
    try {
      return (f.outcome = await finish(r.identity, r.idToken));
    } catch (err) {
      return (f.outcome = { state: 'refused', error: (err as Error).message });
    }
  }
  if (f.purpose === 'link') return (f.outcome = { state: 'linked', owner: linkOwner(r.identity) });
  if (!isOwner(r.identity)) {
    const who = r.identity.email ? `${r.identity.email} does not` : 'That Google account does not';
    return (f.outcome = { state: 'refused', error: `${who} own this Omni. Sign in with the account linked in Settings, Sharing & access` });
  }
  return (f.outcome = { state: 'signed_in', kind: f.kind, session: createSession(f.name, f.kind, r.identity.sub) });
}

/** For tests: forget open sign-ins and the start count. */
export function resetFlows() {
  flows.clear();
  starts.length = 0;
}

/** A short name for a browser from its User-Agent, like "Safari on iPhone". */
export function browserName(ua: string | undefined): string {
  const s = ua ?? '';
  const os = /iPhone/.test(s) ? 'iPhone' : /iPad/.test(s) ? 'iPad' : /Android/.test(s) ? 'Android' : /Mac OS X|Macintosh/.test(s) ? 'Mac' : /Windows/.test(s) ? 'Windows' : /Linux/.test(s) ? 'Linux' : null;
  const app = /Edg\//.test(s) ? 'Edge' : /Firefox\//.test(s) ? 'Firefox' : /Chrome\//.test(s) ? 'Chrome' : /Safari\//.test(s) ? 'Safari' : 'Browser';
  return os ? `${app} on ${os}` : app;
}
