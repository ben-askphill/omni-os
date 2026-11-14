import { db } from './db.ts';
import { SERVER_ONLY_VARS } from './harness/env-guard.ts';
import { WEBHOOK_SECRET_PREFIX } from './github-webhook.ts';
import { secretStore } from './secret-store.ts';

// Secret values live only in the platform's secret store (secret-store.ts): the macOS Keychain, service "omni-os",
// on a Mac. The DB keeps names and scopes so the UI can list them without reading values.

/** Omni's own sync credentials (apps/server/sync/worker.ts). Global, and never handed to an agent's environment. */
export const SYNC_SECRETS = { url: 'OMNI_RELAY_URL', token: 'OMNI_RELAY_TOKEN' } as const;
/** The Supabase relay's, from before the Cloudflare one (ADR 0008). Still kept from threads until a new sign-in removes them. */
export const LEGACY_SYNC_SECRETS = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_REFRESH_TOKEN'] as const;
/** Omni Connect's machine key and tunnel token (apps/server/connect/service.ts). Global, and never handed to an agent. */
export const CONNECT_SECRET_NAMES = ['OMNI_CONNECT_KEY', 'OMNI_CONNECT_TUNNEL_TOKEN'] as const;
/** This machine's key for secrets other machines send it (secret-drop.ts). Global, and never handed to an agent. */
export const SEAL_SECRET_NAME = 'OMNI_SEAL_KEY';
/** This machine's key for signing the sync changes it pushes (sync/sign-key.ts). Global, and never handed to an agent. */
export const SIGN_SECRET_NAME = 'OMNI_SIGN_KEY';
/** The APNs signing key push-sender.ts reads. Global, and never handed to an agent. */
export const APNS_KEY_SECRET = 'APNS_AUTH_KEY';
const PRIVATE = new Set<string>([...Object.values(SYNC_SECRETS), ...LEGACY_SYNC_SECRETS, ...CONNECT_SECRET_NAMES, SEAL_SECRET_NAME, SIGN_SECRET_NAME, APNS_KEY_SECRET]);
const SERVER_ONLY = new Set<string>(SERVER_ONLY_VARS);

/** False for Omni's sync, Connect and seal credentials (global only), the Grok Bot webhook and webhook signing secrets (any scope). */
export function secretReachesThread(scope: string, name: string): boolean {
  if (SERVER_ONLY.has(name) || name.startsWith(WEBHOOK_SECRET_PREFIX)) return false;
  if (scope === 'global' && PRIVATE.has(name)) return false;
  return true;
}

export const NAME_RE = /^[A-Z][A-Z0-9_]{0,63}$/;
export const SCOPE_RE = /^(global|channel:[a-z0-9-]+)$/;

const account = (scope: string, name: string) => `${scope}/${name}`;

type SecretListener = (scope: string, name: string) => void;
const listeners = new Set<SecretListener>();

/** Called after a secret is set or deleted, with its scope and name. For code that reads a secret once and caches it. */
export function onSecretChange(fn: SecretListener): () => void {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

function changed(scope: string, name: string) {
  for (const fn of listeners) {
    try {
      fn(scope, name);
    } catch (err) {
      console.error('[secrets] change listener failed:', (err as Error).message);
    }
  }
}

export function listSecrets(): { scope: string; name: string; updated_at: string }[] {
  return db.prepare('SELECT scope, name, updated_at FROM secrets ORDER BY scope, name').all() as any;
}

export async function setSecret(scope: string, name: string, value: string) {
  if (!SCOPE_RE.test(scope)) throw new Error('invalid scope');
  if (!NAME_RE.test(name)) throw new Error('name must be UPPER_SNAKE_CASE');
  if (!value || /[\r\n]/.test(value)) throw new Error('value must be a single non-empty line');
  await secretStore().write(account(scope, name), value);
  db.prepare(
    `INSERT INTO secrets (scope, name) VALUES (?, ?)
     ON CONFLICT(scope, name) DO UPDATE SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
  ).run(scope, name);
  changed(scope, name);
}

export async function deleteSecret(scope: string, name: string) {
  await secretStore().remove(account(scope, name));
  db.prepare('DELETE FROM secrets WHERE scope = ? AND name = ?').run(scope, name);
  changed(scope, name);
}

function readSecret(scope: string, name: string): Promise<string | null> {
  return secretStore().read(account(scope, name));
}

/** Whether a secret of this name is set in this scope. Reads the names table only, never the store. */
export function hasSecret(scope: string, name: string): boolean {
  return !!db.prepare('SELECT 1 FROM secrets WHERE scope = ? AND name = ?').get(scope, name);
}

/** One global secret from the store, or null when it is missing. The value is never logged. */
export async function globalSecret(name: string): Promise<string | null> {
  if (!NAME_RE.test(name)) return null;
  return readSecret('global', name);
}

/** Global secrets, overridden by channel-scoped ones with the same name. Sync credentials and the Grok Bot webhook stay out. */
export async function secretsEnv(channelId: string): Promise<Record<string, string>> {
  const rows = db
    .prepare(`SELECT scope, name FROM secrets WHERE scope = 'global' OR scope = ? ORDER BY scope = 'global' DESC`)
    .all(`channel:${channelId}`) as { scope: string; name: string }[];
  const env: Record<string, string> = {};
  for (const r of rows) {
    if (!secretReachesThread(r.scope, r.name)) continue;
    const v = await readSecret(r.scope, r.name);
    if (v != null) env[r.name] = v;
  }
  return env;
}

/**
 * The values of the secrets a channel action names, channel scope first, then global, read from the store. A name
 * set in neither scope, or one no thread may have, is in `missing`.
 */
export async function namedSecrets(channelId: string, names: string[]): Promise<{ env: Record<string, string>; missing: string[] }> {
  const env: Record<string, string> = {};
  const missing: string[] = [];
  for (const name of names) {
    let value: string | null = null;
    for (const scope of [`channel:${channelId}`, 'global']) {
      if (value == null && secretReachesThread(scope, name) && hasSecret(scope, name)) value = await readSecret(scope, name);
    }
    if (value == null) missing.push(name);
    else env[name] = value;
  }
  return { env, missing };
}
