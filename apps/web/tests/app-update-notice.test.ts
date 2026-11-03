import { describe, expect, it } from 'vitest';
import { appUpdateNotice } from '../src/app-update-notice.ts';

describe('appUpdateNotice', () => {
  it('says nothing while idle, checking or unsupported', () => {
    expect(appUpdateNotice(null, false)).toBeNull();
    expect(appUpdateNotice({ state: 'idle', checkedAt: null }, false)).toBeNull();
    expect(appUpdateNotice({ state: 'checking' }, false)).toBeNull();
    expect(appUpdateNotice({ state: 'unsupported', reason: 'A development build does not update itself.' }, false)).toBeNull();
  });

  it('shows a download under way, then Relaunch to Update', () => {
    expect(appUpdateNotice({ state: 'downloading', version: '0.2.0', percent: 41 }, true)).toEqual({
      text: 'Downloading Omni 0.2.0 (41%)',
      busy: true,
      failed: false,
      action: null,
    });
    expect(appUpdateNotice({ state: 'ready', version: '0.2.0' }, true)).toMatchObject({
      text: 'Omni 0.2.0 is ready',
      action: { kind: 'install', label: 'Relaunch to Update' },
    });
  });

  it('offers Retry for a download that failed', () => {
    expect(appUpdateNotice({ state: 'error', message: 'net::ERR_CONNECTION_RESET', downloadUrl: 'https://x/releases/latest' }, true)).toMatchObject({
      text: 'The update did not download.',
      detail: 'net::ERR_CONNECTION_RESET',
      action: { kind: 'retry' },
    });
  });

  it('offers the releases page when a check fails, and stays quiet when the build names none', () => {
    const url = 'https://github.com/ben-askphill/omni-os/releases/latest';
    expect(appUpdateNotice({ state: 'error', message: 'No published versions on GitHub', downloadUrl: url }, false)).toEqual({
      text: 'Omni could not check for updates.',
      detail: 'No published versions on GitHub',
      busy: false,
      failed: true,
      action: { kind: 'download', label: 'Download', url },
    });
    expect(appUpdateNotice({ state: 'error', message: 'offline' }, false)).toBeNull();
  });
});
