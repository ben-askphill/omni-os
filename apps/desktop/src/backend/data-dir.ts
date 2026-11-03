// Which data dir the server uses when no --data-dir names one: the default for this OS, unless the user picked
// another once (such as the checkout's data/ the SwiftUI app or the Linux launcher used).
// Looking for the old data only reads: it never copies, moves or writes into the old folder.
import { dialog } from 'electron';
import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import type { PlatformDirs } from '../paths.ts';
import { writeJsonAtomic } from '../settings.ts';

/** The SwiftUI app's UserDefaults domain and key for its checkout (OmniKit/ServerSettings.swift). */
export const MAC_DEFAULTS_DOMAIN = 'com.omni-os.mac';
export const MAC_REPO_KEY = 'repoPath';
/** The SwiftUI app's checkout when its repoPath is blank. */
export const MAC_DEFAULT_REPO = '~/omni-os';
const LINUX_SCRIPT = '/scripts/omni-linux.sh';

export interface LegacySources {
  platform: NodeJS.Platform;
  home: string;
  /** `defaults read com.omni-os.mac repoPath`: null when the key is unset, '' when blank. */
  macRepoPath: string | null;
  /** ~/.local/share/applications/omni-os.desktop, or null when there is none. */
  linuxDesktopEntry: string | null;
}

export function expandHome(path: string, home: string): string {
  if (path === '~') return home;
  return path.startsWith('~/') ? join(home, path.slice(2)) : path;
}

/** The checkout in the Linux launcher's Exec line, which runs <repo>/scripts/omni-linux.sh, perhaps behind uwsm. */
export function repoFromDesktopEntry(text: string): string | null {
  const line = text.split('\n').find((item) => item.startsWith('Exec='));
  if (!line) return null;
  const value = line.slice('Exec='.length).trim();
  const tokens = value.match(/"(?:[^"\\]|\\.)*"|\S+/g) ?? [];
  for (const token of tokens) {
    const unquoted = token.startsWith('"') ? token.slice(1, -1).replace(/\\(.)/g, '$1') : token;
    if (isAbsolute(unquoted) && unquoted.endsWith(LINUX_SCRIPT)) return unquoted.slice(0, -LINUX_SCRIPT.length);
  }
  return null;
}

/**
 * The checkouts the old apps ran their server from, most likely first. Neither passed OMNI_DATA_DIR outside tests,
 * so each kept its data in <repo>/data.
 */
export function legacyRepos(input: LegacySources): string[] {
  if (input.platform === 'darwin') {
    const typed = input.macRepoPath?.trim();
    const repos = [typed ? expandHome(typed, input.home) : null, expandHome(MAC_DEFAULT_REPO, input.home)];
    return [...new Set(repos.filter((repo): repo is string => repo !== null))];
  }
  if (input.platform === 'linux' && input.linuxDesktopEntry) {
    const repo = repoFromDesktopEntry(input.linuxDesktopEntry);
    return repo ? [repo] : [];
  }
  return [];
}

export type DataDirPlan =
  | { kind: 'use'; dir: string }
  /** Old data exists and the default has none: ask once, then remember the answer. */
  | { kind: 'ask'; existing: string; fresh: string };

/** Development never gets here: chooseDataDir gives it the fallback before it reads anything. */
export function planDataDir(input: {
  fallback: string;
  stored: string | null;
  repos: string[];
  hasDatabase: (dir: string) => boolean;
}): DataDirPlan {
  if (input.stored) return { kind: 'use', dir: input.stored };
  if (input.hasDatabase(input.fallback)) return { kind: 'use', dir: input.fallback };
  const existing = input.repos.map((repo) => join(repo, 'data')).find((dir) => dir !== input.fallback && input.hasDatabase(dir));
  return existing ? { kind: 'ask', existing, fresh: input.fallback } : { kind: 'use', dir: input.fallback };
}

export function choiceFile(userData: string): string {
  return join(userData, 'data-dir.json');
}

export function readChoice(file: string): string | null {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as { dataDir?: unknown };
    return typeof parsed.dataDir === 'string' && isAbsolute(parsed.dataDir) ? parsed.dataDir : null;
  } catch {
    return null;
  }
}

export function writeChoice(file: string, dataDir: string): void {
  writeJsonAtomic(file, { dataDir });
}

function readMacRepoPath(): Promise<string | null> {
  return new Promise((resolve) => {
    execFile('defaults', ['read', MAC_DEFAULTS_DOMAIN, MAC_REPO_KEY], { timeout: 5000 }, (err, stdout) => {
      resolve(err ? null : stdout.replace(/\n$/, ''));
    });
  });
}

function readText(file: string): string | null {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

export type DataDirAnswer = 'existing' | 'fresh' | 'quit';

/** Asks whether to keep using the old data in place. Escape quits without deciding: a choice is remembered for good. */
async function askUseExisting(existing: string, fresh: string): Promise<DataDirAnswer> {
  const { response } = await dialog.showMessageBox({
    type: 'question',
    message: 'Use your existing Omni data?',
    detail:
      `Omni found the data an earlier Omni app used, in ${existing}. Keep using it there, or start fresh in ${fresh}.\n\n` +
      'Nothing is copied or moved. Omni asks once.',
    buttons: ['Use Existing Data', 'Start Fresh', 'Quit'],
    defaultId: 0,
    cancelId: 2,
    noLink: true,
  });
  return response === 0 ? 'existing' : response === 1 ? 'fresh' : 'quit';
}

export interface ChooseDeps {
  readMacRepoPath: () => Promise<string | null>;
  readFile: (file: string) => string | null;
  exists: (path: string) => boolean;
  ask: (existing: string, fresh: string) => Promise<DataDirAnswer>;
}

export async function chooseDataDir(
  input: { dirs: PlatformDirs; fallback: string; dev: boolean },
  deps: Partial<ChooseDeps> = {},
): Promise<string | null> {
  if (input.dev) return input.fallback;
  const d: ChooseDeps = {
    readMacRepoPath: deps.readMacRepoPath ?? readMacRepoPath,
    readFile: deps.readFile ?? readText,
    exists: deps.exists ?? existsSync,
    ask: deps.ask ?? askUseExisting,
  };
  const file = choiceFile(input.dirs.userData);
  const stored = readChoice(file);
  let repos: string[] = [];
  if (!stored) {
    const macRepoPath = input.dirs.platform === 'darwin' ? await d.readMacRepoPath() : null;
    const linuxDesktopEntry =
      input.dirs.platform === 'linux' ? d.readFile(join(input.dirs.home, '.local/share/applications/omni-os.desktop')) : null;
    repos = legacyRepos({ platform: input.dirs.platform, home: input.dirs.home, macRepoPath, linuxDesktopEntry });
  }
  const plan = planDataDir({
    fallback: input.fallback,
    stored,
    repos,
    hasDatabase: (dir) => d.exists(join(dir, 'omni.db')),
  });
  if (plan.kind === 'use') return plan.dir;
  const answer = await d.ask(plan.existing, plan.fresh);
  if (answer === 'quit') return null;
  const dir = answer === 'existing' ? plan.existing : plan.fresh;
  writeChoice(file, dir);
  return dir;
}
