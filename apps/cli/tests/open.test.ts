import { describe, expect, it } from 'vitest';
import { appLaunch, macBundle } from '../src/commands/open.ts';
import { BASE, TOKEN, fake, wire } from './helpers.ts';

const ID = '00000000-0000-4000-8000-000000000001';
const APPIMAGE = '/home/me/Applications/Omni.AppImage';
const MAC_APP = '/Applications/Omni.app/Contents/MacOS/Omni';
const channels = { method: 'GET', path: '/api/channels', reply: { json: wire('channels.json') } };

describe('omni open', () => {
  it('opens a thread in the desktop app on Linux, as one --route argument', async () => {
    const f = fake({ env: { OMNI_APP: APPIMAGE }, stats: { [APPIMAGE]: { mode: 0o100755 } } });
    expect(await f.run('open', ID)).toBe(0);
    expect(f.launched).toEqual([[APPIMAGE, [`--route=#/t/${ID}`]]]);
    expect(f.out()).toBe(`Opened #/t/${ID} in the Omni app.\n`);
  });

  it('opens the Mac app through open, so a second launch hands the page to the running app', () => {
    expect(macBundle(MAC_APP)).toBe('/Applications/Omni.app');
    expect(appLaunch(MAC_APP, 'darwin', '#/c/acme')).toEqual(['open', ['-n', '-a', '/Applications/Omni.app', '--args', '--route=#/c/acme']]);
    expect(appLaunch(APPIMAGE, 'linux', '#/')).toEqual([APPIMAGE, ['--route=#/']]);
  });

  it('falls back to the browser without the app, or when the app is gone', async () => {
    const none = fake();
    expect(await none.run('open', ID)).toBe(0);
    expect(none.launched).toEqual([['xdg-open', [`${BASE}/#/t/${ID}`]]]);
    const gone = fake({ env: { OMNI_APP: APPIMAGE }, platform: 'darwin' });
    expect(await gone.run('open')).toBe(0);
    expect(gone.launched).toEqual([['open', [`${BASE}/#/`]]]);
    expect(gone.out()).toBe(`Opened ${BASE}/#/ in your browser.\n`);
  });

  it('opens a server named by OMNI_URL in the browser, never in this machine’s app', async () => {
    const f = fake({ env: { OMNI_APP: APPIMAGE, OMNI_URL: 'https://box.tail.ts.net' }, stats: { [APPIMAGE]: {} }, routes: [{ method: 'GET', path: '/api/channels/acme', reply: { json: wire('channel.json') } }] });
    f.io.fetch = ((orig) => (url: string, init: Parameters<typeof orig>[1]) => orig(url.replace('https://box.tail.ts.net', BASE), init))(f.io.fetch);
    expect(await f.run('open', 'acme')).toBe(0);
    expect(f.launched).toEqual([['xdg-open', ['https://box.tail.ts.net/#/c/acme']]]);
  });

  it('opens "." as the thread whose worktree this is, the thread an agent runs in, or the channel of this folder', async () => {
    const worktree = fake({ cwd: `/home/me/omni/data/worktrees/${ID}/apps/web`, env: { OMNI_DATA_DIR: '/home/me/omni/data' } });
    await worktree.run('open', '.');
    expect(worktree.launched[0][1]).toEqual([`${BASE}/#/t/${ID}`]);

    const agent = fake({ cwd: '/srv/x', env: { OMNI_THREAD_ID: ID } });
    await agent.run('open', '.');
    expect(agent.launched[0][1]).toEqual([`${BASE}/#/t/${ID}`]);

    const folder = fake({ cwd: '/tmp/omni-fixtures/acme/src', routes: [channels] });
    await folder.run('open', '.');
    expect(folder.launched[0][1]).toEqual([`${BASE}/#/c/acme`]);

    const nowhere = fake({ cwd: '/elsewhere', routes: [channels] });
    expect(await nowhere.run('open', '.')).toBe(3);
    expect(nowhere.err()).toContain('No channel has /elsewhere as its folder');
  });

  it('opens a channel by id, and says when there is no such channel', async () => {
    const f = fake({ routes: [{ method: 'GET', path: '/api/channels/acme', reply: { json: wire('channel.json') } }, { method: 'GET', path: '/api/channels/nope', reply: { status: 404, json: wire('error-not-found.json') } }] });
    expect(await f.run('open', 'acme')).toBe(0);
    expect(f.launched[0][1]).toEqual([`${BASE}/#/c/acme`]);
    expect(await f.run('open', 'nope')).toBe(3);
    expect(f.err()).toContain('No channel or thread named nope');
    expect(await f.run('open', '')).toBe(64);
    expect(f.err()).toContain('say which thread or channel to open');
  });

  it('prints a pairing link instead with --pair, and opens nothing', async () => {
    const f = fake();
    expect(await f.run('open', ID, '--pair')).toBe(0);
    expect(f.out()).toBe(`${BASE}/#/t/${ID}?pair=${TOKEN}\n`);
    expect(f.launched).toEqual([]);
  });
});
