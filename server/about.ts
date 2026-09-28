import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { config, paths, ROOT } from './config.ts';

/** The commit checked out at root, or null when git can't say. */
export function gitHead(root: string): string | null {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 }).trim() || null;
  } catch {
    return null;
  }
}

/**
 * Which server this is, read once at boot: GET /api/status reports it as `server`, so a client can tell
 * whether the server runs older code than the checkout and which process to stop. index.ts sets the port it bound.
 */
export const about = {
  version: JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version as string,
  pid: process.pid,
  root: ROOT,
  dataDir: paths.data,
  gitHead: gitHead(ROOT),
  startedAt: new Date().toISOString(),
  port: config.port,
};
