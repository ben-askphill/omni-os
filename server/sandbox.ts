import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { config, paths, threadDir, artifactsDir, browserOutDir } from './config.ts';
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

/**
 * Where a thread's agent runs.
 * - repo channel + worktrees on: a fresh git worktree on branch omni/<id>, so parallel threads never collide
 * - repo channel, worktrees off: the repo itself
 * - otherwise: the channel's base dir, falling back to the brain (phillbert) so skills and context load
 */
export async function prepareWorkdir(channel: Channel, threadId: string, opts?: { remote?: boolean }): Promise<Workdir> {
  mkdirSync(artifactsDir(threadId), { recursive: true });
  mkdirSync(browserOutDir(threadId), { recursive: true });

  // Hermes runs on its own server. A worktree here would pin a branch nothing on this Mac commits to.
  if (opts?.remote) return { cwd: threadDir(threadId), branch: null };

  if (channel.repo_path && existsSync(channel.repo_path)) {
    if (channel.use_worktree && (await isGitRepo(channel.repo_path))) {
      const branch = `omni/${threadId.slice(0, 8)}`;
      const dir = join(paths.worktrees, threadId);
      try {
        await run('git', ['-C', channel.repo_path, 'worktree', 'add', '-b', branch, dir, 'HEAD']);
        return { cwd: dir, branch };
      } catch (err) {
        console.warn(`[sandbox] worktree failed for ${channel.id}, using repo directly:`, (err as Error).message);
      }
    }
    return { cwd: channel.repo_path, branch: null };
  }
  if (channel.base_dir && existsSync(channel.base_dir)) return { cwd: channel.base_dir, branch: null };
  if (existsSync(config.brainDir)) return { cwd: config.brainDir, branch: null };
  return { cwd: threadDir(threadId), branch: null };
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

/** Per-thread MCP servers, layered on top of the user's normal Claude Code MCP config. */
export function buildMcpConfig(input: McpInput) {
  const servers: Record<string, { command: string; args: string[]; env?: Record<string, string> }> = {};

  if (config.browser) {
    const args = ['-y', '@playwright/mcp@latest', '--output-dir', browserOutDir(input.threadId)];
    // Chrome locks a profile dir, so only one live thread per channel gets the persistent logins.
    if (input.cdpEndpoint && !input.browserBusy) args.push('--cdp-endpoint', input.cdpEndpoint);
    else {
      if (input.channel.browser_headless) args.push('--headless');
      if (input.browserBusy) args.push('--isolated');
      else args.push('--user-data-dir', join(paths.browsers, input.channel.id));
    }
    servers['omni-browser'] = { command: 'npx', args };
  }

  if (input.role?.mcp.includes('omni')) {
    servers['omni'] = {
      command: paths.tsx,
      args: [paths.mcpOmni],
      env: { OMNI_URL: input.omniUrl, OMNI_THREAD_ID: input.threadId },
    };
  }
  return { mcpServers: servers };
}

export function writeMcpConfig(input: McpInput): string | null {
  const cfg = buildMcpConfig(input);
  if (!Object.keys(cfg.mcpServers).length) return null;
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
