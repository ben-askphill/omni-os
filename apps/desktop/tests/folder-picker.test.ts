import { beforeEach, describe, expect, it, vi } from 'vitest';

// The bridge's pickFolder: the page asks over IPC, the main process opens the system folder dialog over that window
// and answers with the absolute path, or null on Cancel. Only an Omni page may ask.

const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
const showOpenDialog = vi.fn();
const win = { id: 1 };
vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, fn: (event: unknown, ...args: unknown[]) => unknown) => handlers.set(channel, fn), on: () => {} },
  BrowserWindow: { fromWebContents: () => win },
  dialog: { showOpenDialog: (...args: unknown[]) => showOpenDialog(...args) },
}));

const { folderDialogOptions, installFolderPicker, pickedFolder, startFolder } = await import('../src/folder-picker.ts');
const { trustOrigins } = await import('../src/handle.ts');

const HOME = '/Users/ben';
const there = (...dirs: string[]) => (p: string) => dirs.includes(p);

describe('startFolder', () => {
  it('opens in the typed folder when it exists, with ~ for home', () => {
    expect(startFolder('~/code', HOME, there('/Users/ben/code'))).toBe('/Users/ben/code');
    expect(startFolder('~', HOME, there(HOME))).toBe(HOME);
    expect(startFolder('/srv/repos', HOME, there('/srv/repos'))).toBe('/srv/repos');
  });

  it('opens in the nearest folder that exists for a path not made yet', () => {
    expect(startFolder('~/code/new-client/theme', HOME, there('/Users/ben/code', HOME))).toBe('/Users/ben/code');
  });

  it('opens at home for an empty, relative or non-text path, and when nothing on the way exists', () => {
    for (const p of ['', '   ', 'code/acme', undefined, 42, null]) expect(startFolder(p, HOME, there())).toBe(HOME);
    expect(startFolder('/nowhere/at/all', HOME, there())).toBe(HOME);
  });
});

describe('folderDialogOptions', () => {
  it('asks for one folder, lets you make one, and keeps the title the page gave', () => {
    expect(folderDialogOptions({ title: 'Repo folder', defaultPath: '~' }, HOME, there(HOME))).toEqual({
      title: 'Repo folder',
      buttonLabel: 'Choose',
      defaultPath: HOME,
      properties: ['openDirectory', 'createDirectory'],
    });
  });

  it('checks what crossed IPC: a missing or odd request gets the defaults', () => {
    for (const req of [undefined, null, 'x', { title: 7, defaultPath: ['/'] }]) {
      expect(folderDialogOptions(req, HOME, there())).toMatchObject({ title: 'Choose a folder', defaultPath: HOME });
    }
    expect(folderDialogOptions({ title: 'x'.repeat(500) }, HOME, there()).title).toHaveLength(120);
  });
});

describe('pickedFolder', () => {
  it('is the chosen path, or null on Cancel or an empty answer', () => {
    expect(pickedFolder({ canceled: false, filePaths: ['/Users/ben/code/acme'] })).toBe('/Users/ben/code/acme');
    expect(pickedFolder({ canceled: true, filePaths: ['/Users/ben/code/acme'] })).toBeNull();
    expect(pickedFolder({ canceled: false, filePaths: [] })).toBeNull();
    expect(pickedFolder({ canceled: false, filePaths: ['relative'] })).toBeNull();
  });
});

describe('omni:pick-folder', () => {
  const ORIGIN = 'http://127.0.0.1:4810';
  const fromOmni = { sender: {}, senderFrame: { url: `${ORIGIN}/#/settings` } };
  beforeEach(() => {
    handlers.clear();
    showOpenDialog.mockReset();
    trustOrigins(() => [ORIGIN]);
    installFolderPicker();
  });

  it('opens the dialog over the window that asked and answers with the folder', async () => {
    showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['/tmp/acme'] });
    await expect(handlers.get('omni:pick-folder')!(fromOmni, { title: 'Repo folder' })).resolves.toBe('/tmp/acme');
    expect(showOpenDialog).toHaveBeenCalledWith(win, expect.objectContaining({ title: 'Repo folder', properties: ['openDirectory', 'createDirectory'] }));
  });

  it('answers null when the dialog is cancelled', async () => {
    showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] });
    await expect(handlers.get('omni:pick-folder')!(fromOmni)).resolves.toBeNull();
  });

  it('refuses a page that is not Omni, without opening a dialog', () => {
    expect(() => handlers.get('omni:pick-folder')!({ sender: {}, senderFrame: { url: 'https://example.com/' } })).toThrow(/not an Omni page/);
    expect(showOpenDialog).not.toHaveBeenCalled();
  });
});
