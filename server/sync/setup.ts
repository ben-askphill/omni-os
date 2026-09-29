import { createHash } from 'node:crypto';
import { db, kv, outbox } from '../db.ts';
import { deleteSecret, setSecret, SYNC_SECRETS } from '../secrets.ts';
import { backfill } from './backfill.ts';
import type { PathMap } from './paths.ts';
import { setActiveWorker, startSync, syncConfigured, type SyncWorker } from './worker.ts';

// Turning sync on and off from Settings. Sign-in is Ben's one Supabase user, by password or by an emailed code.
// Only the project URL, the anon key and the refresh token are kept, all three in the Keychain. The password
// and the code are used once and dropped: they never reach the db, a log or the Keychain.

export interface SetupRequest {
  url: string;
  anonKey: string;
  email: string;
  password?: string;
  /** The code from the sign-in email. Neither a password nor a code: send that email. */
  code?: string;
}

export interface SyncSession {
  refreshToken: string;
  userId: string;
  email: string | null;
}

/** Supabase Auth, as setup uses it. The real one is supabaseAuth; tests pass a fake. */
export interface SyncAuth {
  signInWithPassword(email: string, password: string): Promise<SyncSession>;
  sendCode(email: string): Promise<void>;
  verifyCode(email: string, code: string): Promise<SyncSession>;
  /** After a sign-in: throws when the project lacks the `changes` table or the `omni` bucket. */
  probe(): Promise<void>;
}

export interface SetupDeps {
  auth: (url: string, anonKey: string) => SyncAuth;
  /** A global secret into the Keychain. */
  storeSecret: (name: string, value: string) => Promise<void>;
  deleteSecret: (name: string) => Promise<void>;
  /** Start the server's worker from the stored credentials, or null when sync is off. */
  start: () => Promise<SyncWorker | null>;
}

/** A setup refusal, with the HTTP status the API answers. */
export class SetupError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 401 | 409 | 502,
  ) {
    super(message);
  }
}

export type SetupResult = { state: 'code_sent'; email: string } | { state: 'signed_in'; email: string; relayChanged: boolean };

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

/** The role a legacy JWT key claims, or null for a key that is not one. */
function jwtRole(key: string): string | null {
  const part = key.split('.')[1];
  if (!part) return null;
  try {
    return (JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as { role?: string }).role ?? null;
  } catch {
    return null;
  }
}

/** Check and tidy a setup body. Throws SetupError(400) with what to fix. */
export function checkSetup(body: unknown): SetupRequest {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  let url: URL;
  try {
    url = new URL(str(b.url));
  } catch {
    throw new SetupError('Paste the Supabase URL, like https://<project>.supabase.co', 400);
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) throw new SetupError('The Supabase URL must use https', 400);
  const anonKey = str(b.anonKey);
  if (!anonKey || /\s/.test(anonKey)) throw new SetupError('Paste the anon key (or the publishable key), one line', 400);
  if (anonKey.startsWith('sb_secret_') || jwtRole(anonKey) === 'service_role')
    throw new SetupError('That is a service-role (secret) key. Use the anon or publishable key: Omni never takes a service-role key', 400);
  const email = str(b.email);
  if (!/^[^@\s]+@[^@\s]+$/.test(email)) throw new SetupError('Enter the email of your Supabase user', 400);
  const password = typeof b.password === 'string' && b.password ? b.password : undefined;
  const code = str(b.code) || undefined;
  if (password && code) throw new SetupError('Send a password or a code, not both', 400);
  return { url: url.origin + url.pathname.replace(/\/+$/, ''), anonKey, email, password, code };
}

/** Which relay and user this machine syncs with, hashed: the cursor only means something for that pair. */
const relayId = (url: string, userId: string) => createHash('sha256').update(`${url}\n${userId}`).digest('hex').slice(0, 16);

/**
 * Sign in and turn sync on. Without a password or code this only sends the sign-in email.
 * Moving to another relay or user starts over there: the cursor goes back to 0, parked remote changes go, and
 * this machine's history is queued again.
 */
export async function setupSync(input: SetupRequest, deps: SetupDeps): Promise<SetupResult> {
  const auth = deps.auth(input.url, input.anonKey);
  if (!input.password && !input.code) {
    await auth.sendCode(input.email).catch(authFailed);
    return { state: 'code_sent', email: input.email };
  }
  const session = await (input.password ? auth.signInWithPassword(input.email, input.password) : auth.verifyCode(input.email, input.code!)).catch(authFailed);
  await auth.probe().catch((err: Error) => {
    throw new SetupError(`Signed in, but the relay is not set up: ${err.message}. Run the one-time Supabase setup in README.md`, 502);
  });

  await deps.storeSecret(SYNC_SECRETS.url, input.url);
  await deps.storeSecret(SYNC_SECRETS.anonKey, input.anonKey);
  await deps.storeSecret(SYNC_SECRETS.refreshToken, session.refreshToken);

  const relay = relayId(input.url, session.userId);
  const before = kv.get<string>('sync.relay');
  const relayChanged = !!before && before !== relay;
  if (relayChanged) {
    // The old relay's sync must be over first, or it could write its cursor over the reset below.
    await setActiveWorker(null);
    kv.set('sync.cursor', 0);
    db.exec('DELETE FROM sync_deferred');
    if (outbox.machineId()) backfill();
  }
  kv.set('sync.relay', relay);
  kv.set('sync.enabled', true);
  await deps.start();
  return { state: 'signed_in', email: session.email ?? input.email, relayChanged };
}

function authFailed(err: unknown): never {
  const e = err as { message?: string; status?: number; name?: string };
  const refused = !!e.status && e.status >= 400 && e.status < 500;
  throw new SetupError(e.message || 'sign-in failed', refused ? 401 : 502);
}

/** Stop syncing. With forget, also remove the credentials from the Keychain, so it takes a new sign-in. */
export async function disableSync(opts: { forget?: boolean }, deps: SetupDeps) {
  await setActiveWorker(null);
  kv.set('sync.enabled', false);
  if (opts.forget) for (const name of Object.values(SYNC_SECRETS)) await deps.deleteSecret(name);
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

/** Supabase Auth over @supabase/supabase-js. The client keeps its session in memory only and never refreshes it itself. */
export function supabaseAuth(url: string, anonKey: string): SyncAuth {
  const client = import('@supabase/supabase-js').then(({ createClient }) =>
    createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }),
  );
  let userId: string | null = null;
  const session = (data: { session: { refresh_token: string } | null; user: { id: string; email?: string } | null }): SyncSession => {
    if (!data.session || !data.user) throw new Error('no session');
    userId = data.user.id;
    return { refreshToken: data.session.refresh_token, userId: data.user.id, email: data.user.email ?? null };
  };
  return {
    async signInWithPassword(email, password) {
      const { data, error } = await (await client).auth.signInWithPassword({ email, password });
      if (error) throw error;
      return session(data);
    },
    async sendCode(email) {
      // shouldCreateUser: false, so a typo never makes a second user.
      const { error } = await (await client).auth.signInWithOtp({ email, options: { shouldCreateUser: false } });
      if (error) throw error;
    },
    async verifyCode(email, code) {
      const { data, error } = await (await client).auth.verifyOtp({ email, token: code, type: 'email' });
      if (error) throw error;
      return session(data);
    },
    async probe() {
      const c = await client;
      const changes = await c.from('changes').select('seq').limit(1);
      if (changes.error) throw new Error(`no changes table (${changes.error.message})`);
      const bucket = await c.storage.from('omni').list(userId ?? '', { limit: 1 });
      if (bucket.error) throw new Error(`no omni bucket (${bucket.error.message})`);
    },
  };
}

export const defaultSetupDeps: SetupDeps = {
  auth: supabaseAuth,
  storeSecret: (name, value) => setSecret('global', name, value),
  deleteSecret: (name) => deleteSecret('global', name),
  start: startSync,
};
