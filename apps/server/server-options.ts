// The .env options Settings shows read-only (GET /api/setup/server), each with its value and whether .env or the
// environment set it. Only options a person tunes: test hooks (fake API URLs, poll and wait times) stay out, and so
// does anything secret. The server reads them once at start, so a change needs a restart; Settings says so.
import type { ServerOption } from '@omni/shared/settings.ts';
import { config } from './config.ts';

const onOff = (v: boolean) => (v ? 'On' : 'Off');
const seconds = (n: number) => `${n} s`;
const ms = (n: number) => (n % 1000 === 0 ? `${n / 1000} s` : `${n} ms`);

type Row = Omit<ServerOption, 'source'>;

function rows(): Row[] {
  return [
    // Harnesses & models
    { env: 'OMNI_DEFAULT_MODEL', section: 'models', label: 'Claude Code model when nothing picks one', hint: 'Used when the thread, its crew role and its channel name no Claude model.', value: config.defaultModel, default: 'claude-sonnet-5-5' },
    { env: 'OMNI_PERMISSION_MODE', section: 'models', label: 'Claude Code permission mode', hint: 'Headless runs cannot answer prompts, so the default skips them.', value: config.permissionMode, default: 'bypassPermissions' },
    { env: 'OMNI_CLAUDE_BIN', section: 'models', label: 'Claude Code binary', hint: 'The claude CLI Omni starts.', value: config.claudeBin, default: 'claude' },
    { env: 'OMNI_MAX_CONCURRENT', section: 'models', label: 'Claude Code turns at once', hint: 'Turns running at once. Warm idle sessions do not count.', value: String(config.maxConcurrent), default: '12' },
    { env: 'OMNI_MAX_CONCURRENT_CODEX', section: 'models', label: 'Codex turns at once', hint: 'Codex turns running at once.', value: String(config.maxConcurrentCodex), default: '12' },
    { env: 'OMNI_MAX_CONCURRENT_CURSOR', section: 'models', label: 'Cursor Agent turns at once', hint: 'Cursor Agent turns running at once.', value: String(config.maxConcurrentCursor), default: '12' },
    { env: 'OMNI_MAX_CONCURRENT_HERMES', section: 'models', label: 'Hermes runs at once', hint: 'Hermes also has its own cap on its server.', value: String(config.maxConcurrentHermes), default: '12' },
    { env: 'OMNI_MAX_CONCURRENT_CURSOR_CLOUD', section: 'models', label: 'Cursor Cloud runs at once', hint: 'Cursor Cloud agents running at once.', value: String(config.maxConcurrentCursorCloud), default: '12' },
    { env: 'OMNI_CURSOR_DASHBOARD', section: 'models', label: 'Cursor usage from its dashboard', hint: 'Reads Cursor plan usage and thread costs.', value: onOff(config.cursorDashboard), default: 'On' },
    // Threads
    { env: 'OMNI_KEEPALIVE_SECONDS', section: 'threads', label: 'Keep a session warm after a turn', hint: 'A warm session answers a follow-up faster. 0 closes it at once.', value: seconds(config.keepAliveSeconds), default: '600 s' },
    { env: 'OMNI_TASK_KEEPALIVE_SECONDS', section: 'threads', label: 'Keep it up for background agents', hint: 'How long an idle session stays up while its background agents still run.', value: seconds(config.taskKeepAliveSeconds), default: '14400 s' },
    { env: 'OMNI_INTERRUPT_GRACE_MS', section: 'threads', label: 'Stop grace', hint: 'After Stop, how long the turn gets to wind down before its process is killed.', value: ms(config.interruptGraceMs), default: '8 s' },
    { env: 'OMNI_LIMIT_GRACE_MS', section: 'threads', label: 'Wait after a usage limit resets', hint: 'A thread set to continue after a usage limit starts this long after the reported reset, so the reset has landed.', value: ms(config.limitGraceMs), default: '60 s' },
    { env: 'OMNI_SUGGESTIONS', section: 'threads', label: 'Reply suggestions', hint: 'After a turn, Haiku suggests your next reply. Tab fills it in.', value: onOff(config.suggestions), default: 'On' },
    { env: 'OMNI_TURN_SNAPSHOTS', section: 'threads', label: 'Turn snapshots', hint: 'Saves a worktree before and after each turn, for the This turn diff.', value: onOff(config.turnSnapshots), default: 'On' },
    { env: 'OMNI_BROWSER', section: 'threads', label: 'Agent browser', hint: 'Gives each thread a Playwright browser.', value: onOff(config.browser), default: 'On' },
    { env: 'OMNI_BROWSER_LIVE', section: 'threads', label: 'Live browser panel', hint: "Omni runs the channel's Chrome itself, so the thread panel shows it live.", value: onOff(config.browserLive), default: 'On' },
    { env: 'OMNI_MAX_UPLOAD_MB', section: 'threads', label: 'Upload size cap', hint: 'Per file the composer attaches.', value: `${config.maxUploadMb} MB`, default: '25 MB' },
    { env: 'OMNI_MODS', section: 'threads', label: 'Mods', hint: "Loads the repo's Claude Code mods into Claude threads.", value: onOff(config.mods), default: 'Off' },
    { env: 'OMNI_AUTOMATION_POLL_SECONDS', section: 'threads', label: 'Automation GitHub poll', hint: 'How often event automations check GitHub. 15 s at least.', value: seconds(config.automationPollSeconds), default: '120 s' },
    // Worktrees
    { env: 'OMNI_WORKTREE_IDLE_DAYS', section: 'worktrees', label: 'Idle days before a merged worktree is eligible', hint: 'For the storage scan. Automatic cleanup has its own days above.', value: `${config.worktreeIdleDays} days`, default: '7 days' },
    // Machines
    { env: 'OMNI_PORT', section: 'machines', label: 'Port', hint: 'Where the server listens.', value: String(config.port), default: '4747' },
    { env: 'OMNI_HOST', section: 'machines', label: 'Host', hint: 'The address it binds. 127.0.0.1 keeps it on this machine.', value: config.host, default: '127.0.0.1' },
  ];
}

export function serverOptions(env: NodeJS.ProcessEnv = process.env): ServerOption[] {
  return rows().map((r) => ({ ...r, source: env[r.env] !== undefined && env[r.env] !== '' ? 'env' : 'default' }));
}
