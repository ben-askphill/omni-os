import { describe, expect, it } from 'vitest';
import { appUpdateNotice, appUpdateStatus, appUpdateWords } from '../src/app-update-notice.ts';

describe('appUpdateNotice', () => {
  it('says nothing while idle, checking or unsupported', () => {
    expect(appUpdateNotice(null, false)).toBeNull();
    expect(appUpdateNotice({ state: 'idle', checkedAt: null }, false)).toBeNull();
    expect(appUpdateNotice({ state: 'checking' }, false)).toBeNull();
    expect(appUpdateNotice({ state: 'unsupported', reason: 'A development build does not update itself.' }, false)).toBeNull();
  });

  it('shows a download under way, then Relaunch to update', () => {
    expect(appUpdateNotice({ state: 'downloading', version: '0.2.0', percent: 41 }, true)).toEqual({
      text: 'Downloading Omni 0.2.0 (41%)',
      key: null,
      busy: true,
      failed: false,
      action: null,
    });
    expect(appUpdateNotice({ state: 'ready', version: '0.2.0' }, true)).toMatchObject({
      text: 'Omni 0.2.0 is ready',
      key: 'ready:0.2.0',
      action: { kind: 'install', label: 'Relaunch to update' },
    });
  });

  it('says how many turns a relaunch would ask about', () => {
    expect(appUpdateWords.running(1)).toBe('1 turn is running. Omni asks before it stops it.');
    expect(appUpdateWords.running(2)).toBe('2 turns are running. Omni asks before it stops them.');
  });

  it('offers Download for an update found while Check automatically is off', () => {
    expect(appUpdateNotice({ state: 'available', version: '0.2.0' }, false)).toEqual({
      text: 'Omni 0.2.0 is available',
      key: 'available:0.2.0',
      busy: false,
      failed: false,
      action: { kind: 'fetch', label: 'Download' },
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
      key: 'error:No published versions on GitHub',
      detail: 'No published versions on GitHub',
      busy: false,
      failed: true,
      action: { kind: 'download', label: 'Download', url },
    });
    expect(appUpdateNotice({ state: 'error', message: 'offline' }, false)).toBeNull();
  });
});

describe('appUpdateStatus', () => {
  const now = Date.parse('2026-11-07T12:00:00.000Z');
  const status = (view: Parameters<typeof appUpdateStatus>[0]) => appUpdateStatus(view, '0.1.1', now);

  it('names this version, and offers a check while idle', () => {
    expect(status({ state: 'idle', checkedAt: null })).toMatchObject({ title: 'Omni 0.1.1', detail: 'Not checked yet', action: { kind: 'check', label: 'Check for updates' } });
    expect(status({ state: 'idle', checkedAt: '2026-11-07T11:00:00.000Z' }).detail).toMatch(/^Up to date, checked 1h/);
    expect(status({ state: 'checking' })).toMatchObject({ detail: 'Checking for updates…', action: null });
  });

  it('says why a copy cannot update itself, and offers nothing', () => {
    expect(status({ state: 'unsupported', reason: 'A development build does not update itself.' })).toMatchObject({
      title: 'Omni 0.1.1',
      detail: 'A development build does not update itself.',
      action: null,
    });
  });

  it('goes from Download through the progress to Relaunch to update', () => {
    expect(status({ state: 'available', version: '0.2.0' })).toMatchObject({ title: 'Omni 0.2.0 is available', detail: 'You have 0.1.1.', action: { kind: 'fetch' } });
    expect(status({ state: 'downloading', version: '0.2.0', percent: 37 })).toMatchObject({ title: 'Downloading Omni 0.2.0', detail: '37%', progress: 0.37, action: null });
    expect(status({ state: 'ready', version: '0.2.0' })).toMatchObject({ title: 'Omni 0.2.0 is ready', progress: null, action: { kind: 'install', label: 'Relaunch to update' } });
  });

  it('shows the error with Check for updates, and the releases page when the feed names one', () => {
    const url = 'https://github.com/ben-askphill/omni-os/releases/latest';
    expect(status({ state: 'error', message: 'net::ERR_INTERNET_DISCONNECTED', downloadUrl: url })).toMatchObject({
      detail: 'net::ERR_INTERNET_DISCONNECTED',
      failed: true,
      action: { kind: 'check' },
      releasesUrl: url,
    });
    expect(status({ state: 'error', message: 'offline' }).releasesUrl).toBeNull();
  });
});
