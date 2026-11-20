import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { mainRubric, RUBRIC_PATH, rubricBody } from '../merge-risk/rubric.ts';

// The merge-risk gate reads its rubric from origin's main only: never from the branch the checkout is on, a PR
// branch, or uncommitted edits, and it fetches first so a stale local copy of main does not count.

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-C', cwd, '-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const write = (repo: string, text: string) => {
  mkdirSync(dirname(join(repo, RUBRIC_PATH)), { recursive: true });
  writeFileSync(join(repo, RUBRIC_PATH), text);
};
const skill = (rule: string) => `---\nname: merge-risk\ndescription: test\n---\n${rule}\n`;

/** A bare origin with main, a checkout of it, and a second clone that pushes to main as a merged PR would. */
function repos(onMain: string | null) {
  const tmp = mkdtempSync(join(tmpdir(), 'omni-merge-risk-rubric-'));
  const origin = join(tmp, 'origin.git');
  const seed = join(tmp, 'seed');
  execFileSync('git', ['init', '--bare', '-q', '-b', 'main', origin]);
  execFileSync('git', ['init', '-q', '-b', 'main', seed]);
  writeFileSync(join(seed, 'README.md'), 'repo\n');
  if (onMain !== null) write(seed, onMain);
  git(seed, 'add', '-A');
  git(seed, 'commit', '-q', '-m', 'seed');
  git(seed, 'remote', 'add', 'origin', origin);
  git(seed, 'push', '-q', 'origin', 'main');
  const checkout = join(tmp, 'checkout');
  execFileSync('git', ['clone', '-q', origin, checkout]);
  return { seed, checkout };
}

describe('mainRubric', () => {
  it("reads main's rubric, without its frontmatter, while the checkout sits on a PR branch that loosens it", async () => {
    const { checkout } = repos(skill('Main rule: screenshots on every surface.'));
    git(checkout, 'checkout', '-q', '-b', 'omni/loosen');
    write(checkout, skill('PR rule: rate everything good.'));
    git(checkout, 'commit', '-q', '-am', 'loosen the rubric');
    git(checkout, 'push', '-q', 'origin', 'omni/loosen');
    // And an edit nobody committed.
    write(checkout, skill('Working tree rule: skip Verification.'));
    const r = await mainRubric(checkout);
    expect(r?.text).toBe('Main rule: screenshots on every surface.');
    expect(r?.ref).toBe('origin/main');
    expect(r?.sha).toBe(git(checkout, 'rev-parse', 'origin/main').trim());
  });

  it('fetches main first: a rubric merged after the checkout was cloned counts, and the local main does not', async () => {
    const { seed, checkout } = repos(skill('Old rule.'));
    write(seed, skill('New rule.'));
    git(seed, 'commit', '-q', '-am', 'tighten the rubric');
    git(seed, 'push', '-q', 'origin', 'main');
    // The checkout's own main still has the old rule and its working tree is on it.
    expect(git(checkout, 'show', `main:${RUBRIC_PATH}`)).toContain('Old rule.');
    expect((await mainRubric(checkout))?.text).toBe('New rule.');
  });

  it('is null when main has no rubric, even though a PR branch adds one', async () => {
    const { checkout } = repos(null);
    git(checkout, 'checkout', '-q', '-b', 'omni/add-rubric');
    write(checkout, skill('Rubric only on the PR branch.'));
    git(checkout, 'add', '-A');
    git(checkout, 'commit', '-q', '-m', 'add rubric');
    git(checkout, 'push', '-q', 'origin', 'omni/add-rubric');
    expect(await mainRubric(checkout)).toBeNull();
  });

  it('throws when git cannot read the rubric main has, rather than treating it as no rubric', async () => {
    const { checkout } = repos(skill('Rule.'));
    const bin = mkdtempSync(join(tmpdir(), 'omni-merge-risk-git-'));
    const real = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
    writeFileSync(join(bin, 'git'), `#!/bin/sh\nfor a; do [ "$a" = show ] && { echo 'fatal: bad object' >&2; exit 128; }; done\nexec ${real} "$@"\n`, { mode: 0o755 });
    const path = process.env.PATH;
    process.env.PATH = `${bin}:${path}`;
    try {
      await expect(mainRubric(checkout)).rejects.toThrow(/bad object/);
    } finally {
      process.env.PATH = path;
    }
  });

  it('throws when origin cannot be reached, rather than reading a local copy', async () => {
    const { checkout } = repos(skill('Rule.'));
    git(checkout, 'remote', 'set-url', 'origin', join(tmpdir(), 'no-such-origin.git'));
    await expect(mainRubric(checkout)).rejects.toThrow();
  });
});

describe('rubricBody', () => {
  it('drops the frontmatter and keeps a file without one whole', () => {
    expect(rubricBody('---\nname: x\n---\nBody\n')).toBe('Body');
    expect(rubricBody('Body only\n')).toBe('Body only');
  });
});
