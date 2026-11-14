import { describe, it, expect, vi, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { copyIncludes, includedFiles, includePatterns, sameAsMain } from '../worktree-include.ts';

// .worktreeinclude: which ignored files of the main checkout a new thread worktree gets, against real temp repos.

const root = mkdtempSync(join(tmpdir(), 'omni-include-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const log = vi.spyOn(console, 'log').mockImplementation(() => {});

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', '-C', cwd, ...args], { encoding: 'utf8' }).trim();
const write = (path: string, text: string) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
};

let n = 0;
/** A repo ignoring .env files, secrets/, *.toml and node_modules/, with a worktree of it. */
function repo(include: string | null, files: Record<string, string> = {}) {
  const dir = join(root, `repo-${++n}`);
  mkdirSync(dir);
  git(dir, 'init', '-q', '-b', 'main');
  write(join(dir, '.gitignore'), '.env\n.env.*\nsecrets/\n*.toml\nnode_modules/\n');
  write(join(dir, 'README.md'), 'hi\n');
  if (include !== null) write(join(dir, '.worktreeinclude'), include);
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'start');
  for (const [p, text] of Object.entries(files)) write(join(dir, p), text);
  const wt = join(root, `wt-${n}`);
  git(dir, 'worktree', 'add', '-q', '-b', `t${n}`, wt);
  return { dir, wt };
}

describe('includePatterns', () => {
  it('reads the file without blanks and comments, then the extra patterns', () => {
    const { dir } = repo('# local config\n.env\n\n  \nshopify.theme.toml  \n');
    expect(includePatterns(dir)).toEqual(['.env', 'shopify.theme.toml']);
    expect(includePatterns(dir, ['config/*.json'])).toEqual(['.env', 'shopify.theme.toml', 'config/*.json']);
  });

  it('is only the extra patterns, or nothing, without the file', () => {
    const { dir } = repo(null);
    expect(includePatterns(dir)).toEqual([]);
    expect(includePatterns(dir, ['.env'])).toEqual(['.env']);
  });
});

describe('includedFiles', () => {
  it('matches gitignore syntax: names at any depth, anchored paths, globs, folders and negation', async () => {
    const { dir } = repo(null, {
      '.env': 'A=1',
      'apps/web/.env': 'B=2',
      '.env.local': 'C=3',
      'shopify.theme.toml': 'store=x',
      'deep/other.toml': 'y',
      'secrets/a.json': '{}',
      'secrets/keep.txt': 'k',
      'node_modules/dep.js': 'x',
    });
    expect(await includedFiles(dir, ['.env'])).toEqual(['.env', 'apps/web/.env']);
    expect(await includedFiles(dir, ['/.env'])).toEqual(['.env']);
    expect(await includedFiles(dir, ['.env*'])).toEqual(['.env', '.env.local', 'apps/web/.env']);
    expect(await includedFiles(dir, ['/*.toml'])).toEqual(['shopify.theme.toml']);
    expect(await includedFiles(dir, ['secrets/'])).toEqual(['secrets/a.json', 'secrets/keep.txt']);
    // As in .gitignore, a file under an excluded folder cannot be taken back out; under a glob it can.
    expect(await includedFiles(dir, ['secrets/*', '!secrets/keep.txt'])).toEqual(['secrets/a.json']);
    expect(await includedFiles(dir, [])).toEqual([]);
  });

  it('skips tracked files and untracked files the repo does not ignore', async () => {
    const { dir } = repo(null, { 'notes.txt': 'untracked, not ignored', '.env': 'A=1' });
    expect(await includedFiles(dir, ['README.md', 'notes.txt', '.env', 'missing.env'])).toEqual(['.env']);
  });
});

describe('copyIncludes', () => {
  it('copies the listed ignored files into the worktree, keeping folders and contents', async () => {
    const { dir, wt } = repo('.env\nshopify.theme.toml\nsecrets/\n', { '.env': 'A=1\n', 'apps/web/.env': 'B=2\n', 'shopify.theme.toml': 'store=x\n', 'secrets/a.json': '{}' });
    const r = await copyIncludes(dir, wt);
    expect(r.copied).toEqual(['.env', 'apps/web/.env', 'secrets/a.json', 'shopify.theme.toml']);
    expect(r.bytes).toBe(4 + 4 + 2 + 8);
    expect(readFileSync(join(wt, '.env'), 'utf8')).toBe('A=1\n');
    expect(readFileSync(join(wt, 'apps/web/.env'), 'utf8')).toBe('B=2\n');
    expect(readFileSync(join(wt, 'secrets/a.json'), 'utf8')).toBe('{}');
    // Ignored in the worktree too: the agent never commits them.
    expect(git(wt, 'status', '--porcelain')).toBe('');
    expect(log).toHaveBeenCalledWith(expect.stringContaining('copied 4 file(s) from .worktreeinclude (18 bytes): .env, apps/web/.env'));
  });

  it('takes extra patterns on top of the file', async () => {
    const { dir, wt } = repo('.env\n', { '.env': 'A', 'shopify.theme.toml': 'x' });
    expect((await copyIncludes(dir, wt, { extra: ['*.toml'] })).copied).toEqual(['.env', 'shopify.theme.toml']);
  });

  it('copies nothing without a .worktreeinclude', async () => {
    const { dir, wt } = repo(null, { '.env': 'A' });
    expect(await copyIncludes(dir, wt)).toEqual({ copied: [], bytes: 0, skipped: [], missing: [] });
    expect(existsSync(join(wt, '.env'))).toBe(false);
  });

  it('reports a listed path the main checkout lacks as missing, without failing (a run-on clone has no .env)', async () => {
    const { dir, wt } = repo('.env\n/config/local.toml\n*.key\n');
    const r = await copyIncludes(dir, wt);
    expect(r.copied).toEqual([]);
    expect(r.missing).toEqual(['.env', '/config/local.toml']);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('not in the main checkout, skipped: .env, /config/local.toml'));
  });

  it('never overwrites a file the worktree already has', async () => {
    const { dir, wt } = repo('.env\n', { '.env': 'main' });
    writeFileSync(join(wt, '.env'), 'mine');
    const r = await copyIncludes(dir, wt);
    expect(r.copied).toEqual([]);
    expect(r.skipped).toEqual([{ path: '.env', why: 'already in the worktree' }]);
    expect(readFileSync(join(wt, '.env'), 'utf8')).toBe('mine');
  });

  it('skips symlinks', async () => {
    const { dir, wt } = repo('secrets/\n', { 'secrets/a.json': '{}' });
    symlinkSync('/etc/hosts', join(dir, 'secrets', 'link.json'));
    const r = await copyIncludes(dir, wt);
    expect(r.copied).toEqual(['secrets/a.json']);
    expect(r.skipped).toEqual([{ path: 'secrets/link.json', why: 'not a regular file' }]);
  });

  it('stops at the file and byte budget and logs what it left out', async () => {
    const files = Object.fromEntries(Array.from({ length: 5 }, (_, i) => [`secrets/${i}.txt`, 'x'.repeat(10)]));
    const { dir, wt } = repo('secrets/\n', files);
    const byCount = await copyIncludes(dir, wt, { budget: { files: 3, bytes: 1000 } });
    expect(byCount.copied).toEqual(['secrets/0.txt', 'secrets/1.txt', 'secrets/2.txt']);
    expect(byCount.skipped.map((s) => [s.path, s.why])).toEqual([
      ['secrets/3.txt', 'over the budget'],
      ['secrets/4.txt', 'over the budget'],
    ]);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('over the .worktreeinclude budget, not copied: secrets/3.txt, secrets/4.txt'));

    const other = repo('secrets/\n', files);
    const byBytes = await copyIncludes(other.dir, other.wt, { budget: { files: 100, bytes: 25 } });
    expect(byBytes.copied).toEqual(['secrets/0.txt', 'secrets/1.txt']);
    expect(byBytes.bytes).toBe(20);
  });
});

describe('sameAsMain', () => {
  it('is true for an unchanged copy, file or folder, and false once it differs or the main one is gone', async () => {
    const { dir, wt } = repo('.env\nsecrets/\n', { '.env': 'A=1', 'secrets/a.json': '{}' });
    await copyIncludes(dir, wt);
    expect(sameAsMain(dir, wt, '.env')).toBe(true);
    expect(sameAsMain(dir, wt, 'secrets/')).toBe(true);
    writeFileSync(join(wt, '.env'), 'A=2');
    expect(sameAsMain(dir, wt, '.env')).toBe(false);
    writeFileSync(join(wt, 'secrets', 'new.json'), '{}');
    expect(sameAsMain(dir, wt, 'secrets/')).toBe(false);
    write(join(wt, 'only-here.toml'), 'x');
    expect(sameAsMain(dir, wt, 'only-here.toml')).toBe(false);
  });
});
