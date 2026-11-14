import { describe, it, expect, vi, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { copyIncludes, fillWorktree, includedFiles, includePatterns, linkOnPath, linkShared, sameAsMain } from '../worktree-include.ts';

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

  it('never writes through a symlinked folder in the worktree (one a branch commits), even a dangling one', async () => {
    const { dir, wt } = repo('secrets/\n.env\n', { 'secrets/a.json': '{}', 'apps/web/.env': 'A' });
    const outside = join(root, `outside-${n}`);
    mkdirSync(outside);
    symlinkSync(outside, join(wt, 'secrets'));
    symlinkSync(join(root, `nowhere-${n}`), join(wt, 'apps'));
    const r = await copyIncludes(dir, wt);
    expect(r.copied).toEqual([]);
    expect(r.skipped).toEqual([
      { path: 'apps/web/.env', why: 'a symlink in the worktree is on its path' },
      { path: 'secrets/a.json', why: 'a symlink in the worktree is on its path' },
    ]);
    expect(readdirSync(outside)).toEqual([]);
    expect(existsSync(join(root, `nowhere-${n}`))).toBe(false);
  });

  it('never reads through a symlinked folder in the main checkout', async () => {
    const { dir, wt } = repo('secrets/\nsecrets/a.json\n');
    const outside = join(root, `outside-src-${n}`);
    write(join(outside, 'a.json'), 'private');
    symlinkSync(outside, join(dir, 'secrets'));
    const r = await copyIncludes(dir, wt);
    expect(r.copied).toEqual([]);
    expect(existsSync(join(wt, 'secrets'))).toBe(false);
  });

  it('linkOnPath finds a symlink at any depth and ignores missing parts', () => {
    const { dir } = repo(null, { 'a/b/c.txt': 'x' });
    symlinkSync(join(dir, 'a'), join(dir, 'link'));
    expect(linkOnPath(dir, 'a/b/c.txt')).toBe(false);
    expect(linkOnPath(dir, 'link/b/c.txt')).toBe(true);
    expect(linkOnPath(dir, 'missing/x')).toBe(false);
    expect(linkOnPath(dir, '.')).toBe(false);
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

describe('linkShared', () => {
  const status = (wt: string) => git(wt, 'status', '--porcelain');

  it('links a shared folder to the main checkout, which git still ignores in the worktree', async () => {
    const { dir, wt } = repo(null, { 'node_modules/pkg/index.js': 'x', 'apps/web/node_modules/a.js': 'y' });
    const r = await linkShared(dir, wt, ['node_modules', '/apps/web/node_modules/']);
    expect(r.linked).toEqual(['node_modules', 'apps/web/node_modules']);
    expect(lstatSync(join(wt, 'node_modules')).isSymbolicLink()).toBe(true);
    expect(readlinkSync(join(wt, 'node_modules'))).toBe(join(realpathSync(dir), 'node_modules'));
    expect(readFileSync(join(wt, 'node_modules/pkg/index.js'), 'utf8')).toBe('x');
    // node_modules/ matches only folders, so the plain path went into the repo's info/exclude.
    expect(status(wt)).toBe('');
    expect(readFileSync(join(dir, '.git/info/exclude'), 'utf8')).toContain('/node_modules\n');
    expect(status(dir)).toBe('');
    // Linked, not copied: what the worktree installs lands in the main checkout's folder.
    writeFileSync(join(wt, 'node_modules/new.js'), 'z');
    expect(existsSync(join(dir, 'node_modules/new.js'))).toBe(true);
    // The inventory sees nothing of its own in it.
    expect(sameAsMain(dir, wt, 'node_modules/')).toBe(true);
  });

  it('skips a folder the main checkout lacks, and one the worktree already has', async () => {
    const { dir, wt } = repo(null, { 'node_modules/a.js': 'x' });
    write(join(wt, 'node_modules/own.js'), 'mine');
    const r = await linkShared(dir, wt, ['.venv', 'node_modules']);
    expect(r.missing).toEqual(['.venv']);
    expect(r.linked).toEqual([]);
    expect(r.skipped).toEqual([{ path: 'node_modules', why: 'already in the worktree' }]);
    expect(lstatSync(join(wt, 'node_modules')).isSymbolicLink()).toBe(false);
  });

  it('refuses a folder the repo does not ignore, a file, a pattern and a path out of the repo', async () => {
    const { dir, wt } = repo(null, { 'vendor/a.rb': 'x', '.env': 'A=1' });
    const r = await linkShared(dir, wt, ['vendor', '.env', 'packages/*/node_modules', '../other']);
    expect(r.linked).toEqual([]);
    expect(r.skipped.map((s) => s.path)).toEqual(['vendor', '.env', 'packages/*/node_modules', '../other']);
    expect(existsSync(join(wt, 'vendor'))).toBe(false);
  });

  it('never links to a folder a symlink in the main checkout sends out of it', async () => {
    const { dir, wt } = repo(null);
    const outside = join(root, `outside-${n}`);
    mkdirSync(outside);
    symlinkSync(outside, join(dir, 'node_modules'));
    const r = await linkShared(dir, wt, ['node_modules']);
    expect(r.linked).toEqual([]);
    expect(r.skipped[0].why).toMatch(/leads out of it/);
  });

  it('never makes a link through a symlinked folder in the worktree', async () => {
    const { dir, wt } = repo(null, { 'apps/web/node_modules/a.js': 'x' });
    const elsewhere = join(root, `elsewhere-${n}`);
    mkdirSync(elsewhere);
    symlinkSync(elsewhere, join(wt, 'apps'));
    const r = await linkShared(dir, wt, ['apps/web/node_modules']);
    expect(r.linked).toEqual([]);
    expect(readdirSync(elsewhere)).toEqual([]);
  });

  it('fillWorktree merges the channel patterns with the repo file and links the shared folders', async () => {
    const { dir, wt } = repo('.env\n', { '.env': 'A=1', 'shopify.theme.toml': 's', 'node_modules/a.js': 'x' });
    await fillWorktree(dir, wt, { include: 'shopify.theme.toml\n', shared: 'node_modules\n.venv' });
    expect(readFileSync(join(wt, '.env'), 'utf8')).toBe('A=1');
    expect(readFileSync(join(wt, 'shopify.theme.toml'), 'utf8')).toBe('s');
    expect(lstatSync(join(wt, 'node_modules')).isSymbolicLink()).toBe(true);
    expect(status(wt)).toBe('');
  });
});
