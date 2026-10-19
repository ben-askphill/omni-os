import { closeSync, constants, fstatSync, ftruncateSync, openSync, readFileSync, rmSync, statSync, writeSync } from 'node:fs';

// One server per data dir. The server keeps the lock file open with an exclusive flock(2), which the
// kernel drops when the process ends, however it ends. So a lock is never stale and no pid is guessed at:
// the pid in the file only names the holder for the message a second server prints.

/** macOS open(2) flag: take an exclusive flock as the file opens. Node has no constant for it. */
const O_EXLOCK = 0x20;

/** The locks this process holds, by file: the descriptor holding each. */
const held = new Map<string, number>();

const readPid = (file: string) => {
  try {
    return Number.parseInt(readFileSync(file, 'utf8'), 10) || null;
  } catch {
    return null;
  }
};

function alive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

const pause = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/**
 * Takes the lock for this process. Returns the pid of the live server that holds it instead, or null
 * once this process does.
 */
export function takeLock(file: string): number | null {
  if (held.has(file)) return null;
  for (let attempt = 0; attempt < 50; attempt++) {
    let fd: number;
    try {
      fd = openSync(file, constants.O_RDWR | constants.O_CREAT | constants.O_NONBLOCK | O_EXLOCK, 0o644);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EAGAIN') throw err;
      // Held. Its server writes its pid right after it takes the lock: until then the file names the one before.
      const holder = readPid(file);
      if (holder && alive(holder)) return holder;
      pause(20);
      continue;
    }
    // A server that stops removes the file while it holds the lock: a lock on the file it removed is no lock.
    if (fstatSync(fd).ino !== statSync(file, { throwIfNoEntry: false })?.ino) {
      closeSync(fd);
      continue;
    }
    const pid = `${process.pid}\n`;
    writeSync(fd, pid, 0);
    ftruncateSync(fd, pid.length);
    held.set(file, fd);
    return null;
  }
  throw new Error(`could not take the lock at ${file}`);
}

/** Removes the lock if this process holds it. The file goes first, so no other server locks it on its way out. */
export function releaseLock(file: string) {
  const fd = held.get(file);
  if (fd === undefined) return;
  held.delete(file);
  rmSync(file, { force: true });
  closeSync(fd);
}
