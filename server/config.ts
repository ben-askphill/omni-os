import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';

export const ROOT = resolve(import.meta.dirname, '..');

// Minimal .env loader so the launchd service and `npm run dev` read the same config.
const envFile = join(ROOT, '.env');
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const env = process.env;

export const config = {
  port: Number(env.OMNI_PORT ?? 4747),
  host: env.OMNI_HOST ?? '127.0.0.1',
  brainDir: env.OMNI_BRAIN_DIR ?? join(homedir(), 'phillbert'),
  claudeBin: env.OMNI_CLAUDE_BIN ?? 'claude',
  defaultModel: env.OMNI_DEFAULT_MODEL ?? 'claude-opus-5-5',
  permissionMode: env.OMNI_PERMISSION_MODE ?? 'bypassPermissions',
  maxConcurrent: Number(env.OMNI_MAX_CONCURRENT ?? 4),
  /** Per-harness concurrency caps. Claude Code uses OMNI_MAX_CONCURRENT. */
  maxConcurrentCodex: Number(env.OMNI_MAX_CONCURRENT_CODEX ?? 4),
  maxConcurrentCursor: Number(env.OMNI_MAX_CONCURRENT_CURSOR ?? 4),
  maxConcurrentHermes: Number(env.OMNI_MAX_CONCURRENT_HERMES ?? 4),
  codexBin: env.OMNI_CODEX_BIN,
  cursorBin: env.OMNI_CURSOR_BIN,
  /** Hermes API server. The bearer token is the Keychain secret HERMES_API_KEY, not an env var. */
  hermesUrl: (env.OMNI_HERMES_URL ?? 'http://127.0.0.1:8642').replace(/\/$/, ''),
  /** How long a thread's claude process stays warm after a turn. 0 closes it right away. */
  keepAliveSeconds: Number(env.OMNI_KEEPALIVE_SECONDS ?? 600),
  /** After an interrupt, how long the turn gets to wind down before the process is killed. */
  interruptGraceMs: Number(env.OMNI_INTERRUPT_GRACE_MS ?? 8000),
  browser: (env.OMNI_BROWSER ?? '1') !== '0',
  maxUploadMb: Number(env.OMNI_MAX_UPLOAD_MB ?? 25),
  timezone: env.OMNI_TZ ?? 'Europe/Amsterdam',
};

// OMNI_DATA_DIR moves all runtime state, so tests can run against a temp dir.
const DATA = env.OMNI_DATA_DIR ? resolve(ROOT, env.OMNI_DATA_DIR) : join(ROOT, 'data');

export const paths = {
  data: DATA,
  db: join(DATA, 'omni.db'),
  threads: join(DATA, 'threads'),
  worktrees: join(DATA, 'worktrees'),
  browsers: join(DATA, 'browsers'),
  crew: join(ROOT, 'crew'),
  automations: join(ROOT, 'automations'),
  webDist: join(ROOT, 'web', 'dist'),
  mcpOmni: join(ROOT, 'mcp', 'omni.ts'),
  tsx: join(ROOT, 'node_modules', '.bin', 'tsx'),
};

for (const p of [paths.data, paths.threads, paths.worktrees, paths.browsers]) mkdirSync(p, { recursive: true });

export const threadDir = (threadId: string) => join(paths.threads, threadId);
export const artifactsDir = (threadId: string) => join(paths.threads, threadId, 'artifacts');
export const browserOutDir = (threadId: string) => join(paths.threads, threadId, 'browser');
export const uploadsDir = (threadId: string) => join(paths.threads, threadId, 'uploads');
