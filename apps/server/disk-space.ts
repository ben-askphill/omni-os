// Watches free disk space: the disk with Omni's data folder and, when it is elsewhere or has a quota, the temp folder
// the agent CLIs write their command output to. Checked a few seconds after startup and every 10 minutes. A change of
// level is logged and published on the feed, so the clients show or drop their warning (packages/shared/disk-space.ts)
// and the Conductor's disk_space tool reads the same view.
//
// On Linux, /tmp is often a tmpfs mounted with `usrquota` (systemd since v256), where each user may fill only part of
// it (80% by default) and statfs reports the whole tmpfs. Node cannot read the quota itself, so this estimates it:
// the limit from the mount options (usrquota_block_hardlimit) or 80% of the size, and the use from `du` over this
// user's own entries in the folder.
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { lstat, readdir, stat, statfs } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { diskLevel, diskLine, worstLevel, type DiskView, type DiskVolume } from '@omni/shared/disk-space.ts';
import { publishFeed } from './bus.ts';
import { paths } from './config.ts';

const run = promisify(execFile);

/** systemd's default per-user share of a tmpfs mounted with usrquota. */
const TMPFS_USER_SHARE = 0.8;
const EVERY_MS = 10 * 60 * 1000;
const FIRST_MS = 5_000;

interface Mount {
  dir: string;
  type: string;
  options: string[];
}

/** /proc/mounts, or nothing off Linux. */
function mounts(): Mount[] {
  try {
    return readFileSync('/proc/mounts', 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [, dir, type, options] = line.split(' ');
        return { dir: dir.replace(/\\040/g, ' '), type, options: (options ?? '').split(',') };
      });
  } catch {
    return [];
  }
}

/** The mount path is on: the longest mount point it starts with. */
const mountOf = (path: string, all: Mount[]) =>
  all.filter((m) => path === m.dir || path.startsWith(m.dir.endsWith('/') ? m.dir : `${m.dir}/`)).sort((a, b) => b.dir.length - a.dir.length)[0];

/** A size in a mount option: 26843545600, 25g, 512m. */
function optionBytes(v: string): number | null {
  const m = /^(\d+)([kmgt]?)$/i.exec(v.trim());
  if (!m) return null;
  return Number(m[1]) * 1024 ** ' kmgt'.indexOf((m[2] || ' ').toLowerCase());
}

/** What this user's own entries directly in dir use, at the lowest priority. Entries of other users are not readable anyway. */
async function userUse(dir: string, uid: number): Promise<number> {
  const mine: string[] = [];
  for (const name of await readdir(dir).catch(() => [] as string[])) {
    const s = await lstat(join(dir, name)).catch(() => null);
    if (s && s.uid === uid) mine.push(join(dir, name));
  }
  let bytes = 0;
  // A few hundred paths per du call, so the argument list stays short.
  for (let i = 0; i < mine.length; i += 200) {
    const out = await run('nice', ['-n', '19', 'du', '-skx', ...mine.slice(i, i + 200)], { timeout: 120_000, maxBuffer: 16 * 1024 * 1024 }).then(
      (r) => r.stdout,
      (err: { stdout?: string }) => err.stdout ?? '',
    );
    for (const line of out.split('\n')) bytes += (Number(line.split('\t')[0]) || 0) * 1024;
  }
  return bytes;
}

export interface CheckOptions {
  dataDir?: string;
  tmpDir?: string;
  /** Stand-ins for tests. */
  statfs?: (path: string) => Promise<{ bavail: number; blocks: number; bsize: number }>;
  mounts?: () => Mount[];
  userUse?: (dir: string) => Promise<number>;
  sameDevice?: (a: string, b: string) => Promise<boolean>;
}

const sameDev = async (a: string, b: string) => {
  const [x, y] = await Promise.all([stat(a), stat(b)]);
  return x.dev === y.dev;
};

/** One look at the data disk and the temp folder. Throws when the data disk cannot be read. */
export async function checkDisk(opts: CheckOptions = {}): Promise<Omit<DiskView, 'checkedAt' | 'error'>> {
  const fsOf = opts.statfs ?? statfs;
  const data = opts.dataDir ?? paths.data;
  const tmp = opts.tmpDir ?? tmpdir();
  const volume = async (kind: DiskVolume['kind'], path: string): Promise<DiskVolume> => {
    const s = await fsOf(path);
    const freeBytes = s.bavail * s.bsize;
    const totalBytes = s.blocks * s.bsize;
    return { kind, path, freeBytes, totalBytes, quota: false, level: diskLevel(freeBytes, totalBytes) };
  };
  const volumes = [await volume('data', data)];

  const m = mountOf(tmp, (opts.mounts ?? mounts)());
  const quota = m?.type === 'tmpfs' && m.options.some((o) => o === 'usrquota' || o.startsWith('usrquota_'));
  const separate = quota || !(await (opts.sameDevice ?? sameDev)(data, tmp).catch(() => true));
  if (separate) {
    const t = await volume('tmp', tmp).catch(() => null);
    if (t && quota) {
      const set = m!.options.find((o) => o.startsWith('usrquota_block_hardlimit='));
      const limit = (set && optionBytes(set.split('=')[1])) || Math.floor(t.totalBytes * TMPFS_USER_SHARE);
      const used = await (opts.userUse ?? ((d: string) => userUse(d, process.getuid?.() ?? -1)))(tmp);
      t.quota = true;
      t.totalBytes = limit;
      t.freeBytes = Math.max(0, Math.min(t.freeBytes, limit - used));
      t.level = diskLevel(t.freeBytes, t.totalBytes);
    }
    if (t) volumes.push(t);
  }
  return { level: worstLevel(volumes.map((v) => v.level)), volumes };
}

let view: DiskView = { level: 'ok', volumes: [], checkedAt: null, error: null };

/** The last check. */
export const diskView = (): DiskView => ({ ...view, volumes: view.volumes.map((v) => ({ ...v })) });

/** Check now, keep the result, and log and publish a change of level. */
export async function refreshDisk(opts: CheckOptions = {}): Promise<DiskView> {
  const before = view.level;
  try {
    view = { ...(await checkDisk(opts)), checkedAt: new Date().toISOString(), error: null };
  } catch (err) {
    view = { ...view, checkedAt: new Date().toISOString(), error: err instanceof Error ? err.message : String(err) };
  }
  if (view.level !== before) {
    const lines = view.volumes.filter((v) => v.level !== 'ok').map(diskLine);
    if (view.level === 'ok') console.log('[disk] free space is back above the warning level');
    else console.warn(`[disk] ${view.level === 'critical' ? 'almost out of space' : 'space is running low'}: ${lines.join('; ')}`);
    publishFeed({ type: 'disk', level: view.level });
  }
  return diskView();
}

let started = false;

/** A few seconds after startup, then every 10 minutes. */
export function startDiskWatch() {
  if (started) return;
  started = true;
  const tick = () => void refreshDisk().catch(() => {});
  setTimeout(tick, FIRST_MS).unref();
  setInterval(tick, EVERY_MS).unref();
}

