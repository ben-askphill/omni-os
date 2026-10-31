import { execFile } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { tokenPath } from './api-token.ts';
import { userName } from './user-config.ts';
import { config, paths, threadDir, artifactsDir, browserOutDir, designSystemFile } from './config.ts';
import type { Channel } from './db.ts';
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

/** A thread that must run in a worktree of its own: a repo channel with worktrees on, for a harness on this Mac. */
export function needsWorktree(channel: Channel, opts?: { remote?: boolean }) {
  return !opts?.remote && !!channel.repo_path && !!channel.use_worktree;
}

/** Where a thread's worktree goes and the branch it is cut on. Fixed per thread, so a retry finds the same ones. */
export function plannedWorktree(threadId: string): { cwd: string; branch: string } {
  return { cwd: join(paths.worktrees, threadId), branch: `omni/${threadId.slice(0, 8)}` };
}

/**
 * Where a thread's agent runs, for a thread that needs no worktree (needsWorktree is false):
 * - Hermes or Cursor Cloud: the thread's own data folder; it runs off this Mac
 * - repo channel, worktrees off: the repo itself
 * - otherwise: the channel's base dir, falling back to the brain (phillbert) so skills and context load
 * A worktree thread gets plannedWorktree's folder, which prepareWorktree makes before anything runs there.
 */
export async function prepareWorkdir(channel: Channel, threadId: string, opts?: { remote?: boolean }): Promise<Workdir> {
  mkdirSync(artifactsDir(threadId), { recursive: true });
  mkdirSync(browserOutDir(threadId), { recursive: true });

  // Hermes and Cursor Cloud run off this Mac. A worktree here would pin a branch nothing on this Mac commits to.
  if (opts?.remote) return { cwd: threadDir(threadId), branch: null };
  if (needsWorktree(channel)) return plannedWorktree(threadId);

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
 */
export async function prepareWorktree(repo: string | null, dir: string, branch: string, base?: () => Promise<string>): Promise<void> {
  if (!repo) throw new Error('The channel has no repository set.');
  if (!existsSync(repo)) throw new Error(`The channel's repository is not on this Mac: ${repo}`);
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
}

let playwrightMcp: string | undefined;

/**
 * The browser MCP's entry script, from the exact @playwright/mcp version pinned in apps/server/package.json.
 * Run from Omni's own install so no registry, `latest` tag or repo .npmrc decides what code gets the browser profile.
 */
export function playwrightMcpBin() {
  if (!playwrightMcp) {
    const pkg = createRequire(import.meta.url).resolve('@playwright/mcp/package.json');
    const { bin } = JSON.parse(readFileSync(pkg, 'utf8')) as { bin: string | Record<string, string> };
    playwrightMcp = join(dirname(pkg), typeof bin === 'string' ? bin : bin['playwright-mcp']);
  }
  return playwrightMcp;
}

/** The server with ask_user_question (apps/mcp/ask.ts). Harnesses name its tool `mcp__omni-ask__ask_user_question`. */
export const ASK_SERVER = 'omni-ask';
/** The server with read_referenced_thread alone (apps/mcp/threads.ts), for threads that do not get `omni`, which has it too. */
export const THREADS_SERVER = 'omni-threads';
/** How long a harness lets an ask_user_question call wait for the user: a day. */
export const ASK_TIMEOUT_SEC = 86_400;

/** Per-thread MCP servers, layered on top of the user's normal Claude Code MCP config. Hermes gets none: it runs elsewhere. */
export function buildMcpConfig(input: McpInput) {
  const servers: Record<string, { command: string; args: string[]; env?: Record<string, string> }> = {};
  const api = { OMNI_URL: input.omniUrl, OMNI_TOKEN_FILE: tokenPath(), OMNI_THREAD_ID: input.threadId, OMNI_USER: userName() };

  servers[ASK_SERVER] = { command: paths.tsx, args: [paths.mcpAsk], env: api };

  // A delegate-only role hands browser work to a crewmate, so it gets no browser to be tempted by.
  if (config.browser && !input.role?.delegateOnly) {
    const args = [playwrightMcpBin(), '--output-dir', browserOutDir(input.threadId)];
    // Chrome locks a profile dir, so only one live thread per channel gets the persistent logins.
    if (input.cdpEndpoint && !input.browserBusy) args.push('--cdp-endpoint', input.cdpEndpoint);
    else {
      if (input.channel.browser_headless) args.push('--headless');
      if (input.browserBusy) args.push('--isolated');
      else args.push('--user-data-dir', join(paths.browsers, input.channel.id));
    }
    servers['omni-browser'] = { command: process.execPath, args };
  }

  if (input.role?.mcp.includes('omni')) {
    servers['omni'] = { command: paths.tsx, args: [paths.mcpOmni], env: api };
  } else {
    servers[THREADS_SERVER] = { command: paths.tsx, args: [paths.mcpThreads], env: api };
  }
  return { mcpServers: servers };
}

export function writeMcpConfig(input: McpInput): string {
  const cfg = buildMcpConfig(input);
  mkdirSync(threadDir(input.threadId), { recursive: true });
  const file = join(threadDir(input.threadId), 'mcp.json');
  writeFileSync(file, JSON.stringify(cfg, null, 2));
  return file;
}

/**
 * Cursor loads Omni's MCP servers from a per-thread plugin folder in the thread's data dir:
 * `.cursor-plugin/plugin.json` with a name, plus `.mcp.json` in Claude's MCP config shape.
 * Nothing is written to the repo or `~/.cursor`, and no secret value goes into the folder.
 */
export function writeCursorPlugin(input: McpInput): string {
  const cfg = buildMcpConfig(input);
  const dir = join(threadDir(input.threadId), 'cursor-plugin');
  mkdirSync(join(dir, '.cursor-plugin'), { recursive: true });
  writeFileSync(join(dir, '.cursor-plugin', 'plugin.json'), JSON.stringify({ name: 'omni-os', version: '0.1.0' }, null, 2));
  writeFileSync(join(dir, '.mcp.json'), JSON.stringify(cfg, null, 2));
  return dir;
}

/** The Cursor Agent permission rules a delegate-only role runs under. Deny beats `--force`, and MCP tools stay allowed. */
export const CURSOR_DELEGATE_ONLY_DENY = ['Shell(*)', 'Write(**)'];

/**
 * Make dir a delegate-only role's Cursor config folder, for CURSOR_CONFIG_DIR: the user's own folder with `cli-config.json`
 * copied and its deny list extended, and everything else linked, so the login, chats and sessions stay where they
 * are. Cursor reads its permissions only from there or from the repo's `.cursor/cli.json`, and Omni writes neither
 * the repo nor ~/.cursor. Rewritten every spawn, so a change to the user's config reaches the next turn.
 */
export function writeCursorDenyConfig(dir: string, userDir: string): string {
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
  const deny = [...new Set([...(cfg.permissions?.deny ?? []), ...CURSOR_DELEGATE_ONLY_DENY])];
  writeFileSync(join(dir, 'cli-config.json'), JSON.stringify({ ...cfg, permissions: { allow: cfg.permissions?.allow ?? [], deny } }, null, 2));
  return dir;
}

/**
 * Check a thread's branch out again at dir, for a worktree thread whose worktree is not on this Mac (it ran on the
 * other one). The branch comes from the repo, else from its origin. Throws, saying why, when neither has it.
 */
export async function restoreWorktree(repoPath: string, dir: string, branch: string) {
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
