import { describe, expect, it } from 'vitest';
import { diskLevel, diskNotice, worstLevel, type DiskView, type DiskVolume } from '../disk-space.ts';

const GB = 1024 ** 3;
const vol = (over: Partial<DiskVolume>): DiskVolume => ({ kind: 'data', path: '/d', freeBytes: 100 * GB, totalBytes: 460 * GB, quota: false, level: 'ok', ...over });
const view = (volumes: DiskVolume[]): DiskView => ({ level: worstLevel(volumes.map((v) => v.level)), volumes, checkedAt: '2026-11-09T12:00:00Z', error: null });

describe('diskLevel', () => {
  it('on a large disk: low below 20 GB, critical below 5 GB', () => {
    expect(diskLevel(21 * GB, 460 * GB)).toBe('ok');
    expect(diskLevel(19 * GB, 460 * GB)).toBe('low');
    expect(diskLevel(4.9 * GB, 460 * GB)).toBe('critical');
    expect(diskLevel(2.3 * GB, 460 * GB)).toBe('critical');
  });

  it('on a small volume such as a 26 GB /tmp quota: low below 15%, critical below 5%', () => {
    expect(diskLevel(10 * GB, 26 * GB)).toBe('ok');
    expect(diskLevel(3.5 * GB, 26 * GB)).toBe('low');
    expect(diskLevel(0.7 * GB, 26 * GB)).toBe('critical');
  });
});

describe('diskNotice', () => {
  it('says nothing while every volume is ok', () => {
    expect(diskNotice(view([vol({})]))).toBeNull();
    expect(diskNotice(null)).toBeNull();
  });

  it('names the tightest volume, critical first', () => {
    const n = diskNotice(view([vol({ freeBytes: 12 * GB, level: 'low' }), vol({ kind: 'tmp', path: '/tmp', quota: true, freeBytes: 0.8 * GB, totalBytes: 26 * GB, level: 'critical' })]));
    expect(n).toEqual({
      level: 'critical',
      text: 'Almost out of space: 819 MB left on your /tmp quota. Threads stop working when it fills.',
      detail: 'Delete old temp folders, or free space in Settings > Worktrees.',
    });
  });

  it('warns about the data disk when it is low', () => {
    expect(diskNotice(view([vol({ freeBytes: 12.4 * GB, level: 'low' })]))).toMatchObject({ level: 'low', text: "Space is running low: 12 GB left on the disk with Omni's data." });
  });
});
