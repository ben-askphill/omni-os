import { describe, expect, it } from 'vitest';
import type { DiskView } from '@omni/shared/disk-space.ts';
import { startRunner } from './runner-boot.ts';

// The free-space check with stand-ins for statfs, /proc/mounts and du: the data disk, a temp folder on another disk,
// a Linux /tmp with a per-user quota, the warning level, and that a change of level is logged and published once.

await startRunner({});
const { app } = await import('../app.ts');
const { bus } = await import('../bus.ts');
const { checkDisk, refreshDisk } = await import('../disk-space.ts');

const GB = 1024 ** 3;
const BS = 4096;
/** statfs for a disk of `total` GB with `free` GB available. */
const fs = (disks: Record<string, [free: number, total: number]>) => async (path: string) => {
  const [free, total] = disks[path];
  return { bavail: (free * GB) / BS, blocks: (total * GB) / BS, bsize: BS };
};
const tmpfs = (options: string) => () => [
  { dir: '/', type: 'ext4', options: ['rw'] },
  { dir: '/tmp', type: 'tmpfs', options: options.split(',') },
];

describe('checkDisk', () => {
  it('reports only the data disk when the temp folder is on it', async () => {
    const v = await checkDisk({ dataDir: '/data', tmpDir: '/var/tmp', statfs: fs({ '/data': [180, 460] }), mounts: () => [], sameDevice: async () => true });
    expect(v.volumes).toEqual([{ kind: 'data', path: '/data', freeBytes: 180 * GB, totalBytes: 460 * GB, quota: false, level: 'ok' }]);
    expect(v.level).toBe('ok');
  });

  it('adds a temp folder on another disk, and takes the worse level', async () => {
    const v = await checkDisk({ dataDir: '/data', tmpDir: '/scratch', statfs: fs({ '/data': [180, 460], '/scratch': [3, 200] }), mounts: () => [], sameDevice: async () => false });
    expect(v.volumes.map((x) => [x.kind, x.level])).toEqual([['data', 'ok'], ['tmp', 'critical']]);
    expect(v.level).toBe('critical');
  });

  it("estimates a Linux /tmp user quota as 80% of the tmpfs less what the user's files use", async () => {
    // 32 GB tmpfs with 25 GB free, but this user already has 22 GB of the 25.6 GB they may use.
    const v = await checkDisk({ dataDir: '/data', tmpDir: '/tmp', statfs: fs({ '/data': [180, 460], '/tmp': [25, 32] }), mounts: tmpfs('rw,nosuid,size=33554432k,usrquota'), userUse: async () => 22 * GB });
    const t = v.volumes.find((x) => x.kind === 'tmp')!;
    expect(t.quota).toBe(true);
    expect(t.totalBytes).toBe(Math.floor(32 * GB * 0.8));
    expect(t.freeBytes).toBe(Math.floor(32 * GB * 0.8) - 22 * GB);
    expect(t.level).toBe('low');
  });

  it('takes the quota from usrquota_block_hardlimit when the mount sets it', async () => {
    const v = await checkDisk({ dataDir: '/data', tmpDir: '/tmp', statfs: fs({ '/data': [180, 460], '/tmp': [30, 32] }), mounts: tmpfs('rw,usrquota,usrquota_block_hardlimit=10g'), userUse: async () => 9.8 * GB });
    const t = v.volumes.find((x) => x.kind === 'tmp')!;
    expect(t.totalBytes).toBe(10 * GB);
    expect(t.level).toBe('critical');
  });
});

describe('refreshDisk and GET /api/disk', () => {
  it('logs and publishes a change of level once, and serves the last check', async () => {
    const events: unknown[] = [];
    const onFeed = (e: { type: string }) => e.type === 'disk' && events.push(e);
    bus.on('feed', onFeed);
    const warn: string[] = [];
    const orig = console.warn;
    console.warn = (...a: unknown[]) => void warn.push(a.join(' '));
    try {
      const low = { dataDir: '/data', tmpDir: '/data', statfs: fs({ '/data': [12, 460] }), mounts: () => [], sameDevice: async () => true };
      await refreshDisk(low);
      await refreshDisk(low);
      expect(events).toEqual([{ type: 'disk', level: 'low' }]);
      expect(warn.filter((l) => l.startsWith('[disk]'))).toEqual(["[disk] space is running low: 12 GB free of 460 GB on the disk with Omni's data (/data)"]);
      const body = (await (await app.request('/api/disk')).json()) as DiskView;
      expect(body).toMatchObject({ level: 'low', error: null, volumes: [{ kind: 'data', freeBytes: 12 * GB }] });
      expect(body.checkedAt).not.toBeNull();

      await refreshDisk({ ...low, statfs: fs({ '/data': [180, 460] }) });
      expect(events).toEqual([{ type: 'disk', level: 'low' }, { type: 'disk', level: 'ok' }]);
    } finally {
      console.warn = orig;
      bus.off('feed', onFeed);
    }
  });

  it('keeps the last view and says why when a check fails', async () => {
    const v = await refreshDisk({ dataDir: '/nowhere', statfs: async () => Promise.reject(new Error('ENOENT: no such file')) });
    expect(v.error).toMatch(/ENOENT/);
  });
});
