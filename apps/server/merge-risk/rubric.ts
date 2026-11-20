// The rubric the merge-risk gate rates with: .agents/skills/merge-risk/SKILL.md as origin's default branch has it,
// fetched fresh. Never a PR branch's copy and never a working tree's, so a PR cannot loosen the rules it is rated by.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolvePick } from '../worktree-base.ts';

const run = promisify(execFile);

export const RUBRIC_PATH = '.agents/skills/merge-risk/SKILL.md';

export interface Rubric {
  /** SKILL.md without its frontmatter. */
  text: string;
  /** The main commit it was read at. */
  sha: string;
  /** What that commit is called, e.g. origin/main. */
  ref: string;
}

/** A skill file's body: what follows its `---` frontmatter, or all of it when it has none. */
export const rubricBody = (file: string) => file.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '').trim();

const git = (repo: string, args: string[]) => run('git', ['-C', repo, ...args], { maxBuffer: 1024 * 1024, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } }).then((r) => r.stdout);

/**
 * The rubric on main of the repo checked out at `repo`: origin's default branch, fetched first (worktree-base.ts), read
 * from that commit with `git show`. Null only when main has no file there (or an empty one): the gate does not rate
 * that repo. Anything else that goes wrong (origin out of reach, git failing) throws, so the poll fails in the log
 * instead of the gate turning itself off without a word.
 */
export async function mainRubric(repo: string): Promise<Rubric | null> {
  const { sha, ref } = await resolvePick(repo, { kind: 'remote-default' });
  if (!(await git(repo, ['ls-tree', '--name-only', sha, '--', RUBRIC_PATH])).trim()) return null;
  const text = rubricBody(await git(repo, ['show', `${sha}:${RUBRIC_PATH}`]));
  return text ? { text, sha, ref } : null;
}
