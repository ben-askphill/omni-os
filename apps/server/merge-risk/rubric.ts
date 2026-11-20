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

/**
 * The rubric on main of the repo checked out at `repo`: origin's default branch, fetched first (worktree-base.ts), read
 * from that commit with `git show`. Null when main has no rubric: the gate does not rate that repo. Throws when origin
 * cannot be reached, so a network blip skips a poll instead of turning the gate off.
 */
export async function mainRubric(repo: string): Promise<Rubric | null> {
  const { sha, ref } = await resolvePick(repo, { kind: 'remote-default' });
  try {
    const { stdout } = await run('git', ['-C', repo, 'show', `${sha}:${RUBRIC_PATH}`], { maxBuffer: 1024 * 1024, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } });
    const text = rubricBody(stdout);
    return text ? { text, sha, ref } : null;
  } catch {
    return null;
  }
}
