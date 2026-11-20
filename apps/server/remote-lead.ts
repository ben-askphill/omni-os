// A thread a remote agent leads (ADR 0020): the lead talks only and never changes files, local members seated in it edit
// the thread's worktree, and only the lead commits (ADR 0019). So in such a thread Ben commits the members' edits
// himself, with the Commit button (Q64), and opens the pull request with the thread's Open PR action. Omni runs git and
// gh for him here, in the thread's worktree, since no agent of the thread can.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { isRemoteAgentHarness } from '@omni/shared/remote-agent.ts';
import { threadBases, threads, type Thread } from './db.ts';
import { userName } from './profile.ts';
import { filesOffMachine } from './thread-files.ts';
import { busyAgents } from './runner/members.ts';
import { clearCommitted } from './runner/collisions.ts';
import { addEvent, emitThread } from './runner/state.ts';

const exec = promisify(execFile);
const refused = (message: string, status: 400 | 404 | 409 | 502) => Object.assign(new Error(message), { status });

/** The first line of what a failed git or gh call said, for the refusal. Never the command's environment. */
const said = (e: unknown) => String((e as { stderr?: string }).stderr || (e as Error).message || '').trim().split('\n')[0].slice(0, 300);

async function git(cwd: string, ...args: string[]) {
  return (await exec('git', ['-C', cwd, ...args], { timeout: 60_000, maxBuffer: 8 * 1024 * 1024 })).stdout.trim();
}

/** A thread Ben commits by hand: led by a remote agent, with its checkout on this machine. */
function remoteLed(id: string): Thread & { cwd: string } {
  const t = threads.get(id);
  if (!t || t.source === 'member') throw refused('thread not found', 404);
  if (!isRemoteAgentHarness(t.harness)) throw refused('Only a thread a remote agent leads has a Commit button: in any other thread, its lead commits.', 409);
  if (filesOffMachine(t) || !t.cwd) throw refused("This thread started before remote-led threads got a worktree, so it has no files on this machine to commit.", 409);
  return t as Thread & { cwd: string };
}

/** The files a commit would take, from `git status`. */
export async function uncommitted(cwd: string): Promise<number> {
  const out = await git(cwd, 'status', '--porcelain', '--untracked-files=all').catch(() => '');
  return out ? out.split('\n').length : 0;
}

/**
 * Commit everything the thread's members changed, with Ben's message, and say so in the transcript. Refused while an
 * agent of the thread still works, and when there is nothing to commit.
 */
export async function commitThread(id: string, message: string): Promise<{ sha: string; files: number }> {
  const t = remoteLed(id);
  const busy = busyAgents(id);
  if (busy) throw refused(busy, 409);
  const subject = message.trim();
  if (!subject) throw refused('Give the commit a message.', 400);
  if (!(await uncommitted(t.cwd))) throw refused('Nothing to commit: the worktree has no changes.', 409);
  try {
    await git(t.cwd, 'add', '-A');
    await exec('git', ['-C', t.cwd, 'commit', '-q', '-m', subject], { timeout: 60_000 });
  } catch (e) {
    throw refused(`git could not commit: ${said(e)}`, 409);
  }
  const sha = await git(t.cwd, 'rev-parse', 'HEAD');
  const files = (await git(t.cwd, 'diff-tree', '--no-commit-id', '--name-only', '-r', '--root', 'HEAD')).split('\n').filter(Boolean).length;
  addEvent(id, 'member', { event: 'committed', agent: '', name: userName(), commit: { sha, message: subject.split('\n')[0].slice(0, 200), files } });
  // The commit takes down the collision flags raised before it, as an agent's commit does (Q23).
  await clearCommitted(id);
  emitThread(id);
  return { sha, files };
}

/**
 * Push the thread's branch and open its pull request with gh, titled after the thread. Refused while changes wait for
 * the Commit button, since the pull request would leave them out.
 */
export async function openThreadPR(id: string): Promise<{ url: string }> {
  const t = remoteLed(id);
  if (!t.branch) throw refused('This thread works in the repo itself, not on a branch of its own, so it has no pull request to open.', 409);
  if (await uncommitted(t.cwd)) throw refused('Commit the changes first: the pull request would leave them out.', 409);
  try {
    await exec('git', ['-C', t.cwd, 'push', '-q', '-u', 'origin', t.branch], { timeout: 120_000 });
  } catch (e) {
    throw refused(`git could not push ${t.branch}: ${said(e)}`, 502);
  }
  // The commits since the thread's branch was cut, when Omni recorded where.
  const base = threadBases.get(id);
  const log = base?.sha ? await git(t.cwd, 'log', '--format=- %s', '-n', '30', `${base.sha}..HEAD`).catch(() => '') : '';
  const body = `Opened from an Omni thread led by a remote agent. ${userName()} committed the changes its local agents made.${log ? `\n\n${log}` : ''}`;
  try {
    const { stdout } = await exec('gh', ['pr', 'create', '--head', t.branch, '--title', t.title, '--body', body], { cwd: t.cwd, timeout: 120_000 });
    const url = stdout.trim().split('\n').reverse().find((l) => /^https:\/\//.test(l)) ?? stdout.trim();
    emitThread(id);
    return { url };
  } catch (e) {
    throw refused(`gh could not open the pull request: ${said(e)}`, 502);
  }
}
