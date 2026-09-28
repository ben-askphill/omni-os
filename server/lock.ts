import { execFileSync } from 'node:child_process';
import { linkSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';

// One server per data dir: a pid file the server holds while it runs. It is written whole before it
// appears (a hard link to a file that already holds the pid), so a reader never sees it empty.

const readPid = (file: string) => {
  try {
    return Number.parseInt(readFileSync(file, 'utf8'), 10) || null;
  } catch {
    return null;
  }
};

/** True while pid is a live node process. A pid a crash or reboot handed to another program doesn't count. */
function alive(pid: number) {
  try {
    process.kill(pid, 0);
    return basename(execFileSync('/bin/ps', ['-p', String(pid), '-o', 'comm='], { encoding: 'utf8' }).trim()).startsWith('node');
  } catch {
    return false;
  }
}

/**
 * Takes the lock for this process. Returns the pid of the live server that holds it instead, or null
 * once this process does. A lock whose server is gone is taken over.
 */
export function takeLock(file: string): number | null {
  const mine = `${file}.${process.pid}`;
  for (let attempt = 0; attempt < 5; attempt++) {
    writeFileSync(mine, `${process.pid}\n`);
    try {
      linkSync(mine, file);
      return null;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    } finally {
      rmSync(mine, { force: true });
    }
    const holder = readPid(file);
    if (holder && holder !== process.pid && alive(holder)) return holder;
    // Stale. Remove it unless another server took it over since.
    if (readPid(file) === holder) rmSync(file, { force: true });
  }
  throw new Error(`could not take the lock at ${file}`);
}

/** Removes the lock if this process holds it. */
export function releaseLock(file: string) {
  if (readPid(file) === process.pid) rmSync(file, { force: true });
}
