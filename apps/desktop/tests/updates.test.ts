import { describe, expect, it } from 'vitest';
import { applySettingsPatch, DEFAULT_DESKTOP_SETTINGS, parseDesktopSettings, type DesktopUpdateView } from '@omni/shared/desktop-bridge.ts';
import {
  commandStep,
  initialView,
  installOnQuit,
  NOTE_LINES,
  parseCommand,
  reduceUpdate,
  releaseNotes,
  releasePage,
  releasesPage,
  shouldCheck,
  unsupportedReason,
  updateErrorText,
  type UpdateHost,
  type UpdaterEvent,
} from '../src/update-state.ts';

const mac: UpdateHost = { packaged: true, platform: 'darwin', hasFeed: true, appImage: undefined, installDirWritable: true };
const appImage: UpdateHost = { packaged: true, platform: 'linux', hasFeed: true, appImage: '/home/me/Apps/Omni.AppImage', installDirWritable: true };

const run = (events: UpdaterEvent[], from: DesktopUpdateView = { state: 'idle', checkedAt: null }) => events.reduce(reduceUpdate, from);
/** Found with Check automatically on, so electron-updater downloads it by itself. */
const found = (version: string): UpdaterEvent => ({ type: 'available', version, autoDownload: true });

describe('when the app updates itself', () => {
  it('does on a packaged Mac build with a feed, and in a writable AppImage', () => {
    expect(unsupportedReason(mac)).toBeNull();
    expect(unsupportedReason(appImage)).toBeNull();
    expect(initialView(mac)).toEqual({ state: 'idle', checkedAt: null });
  });

  it('does not in development, without a feed, outside an AppImage, or where the AppImage cannot be replaced', () => {
    expect(unsupportedReason({ ...mac, packaged: false })).toMatch(/development/);
    expect(unsupportedReason({ ...mac, hasFeed: false })).toMatch(/built locally, so it updates by rebuilding/);
    expect(unsupportedReason({ ...appImage, appImage: undefined })).toMatch(/AppImage/);
    expect(unsupportedReason({ ...appImage, installDirWritable: false })).toMatch(/not writable/);
    expect(unsupportedReason({ ...mac, installDirWritable: false })).toMatch(/Move it to Applications/);
    expect(unsupportedReason({ ...mac, platform: 'win32' })).toMatch(/macOS and Linux/);
    expect(initialView({ ...mac, packaged: false }).state).toBe('unsupported');
  });
});

describe('Check automatically', () => {
  it('is on unless turned off, also in settings saved before it existed', () => {
    expect(DEFAULT_DESKTOP_SETTINGS.autoUpdate).toBe(true);
    expect(parseDesktopSettings({ zoom: 1.2 }).autoUpdate).toBe(true);
    expect(parseDesktopSettings({ autoUpdate: 'off' }).autoUpdate).toBe(true);
    expect(parseDesktopSettings({ autoUpdate: false }).autoUpdate).toBe(false);
    expect(applySettingsPatch(DEFAULT_DESKTOP_SETTINGS, { autoUpdate: false })).toMatchObject({ autoUpdate: false, zoom: 1 });
  });
});

describe('the update view', () => {
  it('goes from a check through the download to ready', () => {
    const at = '2026-11-02T10:00:00.000Z';
    expect(run([{ type: 'checking' }])).toEqual({ state: 'checking' });
    expect(run([{ type: 'checking' }, { type: 'not-available', at }])).toEqual({ state: 'idle', checkedAt: at });
    expect(run([{ type: 'checking' }, found('0.2.0'), { type: 'progress', percent: 41.7 }])).toEqual({
      state: 'downloading',
      version: '0.2.0',
      percent: 41,
    });
    expect(run([found('0.2.0'), { type: 'progress', percent: 99.9 }, { type: 'downloaded', version: '0.2.0' }])).toEqual({
      state: 'ready',
      version: '0.2.0',
    });
  });

  it('keeps a download going through a check that runs meanwhile', () => {
    const downloading = run([found('0.2.0'), { type: 'progress', percent: 30 }]);
    expect(run([{ type: 'checking' }, { type: 'not-available', at: 'x' }, found('0.2.0')], downloading)).toEqual(downloading);
  });

  it('stays ready until a newer download replaces it', () => {
    const ready: DesktopUpdateView = { state: 'ready', version: '0.2.0' };
    expect(run([{ type: 'checking' }, found('0.3.0'), { type: 'progress', percent: 50 }], ready)).toEqual(ready);
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

  it('checks when idle, after an error, or again over an update that waits for Download', () => {
    expect(shouldCheck({ state: 'idle', checkedAt: null })).toBe(true);
    expect(shouldCheck({ state: 'available', version: '1' })).toBe(true);
    expect(shouldCheck({ state: 'checking' })).toBe(false);
    expect(shouldCheck({ state: 'downloading', version: '1', percent: 3 })).toBe(false);
    expect(shouldCheck({ state: 'ready', version: '1' })).toBe(false);
    expect(shouldCheck({ state: 'unsupported', reason: 'dev' })).toBe(false);
  });

  it('never leaves unsupported', () => {
    const view: DesktopUpdateView = { state: 'unsupported', reason: 'dev' };
    expect(run([{ type: 'checking' }, { type: 'downloaded', version: '9' }], view)).toBe(view);
  });

  it('waits for Download when Check automatically is off, then downloads as before', () => {
    const notes = { lines: ['Show release notes in Settings (#556)'], more: 0, url: 'https://github.com/o/r/releases/tag/v0.2.0' };
    const available = run([{ type: 'checking' }, { type: 'available', version: '0.2.0', notes, autoDownload: false }]);
    expect(available).toEqual({ state: 'available', version: '0.2.0', notes });
    // No progress is shown for a download that has not started.
    expect(reduceUpdate(available, { type: 'progress', percent: 20 })).toEqual(available);
    expect(run([{ type: 'download-started' }, { type: 'progress', percent: 20 }], available)).toEqual({ state: 'downloading', version: '0.2.0', percent: 20, notes });
    expect(reduceUpdate({ state: 'idle', checkedAt: null }, { type: 'download-started' })).toEqual({ state: 'idle', checkedAt: null });
  });

  it('starts the download when a later check finds the same update with Check automatically on', () => {
    const available: DesktopUpdateView = { state: 'available', version: '0.2.0' };
    expect(run([{ type: 'checking' }, found('0.2.0')], available)).toEqual({ state: 'downloading', version: '0.2.0', percent: 0 });
  });

  it('keeps the release notes from the check through the download to ready', () => {
    const notes = { lines: ['Fix the quit question'], more: 2, url: null };
    const ready = run([{ type: 'available', version: '0.2.0', notes, autoDownload: true }, { type: 'progress', percent: 50 }, { type: 'downloaded', version: '0.2.0' }]);
    expect(ready).toEqual({ state: 'ready', version: '0.2.0', notes });
    // The downloaded event's own notes win, and a newer version never takes an older one's.
    const newer = { lines: ['Newer'], more: 0, url: null };
    expect(reduceUpdate(ready, { type: 'downloaded', version: '0.2.0', notes: newer })).toEqual({ state: 'ready', version: '0.2.0', notes: newer });
    expect(reduceUpdate(ready, { type: 'downloaded', version: '0.3.0' })).toEqual({ state: 'ready', version: '0.3.0' });
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

describe('releasePage', () => {
  it("links a GitHub feed's release by its v<version> tag, and no other feed", () => {
    const github = 'owner: ben-askphill\nrepo: omni-os\nprovider: github\n';
    expect(releasePage(github, '0.2.0')).toBe('https://github.com/ben-askphill/omni-os/releases/tag/v0.2.0');
    expect(releasePage(github, '0.3.0-beta.1')).toBe('https://github.com/ben-askphill/omni-os/releases/tag/v0.3.0-beta.1');
    expect(releasePage(github, '../x y')).toBeNull();
    expect(releasePage('provider: generic\nurl: http://127.0.0.1:4785/\n', '0.2.0')).toBeNull();
  });
});

describe('releaseNotes', () => {
  // The release body as GitHub's releases.atom carries it, which is what electron-updater's GitHub provider passes.
  const github = [
    "<h2>What's Changed</h2>",
    '<ul>',
    '<li>Let the Conductor set a secret on another synced machine by <a class="user-mention notranslate" href="https://github.com/ben-askphill">@ben-askphill</a> in <a class="issue-link js-issue-link" href="https://github.com/ben-askphill/omni-os/pull/554">#554</a></li>',
    '<li>Bump vitest &amp; tsx to &lt;latest&gt; by <a href="https://github.com/apps/dependabot">@dependabot[bot]</a> in <a href="https://github.com/ben-askphill/omni-os/pull/560">#560</a></li>',
    '<li>Say &quot;Relaunch&quot; &#8212; not &#x201C;Restart&#x201D;</li>',
    '</ul>',
    '<p><strong>Full Changelog</strong>: <a href="https://github.com/ben-askphill/omni-os/compare/v0.1.1...v0.1.2"><tt>v0.1.1...v0.1.2</tt></a></p>',
  ].join('\n');

  it('keeps one plain line per item of GitHub notes, the PR number in place of who merged it', () => {
    expect(releaseNotes(github, 'https://x/releases/tag/v0.1.2')).toEqual({
      lines: [
        'Let the Conductor set a secret on another synced machine (#554)',
        'Bump vitest & tsx to <latest> (#560)',
        'Say "Relaunch" \u2014 not \u201cRestart\u201d',
      ],
      more: 0,
      url: 'https://x/releases/tag/v0.1.2',
    });
  });

  it("reads a feed's Markdown notes, without headings or the changelog link", () => {
    const md = "## What's Changed\n* Show updates in Settings by @ben-askphill in https://github.com/ben-askphill/omni-os/pull/556\n- Plain item\n\n**Full Changelog**: https://github.com/o/r/compare/a...b\nhttps://example.com/";
    expect(releaseNotes(md, null).lines).toEqual(['Show updates in Settings (#556)', 'Plain item']);
  });

  it('joins the notes of every version from a full changelog', () => {
    const raw = [
      { version: '0.1.3', note: '<ul><li>Third</li></ul>' },
      { version: '0.1.2', note: '<ul><li>Second</li></ul>' },
    ];
    expect(releaseNotes(raw, null).lines).toEqual(['Third', 'Second']);
  });

  it(`shows the first ${NOTE_LINES} lines and counts the rest`, () => {
    const many = `<ul>${Array.from({ length: NOTE_LINES + 3 }, (_, i) => `<li>Change ${i + 1}</li>`).join('')}</ul>`;
    const notes = releaseNotes(many, null);
    expect(notes.lines).toHaveLength(NOTE_LINES);
    expect(notes.lines.at(-1)).toBe(`Change ${NOTE_LINES}`);
    expect(notes.more).toBe(3);
  });

  it('has no lines when a release has no notes', () => {
    for (const raw of [null, undefined, '', '  ', 42, [{ version: '1' }]]) expect(releaseNotes(raw, null)).toEqual({ lines: [], more: 0, url: null });
  });

  it('never keeps markup', () => {
    const lines = releaseNotes('<ul><li><img src=x onerror=alert(1)>Fix <b>bold</b> text<script>x()</script></li></ul>', null).lines;
    expect(lines).toEqual(['Fix bold textx()']);
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

describe('a command from the server', () => {
  const idle: DesktopUpdateView = { state: 'idle', checkedAt: null };
  const available: DesktopUpdateView = { state: 'available', version: '0.2.0' };
  const downloading: DesktopUpdateView = { state: 'downloading', version: '0.2.0', percent: 10 };
  const ready: DesktopUpdateView = { state: 'ready', version: '0.2.0' };
  const failed: DesktopUpdateView = { state: 'error', message: 'offline' };
  const unsupported: DesktopUpdateView = { state: 'unsupported', reason: 'dev' };
  const checking: DesktopUpdateView = { state: 'checking' };
  const step = (action: 'check' | 'download' | 'install', view: DesktopUpdateView) => commandStep({ id: 'c1', action }, view);

  it('check looks for an update when the app is not already on one', () => {
    expect([idle, failed, available].map((view) => step('check', view))).toEqual(['check', 'check', 'check']);
    expect([checking, downloading, ready, unsupported].map((view) => step('check', view))).toEqual(['none', 'none', 'none', 'none']);
  });

  it('download fetches a found update, and finds one first when none is known, even with Check automatically off', () => {
    expect(step('download', available)).toBe('download');
    expect(step('download', idle)).toBe('check-and-download');
    expect(step('download', failed)).toBe('check-and-download');
  });

  it('download does nothing once the update is on its way or here, or the app cannot update', () => {
    expect([downloading, ready, unsupported].map((view) => step('download', view))).toEqual(['none', 'none', 'none']);
  });

  it('download waits for a check under way to find its update', () => {
    expect(step('download', checking)).toBe('wait');
    // The check ends in available, and the same command then downloads.
    expect(step('download', run([found('0.2.0')], checking))).toBe('none');
    expect(step('download', run([{ type: 'available', version: '0.2.0', autoDownload: false }], checking))).toBe('download');
  });

  it('install relaunches into an update that is downloaded, and into nothing else', () => {
    expect(step('install', ready)).toBe('install');
    expect([idle, checking, available, downloading, failed, unsupported].map((view) => step('install', view))).toEqual(Array(6).fill('none'));
  });

  it('reads the command out of the server answer, and nothing from an answer it does not know', () => {
    expect(parseCommand({ command: { id: 'c7', action: 'install' } })).toEqual({ id: 'c7', action: 'install' });
    expect(parseCommand({ command: { id: 'c7', action: 'install', extra: 1 } })).toEqual({ id: 'c7', action: 'install' });
    expect(parseCommand({ command: null })).toBeNull();
    expect(parseCommand({})).toBeNull();
    expect(parseCommand(null)).toBeNull();
    expect(parseCommand('ok')).toBeNull();
    expect(parseCommand({ command: { id: 'c7', action: 'reboot' } })).toBeNull();
    expect(parseCommand({ command: { id: '', action: 'check' } })).toBeNull();
    expect(parseCommand({ command: { action: 'check' } })).toBeNull();
  });
});
