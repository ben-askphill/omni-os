import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { chooseDataDir, choiceFile, legacyRepos, planDataDir, readChoice, repoFromDesktopEntry } from '../src/backend/data-dir.ts';
import type { PlatformDirs } from '../src/paths.ts';

describe('legacy checkouts', () => {
  it('reads the Linux launcher Exec line, behind uwsm or not, quoted or not', () => {
    expect(repoFromDesktopEntry('[Desktop Entry]\nExec=/usr/bin/uwsm-app -- /home/me/omni-os/scripts/omni-linux.sh\n')).toBe('/home/me/omni-os');
    expect(repoFromDesktopEntry('Exec=/src/omni/scripts/omni-linux.sh')).toBe('/src/omni');
    expect(repoFromDesktopEntry('Exec="/home/me/my code/scripts/omni-linux.sh"')).toBe('/home/me/my code');
    expect(repoFromDesktopEntry('Exec=/usr/bin/chromium %U')).toBeNull();
    expect(repoFromDesktopEntry('Name=Omni')).toBeNull();
  });

  it('takes the SwiftUI app repoPath, then its default checkout', () => {
    expect(legacyRepos({ platform: 'darwin', home: '/Users/me', macRepoPath: '~/code/omni', linuxDesktopEntry: null })).toEqual([
      '/Users/me/code/omni',
      '/Users/me/omni-os',
    ]);
    expect(legacyRepos({ platform: 'darwin', home: '/Users/me', macRepoPath: null, linuxDesktopEntry: null })).toEqual(['/Users/me/omni-os']);
    expect(legacyRepos({ platform: 'darwin', home: '/Users/me', macRepoPath: '  ', linuxDesktopEntry: null })).toEqual(['/Users/me/omni-os']);
    expect(legacyRepos({ platform: 'linux', home: '/home/me', macRepoPath: null, linuxDesktopEntry: null })).toEqual([]);
    expect(legacyRepos({ platform: 'linux', home: '/home/me', macRepoPath: null, linuxDesktopEntry: 'Exec=/r/scripts/omni-linux.sh' })).toEqual(['/r']);
  });
});

describe('planDataDir', () => {
  const base = { fallback: '/fresh/data', stored: null, repos: ['/repo'] };
  const has = (...dirs: string[]) => (dir: string) => dirs.includes(dir);

  it('asks when the old data has a database and the default has none', () => {
    expect(planDataDir({ ...base, hasDatabase: has('/repo/data') })).toEqual({ kind: 'ask', existing: '/repo/data', fresh: '/fresh/data' });
  });

  it('uses the default when it has data, or when there is no old data', () => {
    expect(planDataDir({ ...base, hasDatabase: has('/repo/data', '/fresh/data') })).toEqual({ kind: 'use', dir: '/fresh/data' });
    expect(planDataDir({ ...base, hasDatabase: has() })).toEqual({ kind: 'use', dir: '/fresh/data' });
    expect(planDataDir({ ...base, repos: [], hasDatabase: has('/repo/data') })).toEqual({ kind: 'use', dir: '/fresh/data' });
  });

  it('keeps an earlier answer', () => {
    expect(planDataDir({ ...base, stored: '/repo/data', hasDatabase: has() })).toEqual({ kind: 'use', dir: '/repo/data' });
  });

  it('does not ask about the default dir itself', () => {
    expect(planDataDir({ ...base, fallback: '/repo/data', hasDatabase: has() })).toEqual({ kind: 'use', dir: '/repo/data' });
  });
});

describe('chooseDataDir', () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  function setup() {
    const root = mkdtempSync(join(tmpdir(), 'omni-data-dir-'));
    roots.push(root);
    const repo = join(root, 'omni-os');
    mkdirSync(join(repo, 'data'), { recursive: true });
    writeFileSync(join(repo, 'data', 'omni.db'), 'old');
    const dirs: PlatformDirs = { platform: 'darwin', home: root, env: {}, userData: join(root, 'userData'), logs: join(root, 'logs') };
    const fallback = join(root, 'userData', 'data');
    return { root, repo, dirs, fallback };
  }

  const snapshot = (dir: string) => readdirSync(dir).map((name) => [name, statSync(join(dir, name)).mtimeMs]);

  it('asks once, remembers the answer, and leaves the old folder as it was', async () => {
    const { repo, dirs, fallback } = setup();
    const before = snapshot(join(repo, 'data'));
    const asked: string[][] = [];
    const deps = {
      readMacRepoPath: async () => repo,
      ask: async (existing: string, fresh: string) => {
        asked.push([existing, fresh]);
        return 'existing' as const;
      },
    };
    expect(await chooseDataDir({ dirs, fallback, dev: false }, deps)).toBe(join(repo, 'data'));
    expect(asked).toEqual([[join(repo, 'data'), fallback]]);
    expect(readChoice(choiceFile(dirs.userData))).toBe(join(repo, 'data'));
    expect(await chooseDataDir({ dirs, fallback, dev: false }, deps)).toBe(join(repo, 'data'));
    expect(asked).toHaveLength(1);
    expect(snapshot(join(repo, 'data'))).toEqual(before);
  });

  it('quits without remembering anything when the dialog is dismissed', async () => {
    const { repo, dirs, fallback } = setup();
    expect(await chooseDataDir({ dirs, fallback, dev: false }, { readMacRepoPath: async () => repo, ask: async () => 'quit' as const })).toBeNull();
    expect(readChoice(choiceFile(dirs.userData))).toBeNull();
  });

  it('remembers Start Fresh too', async () => {
    const { dirs, fallback } = setup();
    const deps = { readMacRepoPath: async () => null, ask: async () => 'fresh' as const };
    expect(await chooseDataDir({ dirs, fallback, dev: false }, deps)).toBe(fallback);
    expect(readChoice(choiceFile(dirs.userData))).toBe(fallback);
  });

  it('finds the Linux launcher checkout from its desktop file', async () => {
    const { root, repo, fallback } = setup();
    const dirs: PlatformDirs = { platform: 'linux', home: root, env: {}, userData: join(root, 'userData'), logs: join(root, 'logs') };
    mkdirSync(join(root, '.local/share/applications'), { recursive: true });
    writeFileSync(join(root, '.local/share/applications/omni-os.desktop'), `Exec=/usr/bin/uwsm-app -- ${repo}/scripts/omni-linux.sh\n`);
    let asked = false;
    const dir = await chooseDataDir({ dirs, fallback, dev: false }, { ask: async () => ((asked = true), 'existing' as const) });
    expect(asked).toBe(true);
    expect(dir).toBe(join(repo, 'data'));
  });

  it('never asks in development', async () => {
    const { dirs, fallback } = setup();
    const dir = await chooseDataDir({ dirs, fallback, dev: true }, { ask: async () => { throw new Error('asked'); } });
    expect(dir).toBe(fallback);
  });
});
