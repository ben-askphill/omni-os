import { join, resolve } from 'node:path';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { configPath, resolved } from './user-config.ts';

/** The repo root: data/, crew/, automations/ and mods/ live here, beside apps/ and packages/. */
export const ROOT = resolve(import.meta.dirname, '../..');

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
  /**
   * The workspace folder: cwd of non-repo threads, added to every Claude thread with its CLAUDE.md. From the user
   * config (data/omni.config.json, apps/server/user-config.ts), OMNI_BRAIN_DIR still wins. Read live, so onboarding
   * applies without a restart.
   */
  get brainDir() {
    return resolved.workspaceRoot();
  },
  claudeBin: env.OMNI_CLAUDE_BIN ?? 'claude',
  defaultModel: env.OMNI_DEFAULT_MODEL ?? 'claude-sonnet-5-5',
  permissionMode: env.OMNI_PERMISSION_MODE ?? 'bypassPermissions',
  maxConcurrent: Number(env.OMNI_MAX_CONCURRENT ?? 4),
  /** Per-harness concurrency caps. Claude Code uses OMNI_MAX_CONCURRENT. */
  maxConcurrentCodex: Number(env.OMNI_MAX_CONCURRENT_CODEX ?? 4),
  maxConcurrentCursor: Number(env.OMNI_MAX_CONCURRENT_CURSOR ?? 4),
  maxConcurrentHermes: Number(env.OMNI_MAX_CONCURRENT_HERMES ?? 4),
  codexBin: env.OMNI_CODEX_BIN,
  cursorBin: env.OMNI_CURSOR_BIN,
  /** Hermes API server on the server's Tailscale address, like http://100.x.y.z:8642. Unset means Hermes is off. The bearer token is the Keychain secret HERMES_API_KEY, not an env var. */
  get hermesUrl() {
    return resolved.hermesUrl();
  },
  /** How long a thread's claude process stays warm after a turn. 0 closes it right away. */
  keepAliveSeconds: Number(env.OMNI_KEEPALIVE_SECONDS ?? 600),
  /** How long an idle process stays up for background agents that have not ended yet. */
  taskKeepAliveSeconds: Number(env.OMNI_TASK_KEEPALIVE_SECONDS ?? 4 * 3600),
  /** After an interrupt, how long the turn gets to wind down before the process is killed. */
  interruptGraceMs: Number(env.OMNI_INTERRUPT_GRACE_MS ?? 8000),
  /** How long after a usage limit's reported reset a scheduled continuation runs, so the reset has landed. */
  limitGraceMs: Number(env.OMNI_LIMIT_GRACE_MS ?? 60_000),
  browser: (env.OMNI_BROWSER ?? '1') !== '0',
  /** Omni runs the channel's Chrome itself, so the thread panel can show it live. Off, Playwright MCP launches its own. */
  browserLive: (env.OMNI_BROWSER_LIVE ?? '1') !== '0',
  /** After a finished turn, ask Haiku for the user's likely next reply: the reply box's placeholder, Tab fills it in. */
  suggestions: (env.OMNI_SUGGESTIONS ?? '1') !== '0',
  /** Save a worktree thread's checkout before and after every turn, for its This turn diff (apps/server/turns.ts). */
  turnSnapshots: (env.OMNI_TURN_SNAPSHOTS ?? '1') !== '0',
  /** How long a turn's first message waits for the checkout to be saved before it goes without that snapshot. */
  turnSnapshotWaitMs: Number(env.OMNI_TURN_SNAPSHOT_WAIT_MS ?? 15_000),
  maxUploadMb: Number(env.OMNI_MAX_UPLOAD_MB ?? 25),
  /** Read Cursor's plan usage and thread costs from its dashboard (harness/cursor/dashboard.ts). Off in tests. */
  cursorDashboard: (env.OMNI_CURSOR_DASHBOARD ?? '1') !== '0',
  /** Load the repo's Claude Code mods (mods/) into every Claude thread with --plugin-dir. Off until '1'. */
  mods: env.OMNI_MODS === '1',
  /** The user's timezone (user config), OMNI_TZ still wins, else the system's. Automations default to it. */
  get timezone() {
    return resolved.timezone();
  },
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
  /** The user's own charters: a file here replaces the shared one in crew/ with the same name. Never in git. */
  personalCrew: join(DATA, 'crew'),
  /** OMNI_AUTOMATIONS_DIR lets tests toggle automations without rewriting the repo's own. */
  automations: env.OMNI_AUTOMATIONS_DIR ? resolve(ROOT, env.OMNI_AUTOMATIONS_DIR) : join(ROOT, 'automations'),
  /** The user's own automations, beside the shared ones in automations/. Same id here wins. */
  personalAutomations: join(DATA, 'automations'),
  /** Who the user is and where their work lives (apps/server/user-config.ts). */
  get userConfig() {
    return configPath();
  },
  webDist: env.OMNI_WEB_DIST ? resolve(ROOT, env.OMNI_WEB_DIST) : join(ROOT, 'apps', 'web', 'dist'),
  mcpOmni: join(ROOT, 'apps', 'mcp', 'omni.ts'),
  /** Claude Code mods (plugins of function hooks) Omni loads when config.mods is on. */
  mods: join(ROOT, 'mods'),
  modProgress: join(ROOT, 'mods', 'omni-progress'),
  tsx: join(ROOT, 'node_modules', '.bin', 'tsx'),
};

for (const p of [paths.data, paths.threads, paths.worktrees, paths.browsers]) mkdirSync(p, { recursive: true });

export const threadDir = (threadId: string) => join(paths.threads, threadId);
export const artifactsDir = (threadId: string) => join(paths.threads, threadId, 'artifacts');
/** The channel's design system, written here before each turn. Not in artifacts/, which Omni renders in the thread. */
export const designSystemFile = (threadId: string) => join(paths.threads, threadId, 'design-system.html');
export const browserOutDir = (threadId: string) => join(paths.threads, threadId, 'browser');
export const uploadsDir = (threadId: string) => join(paths.threads, threadId, 'uploads');
