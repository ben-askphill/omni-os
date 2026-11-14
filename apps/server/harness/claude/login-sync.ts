// Carries a Claude Code login made over ssh into the Keychain, where Omni's threads look for it.
//
// On a Mac the claude CLI keeps its login in the Keychain item "Claude Code-credentials" and reads that ahead of
// ~/.claude/.credentials.json. Over ssh the login keychain is locked, so `claude auth login` there saves the new
// login to the file instead. Omni runs in the desktop session, where the Keychain is open: its threads keep reading
// the old login and fail with "OAuth session expired and could not be refreshed" while claude in the ssh shell works.
// Before each Claude Code spawn, a file login that expires later than the Keychain's replaces the Keychain's.
// Everything else in the Keychain item (MCP logins) stays.
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir, userInfo } from 'node:os';
import { join } from 'node:path';

export const KEYCHAIN_SERVICE = 'Claude Code-credentials';

interface OauthLogin {
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
}
type Credentials = { claudeAiOauth?: OauthLogin } & Record<string, unknown>;

export interface LoginSyncDeps {
  /** ~/.claude/.credentials.json, or null when there is none. */
  readFile(): string | null;
  /** The Keychain item's value, or null when it is missing or the Keychain is locked. */
  readKeychain(): string | null;
  writeKeychain(value: string): void;
  now(): number;
}

export type LoginSyncResult = 'no-file' | 'no-keychain' | 'unreadable' | 'current' | 'expired' | 'synced';

const parse = (s: string | null): Credentials | null => {
  if (!s) return null;
  try {
    const v = JSON.parse(s);
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
};

/** Copies the file's login into the Keychain item when it is the newer, unexpired one. Never throws. */
export function syncClaudeLogin(deps: LoginSyncDeps): LoginSyncResult {
  try {
    const file = parse(deps.readFile())?.claudeAiOauth;
    if (!file?.refreshToken || typeof file.expiresAt !== 'number') return 'no-file';
    const raw = deps.readKeychain();
    // No item: claude falls back to the file by itself.
    if (raw === null) return 'no-keychain';
    const keychain = parse(raw);
    if (!keychain) return 'unreadable';
    const current = keychain.claudeAiOauth;
    if (current?.refreshToken === file.refreshToken) return 'current';
    if (typeof current?.expiresAt === 'number' && current.expiresAt >= file.expiresAt) return 'current';
    if (file.expiresAt <= deps.now()) return 'expired';
    deps.writeKeychain(JSON.stringify({ ...keychain, claudeAiOauth: file }));
    return 'synced';
  } catch (err) {
    console.warn('[claude] could not sync the Claude Code login into the Keychain:', (err as Error).message);
    return 'unreadable';
  }
}

const account = () => process.env.USER || userInfo().username;

/** The real file and Keychain, through `security`. The value goes in on stdin as hex, so it never shows in `ps`. */
export const macLoginDeps: LoginSyncDeps = {
  readFile() {
    try {
      return readFileSync(join(homedir(), '.claude', '.credentials.json'), 'utf8');
    } catch {
      return null;
    }
  },
  readKeychain() {
    try {
      return execFileSync('security', ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-a', account(), '-w'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 5000,
      }).replace(/\n$/, '');
    } catch {
      return null;
    }
  },
  writeKeychain(value) {
    const hex = Buffer.from(value, 'utf8').toString('hex');
    const cmd = `add-generic-password -U -s "${KEYCHAIN_SERVICE}" -a "${account().replace(/["\\]/g, '')}" -X ${hex}\n`;
    const r = spawnSync('security', ['-i'], { input: cmd, encoding: 'utf8', stdio: ['pipe', 'ignore', 'pipe'], timeout: 5000 });
    if (r.status !== 0 || r.stderr?.trim()) throw new Error(r.stderr?.trim() || `security exited ${r.status}`);
  },
  now: () => Date.now(),
};

/** Runs the sync on a Mac unless OMNI_CLAUDE_LOGIN_SYNC=0 (tests and QA stacks, which must not touch the Keychain). */
export function syncClaudeLoginBeforeSpawn(env: NodeJS.ProcessEnv = process.env, platform = process.platform): void {
  if (platform !== 'darwin' || env.OMNI_CLAUDE_LOGIN_SYNC === '0') return;
  if (syncClaudeLogin(macLoginDeps) === 'synced') console.log('[claude] copied the newer Claude Code login from ~/.claude/.credentials.json into the Keychain');
}
