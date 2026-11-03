// Where the app keeps the server's data and log by default, per OS. Pure, so tests can pin each answer.
import { join } from 'node:path';

export interface PlatformDirs {
  platform: NodeJS.Platform;
  home: string;
  env: NodeJS.ProcessEnv;
  /** Electron's userData folder (macOS: ~/Library/Application Support/Omni). */
  userData: string;
  /** Where the server's log goes: logsDir's answer. */
  logs: string;
}

/** The server's data dir when no flag or earlier choice names one. Development uses the checkout's data/, as npm run dev does. */
export function defaultDataDir(dirs: PlatformDirs, input: { dev: boolean; repo: string | null }): string {
  if (input.dev && input.repo) return join(input.repo, 'data');
  if (dirs.platform === 'darwin') return join(dirs.userData, 'data');
  const base = dirs.env.XDG_DATA_HOME || join(dirs.home, '.local', 'share');
  return join(base, 'omni-os', 'data');
}

/**
 * The logs folder: macOS's ~/Library/Logs/Omni, the XDG state folder elsewhere, or one inside a `--user-data-dir`
 * given on the command line. The default one is the installed app's, and older Omni apps wrote their server logs
 * there too, so a dev or QA run keeps its own.
 */
export function logsDir(input: {
  platform: NodeJS.Platform;
  home: string;
  env: NodeJS.ProcessEnv;
  userData: string;
  electronLogs: string;
  customUserData: boolean;
}): string {
  if (input.customUserData) return join(input.userData, 'logs');
  if (input.platform === 'darwin') return input.electronLogs;
  return join(input.env.XDG_STATE_HOME || join(input.home, '.local', 'state'), 'omni-os');
}

export function serverLogFile(dirs: PlatformDirs): string {
  return join(dirs.logs, 'server.log');
}
