import { execFile } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { chromeBinary } from './browser-page.ts';
import { userName } from './user-config.ts';
import { fillWorktree, type WorktreeExtras } from './worktree-include.ts';
import { RENDER_SERVER } from '@omni/shared/html-render.ts';
import { STEPS_SERVER } from '@omni/shared/steps.ts';
import { CONDUCTOR_CHANNEL } from '@omni/shared/channel-icon.ts';
import { config, paths, threadDir, threadTokenPath, artifactsDir, browserOutDir, designSystemFile, nodeChildEnv } from './config.ts';
import { nativeMcpCommand, type NativeMcpServer } from './native-mcp.ts';
import { lazyCommand, prepareLazy } from './lazy-mcp.ts';
import { CURSOR_PLUGIN_FOLDER } from './harness/cursor/normalize.ts';
import type { Channel, ThreadWorkspace } from './db.ts';
import type { CrewRole } from './crew.ts';

const run = promisify(execFile);

export interface Workdir {
  cwd: string;
  branch: string | null;
}

async function isGitRepo(dir: string) {
  try {
    await run('git', ['-C', dir, 'rev-parse', '--is-inside-work-tree']);
    return true;
  } catch {
    return false;
  }
}

/**
 * A thread that must run in a worktree of its own: a repo channel with worktrees on, for a harness on this Mac. A
 * quick ask's `none` or `read` workspace never needs one (apps/server/quick-ask.ts).
 */
export function needsWorktree(channel: Channel, opts?: { remote?: boolean; workspace?: ThreadWorkspace | null }) {
  if (opts?.workspace === 'none' || opts?.workspace === 'read') return false;
  return !opts?.remote && !!channel.repo_path && !!channel.use_worktree;
}

/** Where a thread's worktree goes and the branch it is cut on. Fixed per thread, so a retry finds the same ones. */
export function plannedWorktree(threadId: string): { cwd: string; branch: string } {
  return { cwd: join(paths.worktrees, threadId), branch: `omni/${threadId.slice(0, 8)}` };
}

/** The files Claude Code and Cursor Agent read as project rules from the cwd and every folder above it, and Codex from the repo root down. */
const RULE_FILES = ['CLAUDE.md', 'CLAUDE.local.md', 'AGENTS.md'];

/** The first rules file in dir or a folder above it, or null when none of them holds one. */
export function rulesFileAbove(dir: string): string | null {
  for (let at = resolve(dir); ; at = dirname(at)) {
    for (const name of RULE_FILES) if (existsSync(join(at, name))) return join(at, name);
    if (dirname(at) === at) return null;
  }
}

/**
 * A #conductor thread's folder: one with no CLAUDE.md or AGENTS.md in it or above it, so no harness loads project
 * rules into a thread that only routes work (#1013). Cursor Agent reads them from its cwd up to / whatever the git root,
 * with no flag or setting to stop it (checked against cursor-agent 2026.11.22), so the workspace's own were in every
 * Cursor routing turn. The thread's folder when nothing above it holds one. A data folder inside a checkout (a dev
 * install's data/) has the checkout's above it, so the thread then runs in a folder of its own under ~/.cache.
 */
export function conductorWorkdir(threadId: string, spare = join(homedir(), '.cache', 'omni-os', 'conductor', threadId)): string {
  const own = threadDir(threadId);
  if (!rulesFileAbove(own) || rulesFileAbove(spare)) return own;
  mkdirSync(spare, { recursive: true });
  return spare;
}

/**
 * Where a thread's agent runs, for a thread that needs no worktree (needsWorktree is false):
 * - Hermes or Cursor Cloud: the thread's own data folder; it runs off this Mac
 * - #conductor, unless a quick ask: conductorWorkdir, never the workspace
 * - repo channel, worktrees off: the repo itself
 * - otherwise: the channel's base dir, falling back to the brain (phillbert) so skills and context load
 * A worktree thread gets plannedWorktree's folder, which prepareWorktree makes before anything runs there.
 */
export async function prepareWorkdir(channel: Channel, threadId: string, opts?: { remote?: boolean; quick?: boolean }): Promise<Workdir> {
  mkdirSync(artifactsDir(threadId), { recursive: true });
  mkdirSync(browserOutDir(threadId), { recursive: true });

  // Hermes and Cursor Cloud run off this Mac. A worktree here would pin a branch nothing on this Mac commits to.
  if (opts?.remote) return { cwd: threadDir(threadId), branch: null };
  // A quick ask only reads, so it reads the channel's own folder and never gets a worktree.
  if (needsWorktree(channel, { workspace: opts?.quick ? 'read' : null })) return plannedWorktree(threadId);
  // A quick ask still reads the workspace: that is what it is for.
  if (channel.id === CONDUCTOR_CHANNEL && !opts?.quick) return { cwd: conductorWorkdir(threadId), branch: null };

  // #conductor threads run in their thread folder, not the workspace or a repo root, so Cursor does not load the
  // workspace CLAUDE.md from an ancestor (docs/reviews/2026-11-22-cursor-cli-capabilities.md).
  if (channel.id === 'conductor' && !needsWorktree(channel, opts)) return { cwd: threadDir(threadId), branch: null };

  if (channel.repo_path && existsSync(channel.repo_path)) return { cwd: channel.repo_path, branch: null };
  if (channel.base_dir && existsSync(channel.base_dir)) return { cwd: channel.base_dir, branch: null };
  if (existsSync(config.brainDir)) return { cwd: config.brainDir, branch: null };
  return { cwd: threadDir(threadId), branch: null };
}

const real = (p: string) => {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
};

/** Why a folder is not a usable worktree. `branch` is the one fault prepareWorktree can mend on its own. */
export type WorktreeProblem =
  | { kind: 'missing' | 'own-checkout' | 'not-worktree' | 'other-repo'; message: string }
  /** A worktree of this repo on another branch, or on a detached HEAD when `on` is null. */
  | { kind: 'branch'; on: string | null; message: string };

/**
 * Why dir is not a usable worktree of repo checked out on branch, or null when it is. Never the repo itself or the
 * brain: a harness started there would work on Ben's own checkout.
 */
export async function checkWorktree(repo: string, dir: string, branch: string): Promise<WorktreeProblem | null> {
  if (!existsSync(dir)) return { kind: 'missing', message: `The worktree ${dir} does not exist.` };
  const at = real(dir);
  if (at === real(repo) || at === real(config.brainDir)) return { kind: 'own-checkout', message: `${dir} is the channel's own checkout, not a worktree.` };
  const git = (...args: string[]) => run('git', ['-C', dir, ...args], { timeout: 30_000 }).then((r) => r.stdout.trim(), () => null);
  const top = await git('rev-parse', '--show-toplevel');
  if (!top || real(top) !== at) return { kind: 'not-worktree', message: `${dir} is not a git worktree.` };
  const common = await git('rev-parse', '--path-format=absolute', '--git-common-dir');
  const repoCommon = await run('git', ['-C', repo, 'rev-parse', '--path-format=absolute', '--git-common-dir']).then((r) => r.stdout.trim(), () => null);
  if (!common || !repoCommon || real(common) !== real(repoCommon)) return { kind: 'other-repo', message: `${dir} is not a worktree of ${repo}.` };
  const on = (await git('branch', '--show-current')) || null;
  if (on !== branch) return { kind: 'branch', on, message: `${dir} is on ${on ? `branch ${on}` : 'a detached HEAD'}, not ${branch}.` };
  return null;
}

/** checkWorktree's reason as text, for a caller that only shows it. */
export async function worktreeProblem(repo: string, dir: string, branch: string): Promise<string | null> {
  return (await checkWorktree(repo, dir, branch))?.message ?? null;
}

/** How many changed files a dirty-worktree error lists before it says "and N more". */
const LISTED_CHANGES = 10;

/**
 * Put this thread's worktree back on its branch after its agent checked out another one (or detached HEAD). Only a
 * clean tree is switched; a dirty one is left exactly as it is and the error says how to fix it by hand.
 */
async function switchBack(dir: string, branch: string, on: string | null): Promise<void> {
  const git = (...args: string[]) => run('git', ['-C', dir, ...args], { timeout: 60_000, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
  const where = on ? `branch ${on}` : 'a detached HEAD';
  let status: string;
  try {
    status = (await git('status', '--porcelain', '--untracked-files=all')).stdout;
  } catch (err) {
    throw new Error(`${dir} is on ${where}, not ${branch}, and git status failed: ${gitMessage(err)}`);
  }
  const changed = status.split('\n').filter((l) => l.trim()).map((l) => l.slice(3));
  if (changed.length) {
    const listed = changed.slice(0, LISTED_CHANGES).join(', ');
    const more = changed.length > LISTED_CHANGES ? ` and ${changed.length - LISTED_CHANGES} more` : '';
    throw new Error(
      `${dir} is on ${where}, not ${branch}, and has uncommitted changes, so Omni left it alone. ` +
        `Changed: ${listed}${more}. To fix: commit or stash them, then run \`git -C ${dir} checkout ${branch}\` and retry.`,
    );
  }
  const hasBranch = await git('rev-parse', '--verify', '--quiet', `refs/heads/${branch}`).then(() => true, () => false);
  try {
    await git('checkout', '-q', ...(hasBranch ? [branch] : ['-b', branch]));
  } catch (err) {
    throw new Error(`${dir} is on ${where}, not ${branch}, and switching back failed: ${gitMessage(err)}`);
  }
  console.log(`[setup] ${dir}: switched back to ${branch} from ${where}`);
}

/**
 * Make a thread's worktree at dir on branch and check it, or throw saying why. Safe to run again: a worktree an
 * earlier try made is checked and kept, a branch it made is checked out again, a clean worktree its agent moved to
 * another branch is switched back, and a folder that is in the way is never deleted. A new branch is cut from the
 * commit `base` names (worktree-base.ts), asked only once the repo and folder checks pass, or from HEAD without one.
 * A worktree made here gets the repo's `.worktreeinclude` files and the channel's own (`extras`) copied in, and the
 * channel's shared folders linked (worktree-include.ts).
 */
export async function prepareWorktree(repo: string | null, dir: string, branch: string, base?: () => Promise<string>, extras?: WorktreeExtras): Promise<void> {
  if (!repo) throw new Error('The channel has no repository set.');
  if (!existsSync(repo)) throw new Error(`The channel's repository is not on this machine: ${repo}`);
  if (!(await isGitRepo(repo))) throw new Error(`${repo} is not a git repository. Turn off "Worktree per thread" in the channel's settings to run threads in it directly.`);
  const found = await checkWorktree(repo, dir, branch);
  if (!found) return;
  // The thread's own agent checked out another branch in its worktree: switch back when nothing can be lost.
  if (found.kind === 'branch') {
    await switchBack(dir, branch, found.on);
    const problem = await worktreeProblem(repo, dir, branch);
    if (problem) throw new Error(problem);
    return;
  }
  // Never wait on a credential prompt or a pager.
  const git = (...args: string[]) => run('git', ['-C', repo, ...args], { timeout: 60_000, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
  if (existsSync(dir) && readdirSync(dir).length) throw new Error(`${dir} is in the way: it is not this thread's worktree on ${branch}. Move it, then retry.`);
  // A worktree removed by hand is still registered until pruned, and add refuses its path.
  await git('worktree', 'prune').catch(() => {});
  const hasBranch = await git('rev-parse', '--verify', '--quiet', `refs/heads/${branch}`).then(() => true, () => false);
  const from = hasBranch || !base ? 'HEAD' : await base();
  try {
    await git('worktree', 'add', ...(hasBranch ? [dir, branch] : ['-b', branch, dir, from]));
  } catch (err) {
    throw new Error(`git worktree add failed: ${gitMessage(err)}`);
  }
  const problem = await worktreeProblem(repo, dir, branch);
  if (problem) {
    // Made just now and not usable: take it out again, so a retry starts clean. The branch stays for it.
    await removeWorktree(repo, dir);
    throw new Error(problem);
  }
  await fillWorktree(repo, dir, extras);
}

/** The part of a git failure worth showing: its stderr, without the hint lines. */
function gitMessage(err: unknown): string {
  const e = err as { stderr?: string; message?: string; killed?: boolean; signal?: string | null };
  if (e.killed) return 'it took longer than a minute and was stopped (a slow checkout or a hook that hangs).';
  const lines = (e.stderr || e.message || String(err)).split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('hint:'));
  return lines.slice(-3).join(' ') || 'unknown error';
}

/**
 * The folder a channel's new threads read their command list from: the repo (a worktree is cut
 * from it, so it has the same commands), then the base dir, then the brain.
 */
export function commandsFolder(channel: Channel): string | null {
  for (const dir of [channel.repo_path, channel.base_dir, config.brainDir]) if (dir && existsSync(dir)) return dir;
  return null;
}

export interface McpInput {
  threadId: string;
  channel: Channel;
  role?: CrewRole;
  /** Another thread in this channel already holds the persistent browser profile. */
  browserBusy: boolean;
  /** The channel browser Omni runs, when it is up. The MCP attaches to it instead of launching its own. */
  cdpEndpoint?: string | null;
  omniUrl: string;
  /**
   * Leave the browser out: the harness cannot ask before each MCP call (Codex, Cursor) and the browser is below full
   * access here, so nothing would stop a click or a form (access.ts browserHeld). Claude Code asks per call, so it keeps it.
   */
  noBrowser?: boolean;
  /**
   * A thread that only reads (readsOnly): a quick ask, or one kept as a thread from it. No browser, since browsing is
   * what turns it into a task, and no html_render, since its prompt answers in text (runner/prompts.ts replyLines).
   */
  quick?: boolean;
  /** The lead of a team thread (runner/team.ts): it gets message_members. */
  leadsTeam?: boolean;
}

let playwrightMcp: { bin: string; version: string } | undefined;

function playwrightMcpPackage() {
  if (!playwrightMcp) {
    const pkg = createRequire(import.meta.url).resolve('@playwright/mcp/package.json');
    const { bin, version } = JSON.parse(readFileSync(pkg, 'utf8')) as { bin: string | Record<string, string>; version: string };
    playwrightMcp = { bin: join(dirname(pkg), typeof bin === 'string' ? bin : bin['playwright-mcp']), version };
  }
  return playwrightMcp;
}

/**
 * The browser MCP's entry script, from the exact @playwright/mcp version pinned in apps/server/package.json.
 * Run from Omni's own install so no registry, `latest` tag or repo .npmrc decides what code gets the browser profile.
 */
export function playwrightMcpBin() {
  return playwrightMcpPackage().bin;
}

/** The name the browser MCP's record is kept under (lazy-mcp.ts). */
const BROWSER_MCP = 'playwright-mcp';

/**
 * Lets the browser MCP start at a thread's first browser call (lazy-mcp.ts). Run once at server start. The flags it
 * is asked with open no browser and change none of its answers: the handshake is the same with every set
 * buildMcpConfig passes.
 */
export async function prepareBrowserMcp(): Promise<void> {
  if (!config.browser || !config.browserLazy) return;
  const { bin, version } = playwrightMcpPackage();
  await prepareLazy({ name: BROWSER_MCP, version, probe: { command: process.execPath, args: [bin, '--headless', '--isolated'], env: nodeChildEnv } });
}

/** The server with ask_user_question (crates/omni-mcp). Harnesses name its tool `mcp__omni-ask__ask_user_question`. */
export const ASK_SERVER = 'omni-ask';
/** The server with read_referenced_thread alone (crates/omni-mcp), for threads that do not get `omni`, which has it too. */
export const THREADS_SERVER = 'omni-threads';
/** The server with `remember` (crates/omni-mcp), for a crew role whose threads may propose lessons. The Conductor has it on `omni`. */
export const MEMORY_SERVER = 'omni-memory';
/** The server with `message_members` (crates/omni-mcp), for a team thread's lead alone (runner/team.ts). */
export const TEAM_SERVER = 'omni-team';
/** How long a harness lets an ask_user_question call wait for the user: a day. */
export const ASK_TIMEOUT_SEC = 86_400;
/** How long ask_user_question waits on Cursor Agent, inside the 60 seconds its print mode allows any MCP call. */
export const CURSOR_ASK_WAIT_SEC = 45;
/**
 * How long ask_user_question waits on Antigravity: agy ends any MCP call after 3 minutes (measured on agy 1.5.16: a call of
 * 130 s returned, one of 330 s and one of 700 s failed at "timed out after 3m0s"), so it waits less and hands the question back.
 */
export const ANTIGRAVITY_ASK_WAIT_SEC = 150;

/** One server entry. `timeout` (ms) is Claude Code's, written only into its own config file (writeMcpConfig). */
interface McpServer {
  command: string;
  args: string[];
  env?: Record<string, string>;
  timeout?: number;
}

/** Per-thread MCP servers, layered on top of the user's normal Claude Code MCP config. Hermes gets none: it runs elsewhere. */
export function buildMcpConfig(input: McpInput) {
  const servers: Record<string, McpServer> = {};
  const api = { OMNI_URL: input.omniUrl, OMNI_TOKEN_FILE: threadTokenPath(input.threadId), OMNI_THREAD_ID: input.threadId, OMNI_USER: userName(), ...nodeChildEnv };

  // ask, render, steps, threads, memory and team run on omni-mcp (native-mcp.ts). An install without a binary that starts leaves them out.
  const helper = (key: string, name: NativeMcpServer): void => {
    const command = nativeMcpCommand(name);
    if (command) servers[key] = { ...command, env: api };
  };

  helper(ASK_SERVER, 'ask');
  // html_render: a quick ask's answer shows in place as text, and a thread kept from one answers in text too.
  if (!input.quick) helper(RENDER_SERVER, 'render');
  // set_steps: the plain step list the thread shows as its progress (@omni/shared/steps.ts).
  helper(STEPS_SERVER, 'steps');
  // message_members: a team thread's lead gives its members their parts. A member's session is a thread of its own, with no team row.
  if (input.leadsTeam && !input.quick) helper(TEAM_SERVER, 'team');

  // A delegate-only role hands browser work to a crewmate, so it gets no browser to be tempted by.
  if (config.browser && !input.role?.delegateOnly && !input.noBrowser && !input.quick) {
    const args = [playwrightMcpBin(), '--output-dir', browserOutDir(input.threadId)];
    // Chrome locks a profile dir, so only one live thread per channel gets the persistent logins.
    if (input.cdpEndpoint && !input.browserBusy) args.push('--cdp-endpoint', input.cdpEndpoint);
    else {
      if (input.channel.browser_headless) args.push('--headless');
      if (input.browserBusy) args.push('--isolated');
      else args.push('--user-data-dir', join(paths.browsers, input.channel.id));
      // Launching its own browser, @playwright/mcp wants Google Chrome at its stock path. Point it at the one Omni
      // found instead, so a machine with only Chromium (most Linux installs) or Playwright's build still gets a browser.
      const bin = chromeBinary();
      if (bin) args.push('--executable-path', bin);
    }
    // Behind the front where this install has proven it, so a thread that never browses never starts it.
    const direct = { command: process.execPath, args };
    servers['omni-browser'] = { ...(lazyCommand(BROWSER_MCP, direct) ?? direct), env: { ...nodeChildEnv } };
  }

  if (input.role?.mcp.includes('omni')) {
    servers['omni'] = { command: paths.mcpRunner, args: [paths.mcpOmni], env: api };
  } else {
    helper(THREADS_SERVER, 'threads');
    // remember: a role whose threads may propose lessons for its later threads (memory-api.ts). A quick ask only reads.
    const role = input.role;
    if (role?.memory === 'read-write' && !input.quick) {
      const command = nativeMcpCommand('memory');
      if (command) servers[MEMORY_SERVER] = { ...command, env: { ...api, OMNI_ROLE: role.id } };
    }
  }
  return { mcpServers: servers };
}

/**
 * The Claude Code `--mcp-config` file. Claude Code aborts a stdio MCP call that is silent for 30 minutes unless the
 * server's own `timeout` (ms) is longer, whatever MCP_TOOL_TIMEOUT says, so ask_user_question gets a day here.
 */
export function writeMcpConfig(input: McpInput): string {
  const cfg = buildMcpConfig(input);
  const ask = cfg.mcpServers[ASK_SERVER];
  if (ask) cfg.mcpServers[ASK_SERVER] = { ...ask, timeout: ASK_TIMEOUT_SEC * 1000 };
  mkdirSync(threadDir(input.threadId), { recursive: true });
  const file = join(threadDir(input.threadId), 'mcp.json');
  writeFileSync(file, JSON.stringify(cfg, null, 2));
  return file;
}

/**
 * Cursor loads Omni's MCP servers from a per-thread plugin folder in the thread's data dir:
 * `.cursor-plugin/plugin.json` with a name, plus `.mcp.json` in Claude's MCP config shape.
 * Nothing is written to the repo or `~/.cursor`, and no secret value goes into the folder.
 * Cursor puts the folder's name in front of each server's (cursorMcpServer takes it off again), so it stays fixed.
 * Cursor's print mode gives up on any MCP call after 60 seconds and has no setting for it, so ask_user_question waits
 * CURSOR_ASK_WAIT_SEC there, then hands the question back: the user's answer reaches the thread as a message (runner/questions.ts).
 */
export function writeCursorPlugin(input: McpInput): string {
  const cfg = buildMcpConfig(input);
  const ask = cfg.mcpServers[ASK_SERVER];
  if (ask) cfg.mcpServers[ASK_SERVER] = { ...ask, env: { ...ask.env, OMNI_ASK_WAIT_SEC: String(CURSOR_ASK_WAIT_SEC) } };
  const dir = join(threadDir(input.threadId), CURSOR_PLUGIN_FOLDER);
  mkdirSync(join(dir, '.cursor-plugin'), { recursive: true });
  writeFileSync(join(dir, '.cursor-plugin', 'plugin.json'), JSON.stringify({ name: 'omni-os', version: '0.1.0' }, null, 2));
  writeFileSync(join(dir, '.mcp.json'), JSON.stringify(cfg, null, 2));
  return dir;
}

/** The Cursor Agent permission rules a delegate-only role runs under. Deny beats `--force`, and MCP tools stay allowed. */
export const CURSOR_DELEGATE_ONLY_DENY = ['Shell(*)', 'Write(**)'];
/** A no-edits role's (crew.ts NO_EDITS_DENIED): no file writes, with the shell kept, so it is not read only. */
export const CURSOR_NO_EDITS_DENY = ['Write(**)'];

/**
 * Make dir a delegate-only role's Cursor config folder, for CURSOR_CONFIG_DIR: the user's own folder with `cli-config.json`
 * copied and its deny list extended, and everything else linked, so the login, chats and sessions stay where they
 * are. Cursor reads its permissions only from there or from the repo's `.cursor/cli.json`, and Omni writes neither
 * the repo nor ~/.cursor. Rewritten every spawn, so a change to the user's config reaches the next turn.
 */
export function writeCursorDenyConfig(dir: string, userDir: string, extra: readonly string[] = CURSOR_DELEGATE_ONLY_DENY): string {
  mkdirSync(dir, { recursive: true });
  for (const name of existsSync(userDir) ? readdirSync(userDir) : []) {
    if (name === 'cli-config.json') continue;
    const link = join(dir, name);
    try {
      lstatSync(link);
    } catch {
      symlinkSync(join(userDir, name), link);
    }
  }
  let cfg: { permissions?: { allow?: string[]; deny?: string[] }; [k: string]: unknown } = { version: 1 };
  try {
    cfg = JSON.parse(readFileSync(join(userDir, 'cli-config.json'), 'utf8'));
  } catch {
    // No config of the user's yet: the deny list alone.
  }
  const deny = [...new Set([...(cfg.permissions?.deny ?? []), ...extra])];
  writeFileSync(join(dir, 'cli-config.json'), JSON.stringify({ ...cfg, permissions: { allow: cfg.permissions?.allow ?? [], deny } }, null, 2));
  return dir;
}

/**
 * Check a thread's branch out again at dir, for a worktree thread whose worktree is not on this Mac (it ran on the
 * other one). The branch comes from the repo, else from its origin. Throws, saying why, when neither has it.
 */
export async function restoreWorktree(repoPath: string, dir: string, branch: string, extras?: WorktreeExtras) {
  // Never wait on a credential prompt: the turn is waiting.
  const git = (...args: string[]) =>
    run('git', ['-C', repoPath, ...args], { timeout: 30_000, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
  const ref = `refs/heads/${branch}`;
  const has = () => git('rev-parse', '--verify', '--quiet', ref).then(() => true, () => false);
  if (!(await has())) await git('fetch', '--quiet', 'origin', `${ref}:${ref}`).catch(() => {});
  if (!(await has())) throw new Error(`branch ${branch} is not in ${repoPath} or on its origin`);
  // A worktree removed by hand is still registered until pruned, and add refuses its path.
  await git('worktree', 'prune').catch(() => {});
  await git('worktree', 'add', dir, branch);
  await fillWorktree(repoPath, dir, extras);
}

export async function removeWorktree(repoPath: string, dir: string) {
  await run('git', ['-C', repoPath, 'worktree', 'remove', '--force', dir]).catch(() => {});
}

/**
 * Puts the channel's design system in the thread's folder, where the system prompt points at it, or takes a
 * stale copy out when the channel no longer has one. Written every turn, so a change in settings reaches
 * threads that are already open.
 */
export function writeDesignSystem(threadId: string, channel: Channel) {
  const file = designSystemFile(threadId);
  if (channel.design_system) {
    mkdirSync(threadDir(threadId), { recursive: true });
    writeFileSync(file, channel.design_system);
  } else {
    rmSync(file, { force: true });
  }
}
