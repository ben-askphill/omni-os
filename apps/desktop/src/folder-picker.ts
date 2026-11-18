// The bridge's `pickFolder`: the system's folder dialog, sheet-style over the window that asked. The server runs on
// this machine (the app starts it or attaches to one on localhost), so the path the dialog returns is one it can use.
import { BrowserWindow, dialog, type OpenDialogOptions, type OpenDialogReturnValue } from 'electron';
import { statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import type { FolderPickRequest } from '@omni/shared/desktop-bridge.ts';
import { handle } from './handle.ts';

const TITLE_MAX = 120;
const PATH_MAX = 4096;

const isDir = (p: string) => {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
};

/**
 * The folder the dialog opens in: `defaultPath` with `~` expanded, or its nearest folder that exists, so a typed path
 * that is not there yet still opens close to it. Home for anything else, a relative path included.
 */
export function startFolder(defaultPath: unknown, home: string, exists: (p: string) => boolean = isDir): string {
  const raw = typeof defaultPath === 'string' ? defaultPath.trim().slice(0, PATH_MAX) : '';
  const expanded = raw === '~' ? home : raw.startsWith('~/') ? join(home, raw.slice(2)) : raw;
  if (!expanded || !isAbsolute(expanded)) return home;
  for (let p = resolve(expanded); ; p = dirname(p)) {
    if (exists(p)) return p;
    if (dirname(p) === p) return home;
  }
}

/** The dialog for a request from the page, which is checked field by field: it crossed IPC. */
export function folderDialogOptions(request: unknown, home: string, exists?: (p: string) => boolean): OpenDialogOptions {
  const req = (request && typeof request === 'object' ? request : {}) as Record<string, unknown>;
  const title = typeof req.title === 'string' && req.title.trim() ? req.title.trim().slice(0, TITLE_MAX) : 'Choose a folder';
  return {
    title,
    // macOS shows the title nowhere in a sheet; the button says what the pick is for instead of a bare Open.
    buttonLabel: 'Choose',
    defaultPath: startFolder(req.defaultPath, home, exists),
    properties: ['openDirectory', 'createDirectory'],
  };
}

/** The chosen folder, or null when the dialog was cancelled. */
export function pickedFolder(result: Pick<OpenDialogReturnValue, 'canceled' | 'filePaths'>): string | null {
  const path = result.canceled ? undefined : result.filePaths[0];
  return path && isAbsolute(path) ? path : null;
}

export function installFolderPicker(): void {
  handle('omni:pick-folder', async (event, request?: FolderPickRequest) => {
    const options = folderDialogOptions(request, homedir());
    const win = BrowserWindow.fromWebContents(event.sender);
    // dialog.showOpenDialog is read at call time, so a QA run's stub answers instead of a real dialog.
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
    return pickedFolder(result);
  });
}
