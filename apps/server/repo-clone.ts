// A repo channel whose repository is not on this machine (set up on the other one, or never cloned here): before a
// worktree thread's setup checks a branch out (runner/setup.ts), Omni clones the channel's GitHub repo with this
// machine's own gh or git login. It goes to the channel's path on this machine when that path can live here, else to
// ~/<name> (under the Repos folder when one is set), which this machine's path map records so the other machine keeps
// its own path (sync/paths.ts). One clone per folder at a time: a second thread waits for it and uses the result.
import { execFile, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import type { RepoClone } from '@omni/shared/channel-actions.ts';
import { channels, kv, type Channel } from './db.ts';
import { pathMap, toPortable, toRemote } from './sync/paths.ts';
import { expandHome, tildify, userConfig } from './user-config.ts';

const run = promisify(execFile);

/** What setup does about a channel's repository before its checkout. */
type Plan =
  /** The folder is there, or the channel has none: the checkout checks it as before. */
  | { kind: 'present' }
  | { kind: 'clone'; repo: string; into: string }
  | { kind: 'refuse'; reason: string };

/** How long a clone may run before it is stopped. A large repo over a slow link takes minutes. */
export const CLONE_TIMEOUT_MS = 15 * 60_000;

/** owner/name as GitHub allows them. Anything else (from the other machine, or typed) is never put in a path or a command. */
const GITHUB_REPO = /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/;

/** Clones running now, by the folder they make. */
const cloning = new Map<string, { status: RepoClone; done: Promise<void> }>();

const isEmptyDir = (dir: string) => {
  try {
    return readdirSync(dir).length === 0;
  } catch {
    return false;
  }
};

const inside = (p: string, root: string) => p === root || p.startsWith(root.endsWith('/') ? root : `${root}/`);

/**
 * True when Omni may make the folder p here: under the home folder, or in a folder that exists. A path from the other
 * machine that is neither (a Mac's /Users/… on Linux) is not this machine's to create.
 */
const placeable = (p: string) => isAbsolute(p) && (inside(resolve(p), homedir()) || existsSync(dirname(p)));

/** Where a channel's repo goes when its own path cannot be made here: the Repos folder when one is set, else home. */
const fallbackRoot = () => expandHome(userConfig().workspace.reposDir) || homedir();

function plan(channel: Channel): Plan {
  const path = channel.repo_path;
  const repo = channel.github_repo?.trim();
  // A folder with something in it, or an empty one with nothing to clone into it: the checkout says what is wrong.
  if (!path || (existsSync(path) && !(repo && isEmptyDir(path)))) return { kind: 'present' };
  const missing = `The channel's repository is not on this machine: ${path}.`;
  if (!repo) return { kind: 'refuse', reason: `${missing} Set the channel's GitHub repo in its settings so Omni can clone it, or point the channel at the folder that has it.` };
  const name = repo.split('/')[1];
  if (!GITHUB_REPO.test(repo) || name === '.' || name === '..') return { kind: 'refuse', reason: `${missing} Its GitHub repo "${repo}" is not an owner/name Omni can clone.` };
  return { kind: 'clone', repo, into: placeable(path) ? resolve(path) : join(fallbackRoot(), name) };
}

/** The clone a thread's channel is waiting on, for its setup card. Null when none runs. */
export function cloneFor(channelId: string): RepoClone | null {
  const channel = channels.get(channelId);
  const p = channel && plan(channel);
  return p?.kind === 'clone' ? (cloning.get(p.into)?.status ?? null) : null;
}

/**
 * Make sure the channel's repository is on this machine, cloning it when it is missing. Resolves once the channel's
 * repo_path here names a folder setup can check (or the channel has no repository, for setup to report). Throws,
 * saying why, when there is nothing to clone from, the clone fails, or a folder that is not the repo is in the way.
 * Safe to run again and from several threads at once: one clone per folder, and a finished one is used, not redone.
 */
export async function ensureRepo(channelId: string): Promise<void> {
  const channel = channels.get(channelId);
  if (!channel) return;
  const p = plan(channel);
  if (p.kind === 'present') return;
  if (p.kind === 'refuse') throw new Error(p.reason);
  let job = cloning.get(p.into);
  if (!job) {
    const done = cloneInto(p.repo, p.into).finally(() => cloning.delete(p.into));
    job = { status: { repo: p.repo, into: tildify(p.into) }, done };
    cloning.set(p.into, job);
  }
  await job.done;
  adopt(channelId, p.into);
}

/**
 * The channel's repository is at `into` on this machine. When that is not its path here, the path map learns it, so
 * a change from the other machine lands on `into` and an edit made here still sends that machine its own path. The
 * row changes here only: the other machine's path did not move.
 */
function adopt(channelId: string, into: string) {
  const path = channels.get(channelId)?.repo_path;
  if (!path || resolve(path) === into) return;
  kv.set('sync.path_map', { ...pathMap(), [toRemote(path)]: toPortable(into) });
  channels.relocateRepo(channelId, into);
  console.log(`[clone] channel ${channelId}: repository is at ${into} on this machine (was ${path})`);
}

/** The owner/name a GitHub remote URL points at, lowercased, or null for any other URL. */
export function githubRepoOf(url: string): string | null {
  return url.trim().match(/github\.com[:/]+([^/]+\/[^/]+?)(?:\.git)?\/?$/i)?.[1].toLowerCase() ?? null;
}

/** True when dir is a checkout whose origin is the GitHub repo. */
async function isCloneOf(dir: string, repo: string) {
  const git = (...args: string[]) => run('git', ['-C', dir, ...args], { timeout: 30_000 }).then((r) => r.stdout.trim(), () => null);
  const top = await git('rev-parse', '--show-toplevel');
  if (!top || resolve(top) !== resolve(dir)) return false;
  const origin = await git('remote', 'get-url', 'origin');
  return !!origin && githubRepoOf(origin) === repo.toLowerCase();
}

async function cloneInto(repo: string, into: string): Promise<void> {
  const shown = tildify(into);
  if (existsSync(into) && !isEmptyDir(into)) {
    // An earlier clone, by Omni or by hand: use it.
    if (await isCloneOf(into, repo)) return;
    throw new Error(`${shown} is already there and is not a clone of ${repo}, so Omni left it alone. Move it, or point the channel at the folder that has the repo, then retry.`);
  }
  // Cloned next to its place and moved in once whole, so a clone cut short never leaves a half checkout there.
  const tmp = join(dirname(into), `.${basename(into)}.omni-clone`);
  try {
    mkdirSync(dirname(into), { recursive: true });
    rmSync(tmp, { recursive: true, force: true });
    console.log(`[clone] ${repo} into ${into}`);
    await cloneCommand(repo, tmp);
    // Refuses a folder that filled up meanwhile; an empty one is replaced.
    renameSync(tmp, into);
  } catch (err) {
    rmSync(tmp, { recursive: true, force: true });
    const why = (err as Error).message.trim();
    throw new Error(
      `Omni could not clone ${repo} into ${shown}: ${/[.!?]$/.test(why) ? why : `${why}.`} ` +
        `Check that this machine is logged in to GitHub with access to ${repo} (gh auth status), then retry.`,
    );
  }
}

/** The end of a failed command's stderr, where it says why, without git's hint lines. */
function lastLines(stderr: string) {
  const lines = stderr.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('hint:'));
  return lines.slice(-3).join(' ');
}

/**
 * `gh repo clone`, which uses gh's login and git protocol, or `git clone` over HTTPS where gh is not installed. In a
 * session of its own with no stdin, so neither git, gh nor ssh can stop to ask for a password or a host key, and
 * stopped with everything it started when it runs too long.
 */
async function cloneCommand(repo: string, dir: string): Promise<void> {
  try {
    await runClone('gh', ['repo', 'clone', repo, dir, '--', '--quiet']);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    await runClone('git', ['clone', '--quiet', `https://github.com/${repo}.git`, dir]);
  }
}

function runClone(bin: string, args: string[]): Promise<void> {
  return new Promise((done, fail) => {
    const child = spawn(bin, args, {
      detached: true,
      stdio: ['ignore', 'ignore', 'pipe'],
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GH_PROMPT_DISABLED: '1', GCM_INTERACTIVE: 'never' },
    });
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-8192);
    });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        if (child.pid) process.kill(-child.pid, 'SIGKILL');
      } catch {
        // already gone
      }
    }, CLONE_TIMEOUT_MS);
    child.on('error', (err) => {
      clearTimeout(timer);
      fail(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0 && !timedOut) return done();
      if (timedOut) return fail(new Error(`it took longer than ${CLONE_TIMEOUT_MS / 60_000} minutes and was stopped.`));
      fail(new Error(lastLines(stderr) || `${bin} exited with code ${code}`));
    });
  });
}
