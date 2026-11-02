// Where the app keeps the server's data and log by default, per OS. Pure, so tests can pin each answer.
import { join } from 'node:path';

export interface PlatformDirs {
  platform: NodeJS.Platform;
  home: string;
  env: NodeJS.ProcessEnv;
  /** Electron's userData folder (macOS: ~/Library/Application Support/Omni). */
  userData: string;
  /** Electron's logs folder (macOS: ~/Library/Logs/Omni). */
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
 * Electron's logs folder, or one inside a `--user-data-dir` given on the command line. Electron keeps
 * ~/Library/Logs/<name> whatever the user-data folder is, and that is the installed app's log, and the SwiftUI
 * app's server log too, so a dev or QA run would write its server's output into theirs.
 */
export function logsDir(input: { userData: string; electronLogs: string; customUserData: boolean }): string {
  return input.customUserData ? join(input.userData, 'logs') : input.electronLogs;
}

export function serverLogFile(dirs: PlatformDirs): string {
  if (dirs.platform === 'darwin') return join(dirs.logs, 'server.log');
  const base = dirs.env.XDG_STATE_HOME || join(dirs.home, '.local', 'state');
  return join(base, 'omni-os', 'server.log');
}
