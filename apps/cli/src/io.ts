// Everything the CLI touches outside itself, in one object, so the tests drive each command with a fake one and
// the real one (node-io.ts) stays a thin layer over Node.
import type { Fetch } from '@omni/client-core';

export interface RunResult {
  /** The exit code, or null when it was killed (its timeout). */
  code: number | null;
  stdout: string;
  stderr: string;
  /** The program is not installed (not on PATH). */
  missing: boolean;
}

export interface FileStat {
  mode: number;
  size: number;
  mtimeMs: number;
  dir: boolean;
}

export interface Io {
  env: Readonly<Record<string, string | undefined>>;
  cwd: string;
  platform: NodeJS.Platform;
  /** Written as given: the caller ends its lines. */
  out(text: string): void;
  err(text: string): void;
  /** Everything piped in, or null when stdin is a terminal. */
  stdin(): Promise<string | null>;
  fetch: Fetch;
  sleep(ms: number): Promise<void>;
  now(): number;
  /** Milliseconds on a monotonic clock, for intervals: unlike now(), it never jumps when the system time is set. */
  clock(): number;
  uuid(): string;
  /** Runs a program for its output. Never rejects. */
  run(bin: string, args: string[], timeoutMs: number): Promise<RunResult>;
  /** Starts a program and leaves it running on its own (the app, a browser). False when it could not start. */
  launch(bin: string, args: string[]): Promise<boolean>;
  readFile(path: string): string | null;
  stat(path: string): FileStat | null;
  /** Free and total bytes of the disk `path` is on, or null when it cannot be read. */
  disk(path: string): { free: number; total: number } | null;
  /** The last `bytes` of a file, or null. */
  tail(path: string, bytes: number): string | null;
}

/** What a command answers: its exit code (docs/user/cli.md lists them). */
export const EXIT = {
  ok: 0,
  /** `--wait`: the thread failed or was stopped. `doctor`: a check failed. */
  failed: 1,
  /** `--wait`: the thread needs you (a question, a usage limit, a setup failure). */
  needsYou: 2,
  /** Omni could not do it: the server is down, refused the token, or refused the request. */
  error: 3,
  /** The command line was wrong. */
  usage: 64,
} as const;

/** A wrong command line: the message, then a pointer to the command's help. */
export class UsageError extends Error {
  constructor(
    message: string,
    readonly command: string | null = null,
  ) {
    super(message);
    this.name = 'UsageError';
  }
}

/** A refusal the CLI makes itself (no such machine, nothing to open). Exits with EXIT.error. */
export class CliError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CliError';
  }
}
