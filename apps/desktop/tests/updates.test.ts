import { describe, expect, it } from 'vitest';
import type { DesktopUpdateView } from '@omni/shared/desktop-bridge.ts';
import { initialView, installOnQuit, reduceUpdate, releasesPage, shouldCheck, unsupportedReason, updateErrorText, type UpdateHost, type UpdaterEvent } from '../src/update-state.ts';

const mac: UpdateHost = { packaged: true, platform: 'darwin', hasFeed: true, appImage: undefined, installDirWritable: true };
const appImage: UpdateHost = { packaged: true, platform: 'linux', hasFeed: true, appImage: '/home/me/Apps/Omni.AppImage', installDirWritable: true };

const run = (events: UpdaterEvent[], from: DesktopUpdateView = { state: 'idle', checkedAt: null }) => events.reduce(reduceUpdate, from);

describe('when the app updates itself', () => {
  it('does on a packaged Mac build with a feed, and in a writable AppImage', () => {
    expect(unsupportedReason(mac)).toBeNull();
    expect(unsupportedReason(appImage)).toBeNull();
    expect(initialView(mac)).toEqual({ state: 'idle', checkedAt: null });
  });

  it('does not in development, without a feed, outside an AppImage, or where the AppImage cannot be replaced', () => {
    expect(unsupportedReason({ ...mac, packaged: false })).toMatch(/development/);
    expect(unsupportedReason({ ...mac, hasFeed: false })).toMatch(/no update feed/);
    expect(unsupportedReason({ ...appImage, appImage: undefined })).toMatch(/AppImage/);
    expect(unsupportedReason({ ...appImage, installDirWritable: false })).toMatch(/not writable/);
    expect(unsupportedReason({ ...mac, installDirWritable: false })).toMatch(/Move it to Applications/);
    expect(unsupportedReason({ ...mac, platform: 'win32' })).toMatch(/macOS and Linux/);
    expect(initialView({ ...mac, packaged: false }).state).toBe('unsupported');
  });
});

describe('the update view', () => {
  it('goes from a check through the download to ready', () => {
    const at = '2026-11-02T10:00:00.000Z';
    expect(run([{ type: 'checking' }])).toEqual({ state: 'checking' });
    expect(run([{ type: 'checking' }, { type: 'not-available', at }])).toEqual({ state: 'idle', checkedAt: at });
    expect(run([{ type: 'checking' }, { type: 'available', version: '0.2.0' }, { type: 'progress', percent: 41.7 }])).toEqual({
      state: 'downloading',
      version: '0.2.0',
      percent: 41,
    });
    expect(run([{ type: 'available', version: '0.2.0' }, { type: 'progress', percent: 99.9 }, { type: 'downloaded', version: '0.2.0' }])).toEqual({
      state: 'ready',
      version: '0.2.0',
    });
  });

  it('keeps a download going through a check that runs meanwhile', () => {
    const downloading = run([{ type: 'available', version: '0.2.0' }, { type: 'progress', percent: 30 }]);
    expect(run([{ type: 'checking' }, { type: 'not-available', at: 'x' }, { type: 'available', version: '0.2.0' }], downloading)).toEqual(downloading);
  });

  it('stays ready until a newer download replaces it', () => {
    const ready: DesktopUpdateView = { state: 'ready', version: '0.2.0' };
    expect(run([{ type: 'checking' }, { type: 'available', version: '0.3.0' }, { type: 'progress', percent: 50 }], ready)).toEqual(ready);
    expect(reduceUpdate(ready, { type: 'downloaded', version: '0.3.0' })).toEqual({ state: 'ready', version: '0.3.0' });
  });

  it('leaves ready on an error, so Relaunch is not offered for an install that cannot work', () => {
    // On a Mac, Squirrel.Mac refusing the update (a read-only volume, a signature mismatch) arrives as an error.
    const ready: DesktopUpdateView = { state: 'ready', version: '0.2.0' };
    expect(reduceUpdate(ready, { type: 'error', message: 'Cannot update while running on a read-only volume' })).toEqual({
      state: 'error',
      message: 'Cannot update while running on a read-only volume',
    });
  });

  it('carries the page to download the build by hand with an error', () => {
    const url = 'https://github.com/o/r/releases/latest';
    expect(run([{ type: 'checking' }, { type: 'error', message: 'No published versions on GitHub', downloadUrl: url }])).toEqual({
      state: 'error',
      message: 'No published versions on GitHub',
      downloadUrl: url,
    });
  });

  it('reports an error, and checks again after one', () => {
    const failed = run([{ type: 'checking' }, { type: 'error', message: 'net::ERR_INTERNET_DISCONNECTED' }]);
    expect(failed).toEqual({ state: 'error', message: 'net::ERR_INTERNET_DISCONNECTED' });
    expect(shouldCheck(failed)).toBe(true);
    expect(reduceUpdate(failed, { type: 'checking' })).toEqual({ state: 'checking' });
  });

  it('checks only when idle or after an error', () => {
    expect(shouldCheck({ state: 'idle', checkedAt: null })).toBe(true);
    expect(shouldCheck({ state: 'checking' })).toBe(false);
    expect(shouldCheck({ state: 'downloading', version: '1', percent: 3 })).toBe(false);
    expect(shouldCheck({ state: 'ready', version: '1' })).toBe(false);
    expect(shouldCheck({ state: 'unsupported', reason: 'dev' })).toBe(false);
  });

  it('never leaves unsupported', () => {
    const view: DesktopUpdateView = { state: 'unsupported', reason: 'dev' };
    expect(run([{ type: 'checking' }, { type: 'downloaded', version: '9' }], view)).toBe(view);
  });

  it('clamps progress to whole percents', () => {
    const downloading: DesktopUpdateView = { state: 'downloading', version: '1', percent: 0 };
    expect(reduceUpdate(downloading, { type: 'progress', percent: 140 })).toMatchObject({ percent: 100 });
    expect(reduceUpdate(downloading, { type: 'progress', percent: Number.NaN })).toMatchObject({ percent: 0 });
  });
});

describe('releasesPage', () => {
  it('reads the page from the app-update.yml electron-builder writes', () => {
    expect(releasesPage("owner: ben-askphill\nrepo: omni-os\nprovider: github\nupdaterCacheDirName: '@omnidesktop-updater'\n")).toBe(
      'https://github.com/ben-askphill/omni-os/releases/latest',
    );
    expect(releasesPage('provider: generic\nurl: http://127.0.0.1:4785/\n')).toBe('http://127.0.0.1:4785/');
    expect(releasesPage('provider: generic\nurl: file:///tmp\n')).toBeNull();
    expect(releasesPage('provider: github\nowner: x\n')).toBeNull();
    expect(releasesPage('provider: s3\nbucket: b\n')).toBeNull();
  });
});

describe('updateErrorText', () => {
  it('keeps the first line of an updater error', () => {
    expect(updateErrorText(new Error('HttpError: 404\n"method: GET url: https://github.com/..."\nheaders...'))).toBe('HttpError: 404');
    expect(updateErrorText(new Error(''))).toBe('The update check failed.');
    expect(updateErrorText('x'.repeat(300))).toHaveLength(200);
  });
});

describe('installing at quit', () => {
  const ready: DesktopUpdateView = { state: 'ready', version: '0.2.0' };

  it('installs once the server stopped, opening the app again only after Relaunch to Update', () => {
    expect(installOnQuit(ready, { forUpdate: true, serverKeepsRunning: false })).toEqual({ relaunch: true });
    expect(installOnQuit(ready, { forUpdate: false, serverKeepsRunning: false })).toEqual({ relaunch: false });
  });

  it('leaves the update for a later quit while a server this app started keeps running', () => {
    expect(installOnQuit(ready, { forUpdate: false, serverKeepsRunning: true })).toBeNull();
    expect(installOnQuit(ready, { forUpdate: true, serverKeepsRunning: true })).toBeNull();
  });

  it('installs nothing before an update is ready or before the quit flow let the app go', () => {
    expect(installOnQuit({ state: 'downloading', version: '0.2.0', percent: 50 }, { forUpdate: false, serverKeepsRunning: false })).toBeNull();
    expect(installOnQuit(ready, null)).toBeNull();
  });
});
