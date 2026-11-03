import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkRepo, Updater, type UpdateDeps } from '../update.ts';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function git(cwd: string, ...cmd: string[]) {
  return execFileSync('git', cmd, { cwd, encoding: 'utf8' }).trim();
}

function commit(cwd: string, file: string, text: string) {
  writeFileSync(join(cwd, file), text);
  git(cwd, 'add', file);
  git(cwd, 'commit', '-q', '-m', `${file}: ${text}`);
  return git(cwd, 'rev-parse', 'HEAD');
}

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'update-'));
  dirs.push(root);
  const origin = join(root, 'origin');
  mkdirSync(origin);
  git(origin, 'init', '-q', '-b', 'main');
  git(origin, 'config', 'user.email', 't@example.com');
  git(origin, 'config', 'user.name', 't');
  const first = commit(origin, 'a.txt', 'one');
  const repo = join(root, 'repo');
  git(root, 'clone', '-q', origin, repo);
  git(repo, 'config', 'user.email', 't@example.com');
  git(repo, 'config', 'user.name', 't');
  return { origin, repo, first };
}

describe('checkRepo', () => {
  it('is level when the server runs main', async () => {
    const { repo, first } = setup();
    expect(await checkRepo(repo, first, true)).toEqual({ target: first, behind: 0, commits: [] });
  });

  it('finds commits pushed to origin once it fetches', async () => {
    const { origin, repo, first } = setup();
    commit(origin, 'b.txt', 'two');
    const third = commit(origin, 'c.txt', 'three');
    expect((await checkRepo(repo, first, false)).behind).toBe(0);
    const found = await checkRepo(repo, first, true);
    expect(found.target).toBe(third);
    expect(found.behind).toBe(2);
    expect(found.commits.map((c) => c.subject)).toEqual(['c.txt: three', 'b.txt: two']);
  });

  it('counts commits pulled into the local main', async () => {
    const { origin, repo, first } = setup();
    const second = commit(origin, 'b.txt', 'two');
    git(repo, 'pull', '-q', '--ff-only');
    expect(await checkRepo(repo, first, false)).toMatchObject({ target: second, behind: 1 });
  });

  it('takes the local main when it has commits origin does not', async () => {
    const { repo, first } = setup();
    const local = commit(repo, 'local.txt', 'mine');
    expect(await checkRepo(repo, first, true)).toMatchObject({ target: local, behind: 1 });
  });

  it('is not behind on a branch that already contains main', async () => {
    const { repo } = setup();
    git(repo, 'switch', '-q', '-c', 'feature');
    const ahead = commit(repo, 'f.txt', 'feature');
    git(repo, 'switch', '-q', 'main');
    expect((await checkRepo(repo, ahead, true)).behind).toBe(0);
  });
});

function deps(over: Partial<UpdateDeps> = {}): UpdateDeps & { restart: ReturnType<typeof vi.fn>; install: ReturnType<typeof vi.fn> } {
  return {
    root: '/nowhere',
    current: () => 'abc',
    supervised: () => true,
    bundled: false,
    enabled: () => true,
    runningTurns: () => 0,
    install: vi.fn(async () => null),
    restart: vi.fn(),
    sleep: async () => {},
    changed: () => {},
    ...over,
  } as never;
}

async function settle() {
  for (let i = 0; i < 20; i++) await new Promise((resolve) => setImmediate(resolve));
}

describe('Updater', () => {
  it('refuses without an app to start the server again', () => {
    const d = deps({ supervised: () => false });
    const u = new Updater(d);
    expect(u.apply()).toMatchObject({ ok: false });
    expect(u.view().canApply).toBe(false);
    expect(d.install).not.toHaveBeenCalled();
  });

  it('refuses in the desktop app, which updates itself, even though the app supervises the server', () => {
    const d = deps({ bundled: true });
    const u = new Updater(d);
    expect(u.view().canApply).toBe(false);
    expect(u.apply()).toEqual({ ok: false, error: expect.stringContaining('updates itself') });
    expect(d.install).not.toHaveBeenCalled();
  });

  it('installs, then restarts', async () => {
    const d = deps();
    const u = new Updater(d);
    expect(u.apply()).toEqual({ ok: true });
    await settle();
    expect(d.install).toHaveBeenCalledOnce();
    expect(d.restart).toHaveBeenCalledOnce();
    expect(u.view().phase).toBe('restarting');
  });

  it('waits for running turns first', async () => {
    let running = 2;
    const d = deps({ runningTurns: () => running, sleep: () => new Promise((resolve) => setTimeout(resolve, 1)) });
    const u = new Updater(d);
    u.apply();
    await settle();
    expect(u.view()).toMatchObject({ phase: 'waiting', waitingFor: 2 });
    expect(d.install).not.toHaveBeenCalled();
    running = 0;
    await vi.waitFor(() => expect(d.restart).toHaveBeenCalledOnce());
  });

  it('stops waiting on cancel', async () => {
    const d = deps({ runningTurns: () => 1, sleep: () => new Promise((resolve) => setTimeout(resolve, 1)) });
    const u = new Updater(d);
    u.apply();
    await settle();
    expect(u.cancel()).toBe(true);
    await vi.waitFor(() => expect(u.view().phase).toBe('idle'));
    expect(d.install).not.toHaveBeenCalled();
    expect(d.restart).not.toHaveBeenCalled();
  });

  it('reports a failed install and does not restart', async () => {
    const d = deps({ install: vi.fn(async () => 'Updating to main failed. dirty') as never });
    const u = new Updater(d);
    u.apply();
    await settle();
    expect(u.view()).toMatchObject({ phase: 'failed', error: 'Updating to main failed. dirty' });
    expect(d.restart).not.toHaveBeenCalled();
    u.dismiss();
    expect(u.view().phase).toBe('idle');
  });

  it('joins a second click to the first', async () => {
    const d = deps();
    const u = new Updater(d);
    u.apply();
    u.apply();
    await settle();
    expect(d.install).toHaveBeenCalledOnce();
  });
});
