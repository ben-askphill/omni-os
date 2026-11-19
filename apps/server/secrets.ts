import { db } from './db.ts';
import { harnessKeyNames } from './harness/custom.ts';
import { NAME_RE, omniCredential, SCOPE_RE } from './secret-names.ts';
import { secretStore } from './secret-store.ts';

export { APNS_KEY_SECRET, CONNECT_SECRET_NAMES, LEGACY_SYNC_SECRETS, NAME_RE, omniCredential, SCOPE_RE, SEAL_SECRET_NAME, SIGN_SECRET_NAME, SYNC_SECRETS } from './secret-names.ts';

// Secret values live only in the platform's secret store (secret-store.ts): the macOS Keychain, service "omni-os",
// on a Mac. The DB keeps names and scopes so the UI can list them without reading values.

/**
 * Whether a secret may go into a thread's environment, a terminal or a channel action. Not Omni's own credentials, and
 * not a remote harness's key (Hermes's or a custom harness's, harness/custom.ts), in any scope: that key goes only to
 * its harness's HTTP client (runner/spawn.ts harnessKey), so a local agent cannot call the server with it.
 * `keys` is the set of harness key names, for a caller that checks many secrets at once.
 */
export function secretReachesThread(scope: string, name: string, keys: ReadonlySet<string> = harnessKeyNames()): boolean {
  return !omniCredential(scope, name) && !keys.has(name);
}

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

/**
 * Every stored secret's value, in every scope, so text can be masked before it reaches a model (usage-scan/mask.ts).
 * A value the store cannot read is skipped. Never log or return these.
 */
export async function secretValues(): Promise<string[]> {
  const out: string[] = [];
  for (const r of listSecrets()) {
    const v = await readSecret(r.scope, r.name).catch(() => null);
    if (v) out.push(v);
  }
  return out;
}

/** Global secrets, overridden by channel-scoped ones with the same name. Omni's own credentials and harness keys stay out. */
export async function secretsEnv(channelId: string): Promise<Record<string, string>> {
  const rows = db
    .prepare(`SELECT scope, name FROM secrets WHERE scope = 'global' OR scope = ? ORDER BY scope = 'global' DESC`)
    .all(`channel:${channelId}`) as { scope: string; name: string }[];
  const env: Record<string, string> = {};
  const keys = harnessKeyNames();
  for (const r of rows) {
    if (!secretReachesThread(r.scope, r.name, keys)) continue;
    const v = await readSecret(r.scope, r.name);
    if (v != null) env[r.name] = v;
  }
  return env;
}

/**
 * A remote harness's key, for its HTTP client only: the channel's secret of that name, else the global one. Never put
 * it in an environment. Null when neither is set on this machine.
 */
export async function harnessKey(channelId: string, name: string): Promise<string | null> {
  if (!NAME_RE.test(name) || omniCredential('global', name)) return null;
  for (const scope of [`channel:${channelId}`, 'global']) if (hasSecret(scope, name)) return readSecret(scope, name);
  // A key in the secret store with no row in Secrets counts too, as the catalog probe reads it.
  return readSecret('global', name);
}

/**
 * The values of the secrets a channel action names, channel scope first, then global, read from the store. A name
 * set in neither scope, or one no thread may have, is in `missing`.
 */
export async function namedSecrets(channelId: string, names: string[]): Promise<{ env: Record<string, string>; missing: string[] }> {
  const env: Record<string, string> = {};
  const missing: string[] = [];
  const keys = harnessKeyNames();
  for (const name of names) {
    let value: string | null = null;
    for (const scope of [`channel:${channelId}`, 'global']) {
      if (value == null && secretReachesThread(scope, name, keys) && hasSecret(scope, name)) value = await readSecret(scope, name);
    }
    if (value == null) missing.push(name);
    else env[name] = value;
  }
  return { env, missing };
}
