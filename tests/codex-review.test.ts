import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { reviewTarget } from '../server/harness/codex/review.ts';

// What Codex's /review looks at, worked out with git in the thread's folder: here a repo whose
// main branch has one commit, with a feature branch one commit ahead, a remote-tracking copy of
// main and an uncommitted change.

let repo: string;
let plain: string;
let first: string;
let loud: string;
const git = (...args: string[]) =>
  execFileSync('git', ['-C', repo, '-c', 'user.name=Omni', '-c', 'user.email=omni@example.com', '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8' }).trim();

beforeAll(() => {
  repo = realpathSync(mkdtempSync(join(tmpdir(), 'omni-review-')));
  plain = realpathSync(mkdtempSync(join(tmpdir(), 'omni-review-plain-')));
  git('init', '-q', '-b', 'main');
  writeFileSync(join(repo, 'greet.js'), 'export const greet = (name) => `hi ${name}`;\n');
  git('add', '.');
  git('commit', '-q', '-m', 'Add greet');
  first = git('rev-parse', 'HEAD');
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  git('checkout', '-q', '-b', 'feature');
  writeFileSync(join(repo, 'greet.js'), 'export const greet = (name) => `HI ${name.toUpperCase()}`;\n');
  git('commit', '-q', '-am', 'Make greet loud');
  loud = git('rev-parse', 'HEAD');
  writeFileSync(join(repo, 'greet.js'), 'export const greet = (name) => `HI ${nme.toUpperCase()}`;\n');
});
afterAll(() => {
  rmSync(repo, { recursive: true, force: true });
  rmSync(plain, { recursive: true, force: true });
});

describe('reviewTarget', () => {
  it('reviews the uncommitted changes when /review has no argument', async () => {
    expect(await reviewTarget('', repo)).toEqual({ type: 'uncommittedChanges' });
    expect(await reviewTarget('  \n', repo)).toEqual({ type: 'uncommittedChanges' });
  });

  it('reviews against a branch', async () => {
    expect(await reviewTarget('main', repo)).toEqual({ type: 'baseBranch', branch: 'main' });
    expect(await reviewTarget(' main ', repo)).toEqual({ type: 'baseBranch', branch: 'main' });
    expect(await reviewTarget('origin/main', repo)).toEqual({ type: 'baseBranch', branch: 'origin/main' });
  });

  it('reviews a commit, with its subject as the title', async () => {
    expect(await reviewTarget(loud, repo)).toEqual({ type: 'commit', sha: loud, title: 'Make greet loud' });
    expect(await reviewTarget(loud.slice(0, 7), repo)).toEqual({ type: 'commit', sha: loud, title: 'Make greet loud' });
    expect(await reviewTarget('HEAD~1', repo)).toEqual({ type: 'commit', sha: first, title: 'Add greet' });
    // A branch with a revision after it names a commit, not the branch.
    expect(await reviewTarget('feature~1', repo)).toEqual({ type: 'commit', sha: first, title: 'Add greet' });
    expect(await reviewTarget('origin/main^0', repo)).toEqual({ type: 'commit', sha: first, title: 'Add greet' });
  });

  it('reviews with anything else as instructions, the whole argument text', async () => {
    expect(await reviewTarget('focus on the parser', repo)).toEqual({ type: 'custom', instructions: 'focus on the parser' });
    expect(await reviewTarget('main against feature', repo)).toEqual({ type: 'custom', instructions: 'main against feature' });
    expect(await reviewTarget('security', repo)).toEqual({ type: 'custom', instructions: 'security' });
    expect(await reviewTarget('--all', repo)).toEqual({ type: 'custom', instructions: '--all' });
  });

  it('takes every argument as instructions in a folder that is not a git repo', async () => {
    expect(await reviewTarget('main', plain)).toEqual({ type: 'custom', instructions: 'main' });
    expect(await reviewTarget('', plain)).toEqual({ type: 'uncommittedChanges' });
  });
});
