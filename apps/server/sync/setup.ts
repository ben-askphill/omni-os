import { createHash } from 'node:crypto';
import { clerkConfig, type ClerkConfig } from '../clerk.ts';
import { forgetConnect } from '../connect/service.ts';
import { db, kv, outbox } from '../db.ts';
import { pollFlow, SignInError, startFlow, type FlowDeps, type FlowOutcome, type FlowStart, type PollResult } from '../google-auth.ts';
import { deleteSecret, globalSecret, LEGACY_SYNC_SECRETS, setSecret, SYNC_SECRETS } from '../secrets.ts';
import { backfill } from './backfill.ts';
import { announceSyncPaused, computerName } from './devices.ts';
import type { PathMap } from './paths.ts';
import { relayAuth, RelayRefusedError, type RelayAuth } from './transport.ts';
import { activeWorker, flushSync, setActiveWorker, startSync, syncConfigured, type SyncWorker } from './worker.ts';

// Turning sync on and off from Settings. Sign-in is Google through Clerk, the same device grant that signs in a new
// device (google-auth.ts): Omni shows a code, the person approves it on Clerk's page, and Omni hands the ID token it
// gets to the relay (apps/relay), which checks it and its ALLOWED_USERS and answers with this machine's own token.
// Only the relay URL and that token are kept, both in the secret store. The ID token is used once and dropped.

export interface SetupDeps {
  relay: RelayAuth;
  /** This install's Clerk app: the relay has to trust the same one. */
  clerk: () => ClerkConfig | null;
  /** How the relay lists this machine's token. */
  machineName: () => Promise<string>;
  /** Clerk, for the sign-in flow. Unset: the install's. */
  flows?: FlowDeps;
  /** A global secret in the secret store. */
  storeSecret: (name: string, value: string) => Promise<void>;
  readSecret: (name: string) => Promise<string | null>;
  deleteSecret: (name: string) => Promise<void>;
  /** Start the server's worker from the stored credentials, or null when sync is off. */
  start: () => Promise<SyncWorker | null>;
}

/** A setup refusal, with the HTTP status the API answers. */
export class SetupError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409 | 429 | 502,
  ) {
    super(message);
  }
}

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

/** The relay URL from a setup body: https, or http on this machine for a relay under `wrangler dev`. Throws SetupError(400). */
export function checkRelayUrl(body: unknown): string {
  const raw = str((body as { url?: unknown } | null)?.url);
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new SetupError('Paste the relay URL, like https://omni-relay.<you>.workers.dev', 400);
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) throw new SetupError('The relay URL must use https', 400);
  return url.origin + url.pathname.replace(/\/+$/, '');
}

/** Which relay and user this machine syncs with, hashed: the cursor only means something for that pair. */
const relayId = (url: string, userId: string) => createHash('sha256').update(`${url}\n${userId}`).digest('hex').slice(0, 16);

const flowError = (err: unknown): never => {
  if (err instanceof SignInError) throw new SetupError(err.message, err.status);
  throw err;
};

/**
 * Check the relay trusts this install's Clerk app, then start the Google sign-in. The flow's poll
 * (pollRelaySignIn) trades the ID token for a relay token and turns sync on.
 */
export async function startRelaySignIn(url: string, deps: SetupDeps): Promise<FlowStart> {
  const info = await deps.relay.info(url).catch((err: Error) => {
    throw new SetupError(err.message, err instanceof RelayRefusedError ? 400 : 502);
  });
  const local = deps.clerk();
  if (!local) throw new SetupError('Google sign-in is not set up on this Omni. Set the Clerk app in Settings, Sharing & access first', 409);
  if (!info.issuer || !info.clientId) throw new SetupError('The relay has no Clerk app yet. Run npm run relay:config and set the secrets it prints', 409);
  if (info.issuer !== local.issuer || info.clientId !== local.clientId)
    throw new SetupError(`The relay trusts another Clerk app (${info.issuer}, ${info.clientId}) than this Omni (${local.issuer}, ${local.clientId})`, 409);
  const name = await deps.machineName();
  return startFlow('relay', { name, kind: 'app', finish: (_who, idToken) => finishRelaySignIn(url, idToken, name, deps) }, deps.flows).catch(flowError);
}

export async function pollRelaySignIn(flow: string, secret: string, deps: SetupDeps): Promise<PollResult> {
  return pollFlow(flow, secret, deps.flows, true).catch(flowError);
}

/**
 * Trade the ID token for this machine's relay token and turn sync on. Moving to another relay or user (the
 * Supabase relay included) starts over there: the cursor goes back to 0, parked remote changes go, and this
 * machine's history is queued again.
 */
async function finishRelaySignIn(url: string, idToken: string, machine: string, deps: SetupDeps): Promise<FlowOutcome> {
  const { token, user } = await deps.relay.exchange(url, idToken, machine);
  await deps.storeSecret(SYNC_SECRETS.url, url);
  await deps.storeSecret(SYNC_SECRETS.token, token);
  for (const name of LEGACY_SYNC_SECRETS) await deps.deleteSecret(name).catch(() => {});

  const relay = relayId(url, user.id);
  const before = kv.get<string>('sync.relay');
  const relayChanged = !!before && before !== relay;
  if (relayChanged) {
    // The old relay's sync must be over first, or it could write its cursor over the reset below.
    await setActiveWorker(null);
    kv.set('sync.cursor', 0);
    kv.set('sync.files_backfill', null);
    db.exec('DELETE FROM sync_deferred');
    if (outbox.machineId()) backfill();
  }
  kv.set('sync.relay', relay);
  kv.set('sync.enabled', true);
  await deps.start();
  return { state: 'relay_signed_in', email: user.email, relayChanged };
}

/** Stop syncing. With forget, also end this machine's token on the relay and remove the credentials, so it takes a new sign-in. */
export async function disableSync(opts: { forget?: boolean }, deps: SetupDeps) {
  kv.set('sync.enabled', false);
  const worker = activeWorker();
  if (worker) {
    announceSyncPaused(worker.machineId);
    await flushSync(2_000);
  }
  await setActiveWorker(null);
  if (!opts.forget) return;
  const [url, token] = await Promise.all([deps.readSecret(SYNC_SECRETS.url), deps.readSecret(SYNC_SECRETS.token)]);
  // Offline, or the relay is gone: the token stays valid there until it is taken off ALLOWED_USERS, but this machine forgets it.
  if (url && token) await deps.relay.revoke(url, token).catch((err: Error) => console.warn(`[sync] could not sign out on the relay: ${err.message}`));
  // Omni Connect rides on this sign-in, and the relay drops the machine's tunnel with its token.
  await forgetConnect();
  for (const name of [...Object.values(SYNC_SECRETS), ...LEGACY_SYNC_SECRETS]) await deps.deleteSecret(name);
}

/** Resume with the stored credentials. */
export async function enableSync(deps: SetupDeps) {
  if (!syncConfigured()) throw new SetupError('Sign in first', 409);
  kv.set('sync.enabled', true);
  await deps.start();
}

/** Check a path map from the Settings editor: "~" or absolute paths both sides, trailing slashes dropped. */
export function checkPathMap(body: unknown): PathMap {
  const map = (body as { map?: unknown } | null)?.map;
  if (!map || typeof map !== 'object' || Array.isArray(map)) throw new SetupError('Send {map: {"<remote path>": "<path here>"}}', 400);
  const out: PathMap = {};
  const tidy = (p: unknown, side: string) => {
    const s = str(p);
    if (!(s === '~' || s.startsWith('~/') || s.startsWith('/'))) throw new SetupError(`${side} "${String(p)}" must start with / or ~`, 400);
    return s.length > 1 ? s.replace(/\/+$/, '') || '/' : s;
  };
  const entries = Object.entries(map as Record<string, unknown>);
  if (entries.length > 100) throw new SetupError('At most 100 path mappings', 400);
  for (const [from, to] of entries) out[tidy(from, 'From')] = tidy(to, 'To');
  return out;
}

// ---------- the real dependencies ----------

export const defaultSetupDeps: SetupDeps = {
  relay: relayAuth(),
  clerk: clerkConfig,
  machineName: computerName,
  storeSecret: (name, value) => setSecret('global', name, value),
  readSecret: globalSecret,
  deleteSecret: (name) => deleteSecret('global', name),
  start: startSync,
};
