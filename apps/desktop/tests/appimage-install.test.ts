import * as fs from 'node:fs';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installAppImage, installTarget } from '../src/appimage-install.ts';

let root: string;
let apps: string;
let pending: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'omni-appimage-'));
  apps = join(root, 'Applications');
  pending = join(root, 'cache', 'pending');
  fs.mkdirSync(apps);
  fs.mkdirSync(pending, { recursive: true });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const put = (path: string, text: string) => {
  writeFileSync(path, text);
  return path;
};

describe('installTarget', () => {
  it('overwrites an AppImage without a version in its name, and follows the download\'s name when it has one', () => {
    expect(installTarget('/a/Omni.AppImage', '/c/Omni-2.1.0-linux-x86_64.AppImage')).toBe('/a/Omni.AppImage');
    expect(installTarget('/a/Omni-2.0.2.AppImage', '/c/Omni-2.1.0.AppImage')).toBe('/a/Omni-2.1.0.AppImage');
    expect(installTarget('/a/Omni-2.1.0.AppImage', '/c/Omni-2.1.0.AppImage')).toBe('/a/Omni-2.1.0.AppImage');
  });
});

describe('installAppImage', () => {
  it('puts the download in the AppImage\'s place, executable, and clears it from the cache', () => {
    const appImage = put(join(apps, 'Omni.AppImage'), 'old');
    const download = put(join(pending, 'Omni-2.1.0-linux-x86_64.AppImage'), 'new');
    expect(installAppImage(appImage, download)).toEqual({ ok: true, path: appImage });
    expect(readFileSync(appImage, 'utf8')).toBe('new');
    expect(statSync(appImage).mode & 0o777).toBe(0o755);
    expect(fs.existsSync(download)).toBe(false);
    expect(readdirSync(apps)).toEqual(['Omni.AppImage']);
  });

  it('keeps the AppImage when the download has gone from the cache', () => {
    // 21 Nov: a QA run of the installed AppImage installed the update first and took the cached file with it. The
    // app's own quit then found nothing to install, after electron-updater had already deleted Omni.AppImage.
    const appImage = put(join(apps, 'Omni.AppImage'), 'old');
    const result = installAppImage(appImage, join(pending, 'Omni-2.1.0-linux-x86_64.AppImage'));
    expect(result).toMatchObject({ ok: false, reason: expect.stringContaining('gone') });
    expect(readFileSync(appImage, 'utf8')).toBe('old');
    expect(readdirSync(apps)).toEqual(['Omni.AppImage']);
  });

  it('keeps the AppImage when the updater has no download at all', () => {
    const appImage = put(join(apps, 'Omni.AppImage'), 'old');
    expect(installAppImage(appImage, null)).toMatchObject({ ok: false });
    expect(readFileSync(appImage, 'utf8')).toBe('old');
  });

  it('keeps the AppImage and the download, and leaves no staged copy, when the swap fails', () => {
    const appImage = put(join(apps, 'Omni.AppImage'), 'old');
    const download = put(join(pending, 'Omni-2.1.0-linux-x86_64.AppImage'), 'new');
    const failing = { ...fs, renameSync: () => { throw new Error('EIO: rename failed'); } };
    expect(installAppImage(appImage, download, failing)).toEqual({ ok: false, reason: 'EIO: rename failed' });
    expect(readFileSync(appImage, 'utf8')).toBe('old');
    expect(readFileSync(download, 'utf8')).toBe('new');
    expect(readdirSync(apps)).toEqual(['Omni.AppImage']);
  });

  it('keeps the AppImage when the copy fails', () => {
    const appImage = put(join(apps, 'Omni.AppImage'), 'old');
    const download = put(join(pending, 'Omni-2.1.0-linux-x86_64.AppImage'), 'new');
    const failing = { ...fs, copyFileSync: () => { throw new Error('ENOSPC: no space left on device'); } };
    expect(installAppImage(appImage, download, failing)).toMatchObject({ ok: false, reason: expect.stringContaining('ENOSPC') });
    expect(readFileSync(appImage, 'utf8')).toBe('old');
    expect(readdirSync(apps)).toEqual(['Omni.AppImage']);
  });

  it('moves a versioned AppImage to the new version\'s name and removes the old one', () => {
    const appImage = put(join(apps, 'Omni-2.0.2.AppImage'), 'old');
    const download = put(join(pending, 'Omni-2.1.0.AppImage'), 'new');
    expect(installAppImage(appImage, download)).toEqual({ ok: true, path: join(apps, 'Omni-2.1.0.AppImage') });
    expect(readdirSync(apps)).toEqual(['Omni-2.1.0.AppImage']);
    expect(readFileSync(join(apps, 'Omni-2.1.0.AppImage'), 'utf8')).toBe('new');
  });
});
