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
  /** Hermes API server on the server's Tailscale address. It is not public; the Mac must be on the tailnet. Override with OMNI_HERMES_URL. The bearer token is the Keychain secret HERMES_API_KEY, not an env var. */
  hermesUrl: (env.OMNI_HERMES_URL ?? 'http://100.110.128.38:8642').replace(/\/$/, ''),
  /** How long a thread's claude process stays warm after a turn. 0 closes it right away. */
  keepAliveSeconds: Number(env.OMNI_KEEPALIVE_SECONDS ?? 600),
  /** How long an idle process stays up for background agents that have not ended yet. */
  taskKeepAliveSeconds: Number(env.OMNI_TASK_KEEPALIVE_SECONDS ?? 4 * 3600),
  /** After an interrupt, how long the turn gets to wind down before the process is killed. */
  interruptGraceMs: Number(env.OMNI_INTERRUPT_GRACE_MS ?? 8000),
  browser: (env.OMNI_BROWSER ?? '1') !== '0',
  /** After a finished turn, ask Haiku for Ben's likely next reply: the reply box's placeholder, Tab fills it in. */
  suggestions: (env.OMNI_SUGGESTIONS ?? '1') !== '0',
  maxUploadMb: Number(env.OMNI_MAX_UPLOAD_MB ?? 25),
  timezone: env.OMNI_TZ ?? 'Europe/Amsterdam',
};

// OMNI_DATA_DIR moves all runtime state, so tests can run against a temp dir.
const DATA = env.OMNI_DATA_DIR ? resolve(ROOT, env.OMNI_DATA_DIR) : join(ROOT, 'data');

export const paths = {
  data: DATA,
  db: join(DATA, 'omni.db'),
  /** Holds the pid of the server running on this data dir. */
  lock: join(DATA, 'server.pid'),
  threads: join(DATA, 'threads'),
  worktrees: join(DATA, 'worktrees'),
  browsers: join(DATA, 'browsers'),
  crew: join(ROOT, 'crew'),
  /** OMNI_AUTOMATIONS_DIR lets tests toggle automations without rewriting the repo's own. */
  automations: env.OMNI_AUTOMATIONS_DIR ? resolve(ROOT, env.OMNI_AUTOMATIONS_DIR) : join(ROOT, 'automations'),
  webDist: env.OMNI_WEB_DIST ? resolve(ROOT, env.OMNI_WEB_DIST) : join(ROOT, 'web', 'dist'),
  mcpOmni: join(ROOT, 'mcp', 'omni.ts'),
  tsx: join(ROOT, 'node_modules', '.bin', 'tsx'),
};

for (const p of [paths.data, paths.threads, paths.worktrees, paths.browsers]) mkdirSync(p, { recursive: true });

export const threadDir = (threadId: string) => join(paths.threads, threadId);
export const artifactsDir = (threadId: string) => join(paths.threads, threadId, 'artifacts');
export const browserOutDir = (threadId: string) => join(paths.threads, threadId, 'browser');
export const uploadsDir = (threadId: string) => join(paths.threads, threadId, 'uploads');
