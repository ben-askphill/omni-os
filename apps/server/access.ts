// What a tool call may do at a channel's access level (packages/shared/access.ts): run, wait for a yes, or be refused.
// Pure, so every harness asks the same question: Claude Code for each can_use_tool request, Codex for each approval
// request (harness/*/adapter.ts). runner/approvals.ts turns an "ask" into an approval card and waits for the answer.
// ADR 0015.
import { lstatSync, realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import {
  connectorAccessOf,
  connectorIdOf,
  isAccessLevel,
  OMNI_SERVERS,
  serverOf,
  stricter,
  type AccessLevel,
  type ApprovalRequest,
  type ConnectorAccess,
  type ConnectorLevel,
} from '@omni/shared/access.ts';
import type { Channel } from './db.ts';
import { capabilitiesOf, harnessName } from './harness/registry.ts';
import { installDefault } from './access-default.ts';

/** The levels a thread runs at: its channel's (made no looser by its role's `access:`), and its connectors' own. */
export interface ChannelAccess {
  level: AccessLevel;
  connectors: ConnectorAccess;
}

/**
 * A channel's levels, made no looser than the role's own `access:` when the thread runs as one. A channel with no level
 * of its own runs at this machine's default (access-default.ts).
 */
export function channelAccess(ch: Pick<Channel, 'access_level' | 'connector_access'>, roleLevel?: string | null, fallback: AccessLevel = installDefault()): ChannelAccess {
  const own = isAccessLevel(ch.access_level) ? ch.access_level : fallback;
  const level = isAccessLevel(roleLevel) ? stricter(own, roleLevel) : own;
  const connectors = connectorAccessOf(ch.connector_access);
  // A role's level holds for its connectors too: none may be looser than it.
  if (level !== own) for (const [id, l] of Object.entries(connectors)) connectors[id] = l === 'off' ? 'off' : stricter(l, level);
  return { level, connectors };
}

/** Every tool runs: full access with no connector set below it. The harness then runs as it always did. */
export const unrestricted = (a: ChannelAccess) => a.level === 'full' && Object.values(a.connectors).every((l) => l === 'full');

/** A connector's level here: its own when the channel sets one, else the channel's. */
export const connectorLevel = (a: ChannelAccess, id: string): ConnectorLevel => a.connectors[id] ?? a.level;

/**
 * For a harness that cannot ask before each MCP call (Codex, Cursor): whether the browser stays out of its MCP config,
 * because the browser is below full access and nothing would stop a click or a form. Null access is full access.
 */
export const browserHeld = (a: ChannelAccess | null | undefined) => !!a && connectorLevel(a, 'browser') !== 'full';

/** One tool call as a harness reports it. `cwd` is the thread's folder; `threadDir` Omni's own folder for it. */
export interface ToolCall {
  tool: string;
  input: Record<string, unknown>;
  cwd: string;
  threadDir: string;
}

export type Verdict =
  | { decision: 'allow' }
  | { decision: 'deny'; reason: string }
  | { decision: 'ask'; request: ApprovalRequest };

/** Claude Code tools that only read, plan or start work whose own tool calls are checked one by one (Agent, Task). */
const READ_TOOLS = new Set([
  'Read', 'Grep', 'Glob', 'LS', 'NotebookRead', 'WebSearch', 'WebFetch', 'TodoWrite', 'TodoRead',
  'TaskCreate', 'TaskUpdate', 'TaskList', 'TaskGet', 'TaskOutput', 'TaskStop', 'BashOutput', 'KillShell', 'KillBash',
  'ToolSearch', 'Skill', 'ListMcpResourcesTool', 'ReadMcpResourceTool', 'ReadMcpResourceDirTool',
  'EnterPlanMode', 'ExitPlanMode', 'Agent', 'Task', 'LSP',
]);
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const SHELL_TOOLS = new Set(['Bash', 'PowerShell']);

/** Commands that only read, when nothing in the line redirects or substitutes. */
const SAFE_COMMANDS = new Set([
  'cd', 'ls', 'pwd', 'cat', 'head', 'tail', 'wc', 'grep', 'egrep', 'fgrep', 'rg', 'find', 'file', 'stat', 'du', 'df',
  'which', 'type', 'whoami', 'uname', 'date', 'echo', 'basename', 'dirname', 'realpath', 'sort', 'uniq', 'cut', 'jq', 'diff',
]);
const SAFE_GIT = new Set(['status', 'log', 'diff', 'show', 'rev-parse', 'ls-files', 'blame', 'describe', 'shortlog']);
/**
 * Arguments that turn a reading command into one that writes or runs something, per command. Short flags can come
 * bundled (`sort -uo out`), so those patterns match a flag cluster. Git's run external programs or set config.
 */
const UNSAFE_ARGS: Record<string, RegExp> = {
  find: /^-(exec|execdir|ok|okdir|delete|fprint.*|fls)$/,
  sort: /^-[^-]*o/,
  rg: /^-[^-]*z/,
  file: /^-[^-]*C/,
  date: /^-[^-]*s/,
  git: /^(-c|-o)$/,
};
/** Long options that write or run something. GNU tools and git take any unambiguous prefix (`--comp=sh`), so a prefix counts. */
const UNSAFE_LONG: Record<string, string[]> = {
  sort: ['--output', '--compress-program'],
  // --pre and --hostname-bin run a program; --search-zip runs decompressors.
  rg: ['--pre', '--hostname-bin', '--search-zip'],
  file: ['--compile'],
  date: ['--set'],
  git: ['--config-env', '--exec-path', '--ext-diff', '--textconv', '--output'],
  diff: ['--output'],
};
const unsafeArg = (cmd: string, arg: string) => {
  const a = arg.replace(/['"]/g, '');
  if (UNSAFE_ARGS[cmd]?.test(a)) return true;
  if (!a.startsWith('--')) return false;
  const name = a.split('=')[0];
  return (UNSAFE_LONG[cmd] ?? []).some((o) => (name.length >= 3 && o.startsWith(name)) || name.startsWith(o));
};

/**
 * Whether a shell line only reads: each part of a `&&`, `||`, `;` or `|` chain is a known reading command, and nothing
 * redirects into a file, substitutes, expands a variable, starts a subshell or runs in the background. Anything else
 * may change something, so it counts as an action. It errs on the side of asking.
 */
export function readOnlyCommand(command: string): boolean {
  const line = command.replace(/\s\d?>\s*\/dev\/null/g, ' ').replace(/\s2>&1/g, ' ').trim();
  // Inside single quotes the shell expands nothing, so `rg 'foo$'` still reads. Everything else is checked as written.
  // Not when the line has a double quote too: `"'"$(x)"'"` would read as single-quoted. Then every $ asks.
  const bare = line.includes('"') ? line : line.replace(/'[^'\n]*'/g, "''");
  if (!line || /[<>`\n\r]/.test(bare)) return false;
  // A lone & (background), a subshell or group, an escape or any $ expansion can hide a second command.
  if (/[&(){}$\\]/.test(bare.replace(/&&|\|\|/g, ' '))) return false;
  return line.split(/&&|\|\||;|\|/).every((part) => {
    const words = part.trim().split(/\s+/).filter(Boolean);
    const [cmd, ...args] = words;
    if (!cmd || (!SAFE_COMMANDS.has(cmd) && cmd !== 'git')) return false;
    // Quotes do not change what a flag does: `find . '-delete'` deletes.
    if (args.some((a) => unsafeArg(cmd, a))) return false;
    if (cmd === 'git') return SAFE_GIT.has(args.find((a) => !a.startsWith('-'))?.replace(/['"]/g, '') ?? '');
    return true;
  });
}

/** The words of a tool name: `browser_take_screenshot`, `notion-search` and `getMessage` all split. */
const nameWords = (s: string) => s.split(/[_\-.\s]+|(?<=[a-z])(?=[A-Z])/).map((w) => w.toLowerCase()).filter(Boolean);

/** First words that only look: a connector tool that starts with one reads; any other may send, change or delete. */
const READ_VERBS = new Set([
  'get', 'list', 'search', 'read', 'fetch', 'query', 'find', 'view', 'show', 'describe', 'check', 'inspect', 'lookup', 'count',
  'snapshot', 'take', 'navigate', 'wait', 'tabs', 'console', 'network', 'resize', 'hover', 'emulate', 'status', 'analyze',
  'compare', 'explain', 'summarize', 'whoami', 'preview',
]);

/** Whether a connector tool only reads, from its name: the server's own words (notion, browser) are skipped first. */
export function readOnlyConnectorTool(server: string, tool: string): boolean {
  const skip = new Set([...nameWords(server), 'browser', 'mcp', 'claude', 'ai']);
  const words = nameWords(tool);
  while (words.length > 1 && skip.has(words[0])) words.shift();
  return READ_VERBS.has(words[0] ?? '');
}

/**
 * A path with its symlinks resolved, as far as it exists: a link inside the folder can point out of it. Null when a
 * part of it is a link that does not resolve (dangling, or a loop): the caller then treats it as outside and asks.
 */
function real(path: string): string | null {
  const abs = resolve(path);
  try {
    return realpathSync(abs);
  } catch {
    try {
      if (lstatSync(abs).isSymbolicLink()) return null;
    } catch {
      // Not there at all: resolve its parent and append the name.
    }
    const parent = dirname(abs);
    if (parent === abs) return abs;
    const up = real(parent);
    return up === null ? null : join(up, basename(abs));
  }
}

/** A path segment as a case-insensitive, normalising disk may store it: `.GIT`, `.git.`, `.g\u200bit` are `.git`. */
const segment = (p: string) => p.normalize('NFKC').replace(/\p{Default_Ignorable_Code_Point}/gu, '').replace(/[. ]+$/, (m) => (m === p ? m : '')).toLowerCase();

const inside = (dir: string, path: string) => {
  const from = real(dir);
  const to = real(resolve(dir, path));
  if (from === null || to === null) return false;
  const rel = relative(from, to);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
};

/**
 * Files a tool runs code from or reads its settings from: git's config and hooks, the harnesses' own settings (a
 * Claude Code hook runs a command), editor tasks, direnv. An edit to one waits for a yes even inside the thread's folder.
 */
const CONFIG_DIRS = new Set(['.git', '.claude', '.codex', '.cursor', '.agents', '.husky', '.githooks', '.vscode', '.idea']);
const CONFIG_FILES = new Set(['.mcp.json', '.gitattributes', '.gitmodules', '.envrc']);
const toolConfig = (dir: string, path: string) => {
  // Lowercased: on a case-insensitive disk `.GIT/hooks` is `.git/hooks`.
  const from = real(dir);
  const to = real(resolve(dir, path));
  if (from === null || to === null) return true;
  const parts = relative(from, to).split(/[\\/]/).map(segment);
  return parts.some((p) => CONFIG_DIRS.has(p)) || CONFIG_FILES.has(parts.at(-1) ?? '');
};

const text = (v: unknown) => (typeof v === 'string' ? v : '');
const oneLine = (s: string, max = 160) => {
  const first = s.trim().split('\n')[0];
  return first.length > max || s.trim().includes('\n') ? `${first.slice(0, max - 1).trimEnd()}…` : first;
};

/** What the agent hears when a call is refused: what was stopped, and that asking for it another way is pointless. */
const refusedAt = (level: ConnectorLevel, what: string) =>
  level === 'read' || level === 'off'
    ? `Omni refused this: the channel is read only, so ${what} is not allowed. Do not try another way; say what you would have done instead.`
    : `Omni refused this: ${what} needs the user's yes in this channel.`;

/**
 * The verdict on one call. Reads always run. Omni's own tools always run (they check themselves). Writes into Omni's
 * folder for the thread (its artifacts) always run: they change nothing of the user's. The rest follows the level:
 * the connector's own when the channel sets one, else the channel's.
 */
export function judge(access: ChannelAccess, call: ToolCall): Verdict {
  const { tool, input } = call;
  const server = serverOf(tool);
  if (server) {
    if (OMNI_SERVERS.has(server)) return { decision: 'allow' };
    const id = connectorIdOf(server);
    const level = id ? connectorLevel(access, id) : access.level;
    if (level === 'off') return { decision: 'deny', reason: `Omni refused this: ${id} is off in this channel, so its tools cannot be used. Do not try another way; say what you would have done instead.` };
    if (readOnlyConnectorTool(server, tool.slice(`mcp__${server}__`.length))) return { decision: 'allow' };
    const request: ApprovalRequest = { tool, connector: id ?? server, level, summary: oneLine(JSON.stringify(input) ?? '{}'), detail: JSON.stringify(input, null, 2) };
    return verdictAt(level, request, 'this account action');
  }
  if (READ_TOOLS.has(tool)) return { decision: 'allow' };
  if (EDIT_TOOLS.has(tool)) {
    const path = text(input.file_path) || text(input.notebook_path) || text(input.path);
    // A relative path is the harness's working folder's, never Omni's thread folder.
    const abs = path && resolve(call.cwd, path);
    if (abs && inside(call.threadDir, abs) && !toolConfig(call.threadDir, abs)) return { decision: 'allow' };
    const request: ApprovalRequest = { tool, level: access.level, summary: path || tool, detail: text(input.content) || text(input.new_string) || undefined };
    if (access.level === 'ask' && abs && inside(call.cwd, abs) && !toolConfig(call.cwd, abs)) return { decision: 'allow' };
    return verdictAt(access.level, request, 'changing files');
  }
  if (SHELL_TOOLS.has(tool) || tool === 'command') {
    const command = text(input.command);
    if (readOnlyCommand(command)) return { decision: 'allow' };
    return verdictAt(access.level, { tool, level: access.level, summary: oneLine(command || tool), detail: command || undefined }, 'a command that may change things');
  }
  if (tool === 'file change') {
    return verdictAt(access.level, { tool, level: access.level, summary: text(input.summary) || 'Change files', detail: text(input.detail) || undefined }, 'changing files');
  }
  // A tool this list does not know: it may change something, so it is treated like one that does.
  return verdictAt(access.level, { tool, level: access.level, summary: oneLine(JSON.stringify(input) ?? tool), detail: JSON.stringify(input, null, 2) }, `the ${tool} tool`);
}

function verdictAt(level: ConnectorLevel, request: ApprovalRequest, what: string): Verdict {
  if (level === 'full') return { decision: 'allow' };
  if (level === 'ask') return { decision: 'ask', request };
  return { decision: 'deny', reason: refusedAt(level, what) };
}

// ---------- the harnesses' own settings ----------

/**
 * What Codex runs with at a level (harness/codex/session-start.ts). Read only: its sandbox refuses every write and it
 * never asks. Ask first: it writes in the thread's folder and asks for the rest, each request judged here. Full: as
 * before levels.
 */
export function codexPolicy(a: ChannelAccess): { approvalPolicy: 'never' | 'untrusted'; sandbox: 'read-only' | 'workspace-write' | 'danger-full-access' } {
  if (a.level === 'read') return { approvalPolicy: 'never', sandbox: 'read-only' };
  if (a.level === 'ask') return { approvalPolicy: 'untrusted', sandbox: 'workspace-write' };
  return { approvalPolicy: 'never', sandbox: 'danger-full-access' };
}

/**
 * Why a harness cannot run in a channel at this level, or null when it can. A harness without `toolLimits` (Hermes,
 * Cursor Cloud, a custom harness) runs off this machine with tools Omni never sees, so it cannot be held to a level
 * below full access. An id that names no harness here is refused as well.
 */
export function harnessRefusal(harness: string, a: ChannelAccess): string | null {
  if (unrestricted(a) || capabilitiesOf(harness)?.toolLimits) return null;
  return `${harnessName(harness)} runs off this machine, so Omni cannot hold it to this channel's access level. Pick Claude Code, Codex or Cursor Agent, or set the channel to Full access.`;
}

/** The key "Allow in this thread" and "Always allow for <role>" remember: the tool, so later calls of it run without asking. */
export const grantKey = (r: Pick<ApprovalRequest, 'tool'>) => r.tool;
