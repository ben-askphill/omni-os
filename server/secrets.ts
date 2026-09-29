import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { db } from './db.ts';

// Secret values live only in the macOS Keychain (service "omni-os").
// The DB keeps names and scopes so the UI can list them without reading values.
const SERVICE = 'omni-os';
const run = promisify(execFile);

/** Omni's own sync credentials (server/sync/worker.ts). Global, and never handed to an agent's environment. */
export const SYNC_SECRETS = { url: 'SUPABASE_URL', anonKey: 'SUPABASE_ANON_KEY', refreshToken: 'SUPABASE_REFRESH_TOKEN' } as const;
const PRIVATE = new Set<string>(Object.values(SYNC_SECRETS));

export const NAME_RE = /^[A-Z][A-Z0-9_]{0,63}$/;
export const SCOPE_RE = /^(global|channel:[a-z0-9-]+)$/;

const account = (scope: string, name: string) => `${scope}/${name}`;
const quote = (s: string) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

export function listSecrets(): { scope: string; name: string; updated_at: string }[] {
  return db.prepare('SELECT scope, name, updated_at FROM secrets ORDER BY scope, name').all() as any;
}

export async function setSecret(scope: string, name: string, value: string) {
  if (!SCOPE_RE.test(scope)) throw new Error('invalid scope');
  if (!NAME_RE.test(name)) throw new Error('name must be UPPER_SNAKE_CASE');
  if (!value || /[\r\n]/.test(value)) throw new Error('value must be a single non-empty line');
  // `security -i` reads the command from stdin, so the value never shows up in `ps`.
  await new Promise<void>((resolve, reject) => {
    const child = spawn('security', ['-i'], { stdio: ['pipe', 'ignore', 'pipe'] });
    let err = '';
    child.stderr.on('data', (d) => (err += d));
    child.on('error', reject);
    child.on('close', (code) => (code === 0 && !err.trim() ? resolve() : reject(new Error(err.trim() || `security exited ${code}`))));
    child.stdin.end(`add-generic-password -U -s ${SERVICE} -a ${quote(account(scope, name))} -w ${quote(value)}\n`);
  });
  db.prepare(
    `INSERT INTO secrets (scope, name) VALUES (?, ?)
     ON CONFLICT(scope, name) DO UPDATE SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
  ).run(scope, name);
}

export async function deleteSecret(scope: string, name: string) {
  await run('security', ['delete-generic-password', '-s', SERVICE, '-a', account(scope, name)]).catch(() => {});
  db.prepare('DELETE FROM secrets WHERE scope = ? AND name = ?').run(scope, name);
}

async function readSecret(scope: string, name: string): Promise<string | null> {
  try {
    const { stdout } = await run('security', ['find-generic-password', '-s', SERVICE, '-a', account(scope, name), '-w']);
    return stdout.replace(/\n$/, '');
  } catch {
    return null;
  }
}

/** One global secret from the Keychain, or null when it is missing. The value is never logged. */
export async function globalSecret(name: string): Promise<string | null> {
  if (!NAME_RE.test(name)) return null;
  return readSecret('global', name);
}

/** Global secrets, overridden by channel-scoped ones with the same name. Omni's sync credentials stay out. */
export async function secretsEnv(channelId: string): Promise<Record<string, string>> {
  const rows = db
    .prepare(`SELECT scope, name FROM secrets WHERE scope = 'global' OR scope = ? ORDER BY scope = 'global' DESC`)
    .all(`channel:${channelId}`) as { scope: string; name: string }[];
  const env: Record<string, string> = {};
  for (const r of rows) {
    if (r.scope === 'global' && PRIVATE.has(r.name)) continue;
    const v = await readSecret(r.scope, r.name);
    if (v != null) env[r.name] = v;
  }
  return env;
}
