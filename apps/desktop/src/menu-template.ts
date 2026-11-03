// The application menu and the text-field context menu as data, from the app's state. Pure, so tests pin each
// label, shortcut and platform difference; menu.ts and windows.ts turn them into native menus.
// The menu is OmniCommands in apps/mac/Omni/OmniApp.swift, with Ctrl in place of Cmd off the Mac.
import type { MenuItemConstructorOptions } from 'electron';
import { serverOriginLabel, ZOOM_MAX, ZOOM_MIN, type DesktopCommand, type DesktopPlatform } from '@omni/shared/desktop-bridge.ts';

export type ServerMenuState = 'starting' | 'ready' | 'restarting' | 'failed' | 'stopped';

/** The platform as the Web UI and the menu know it: anything not a Mac or Windows is Linux. */
export function desktopPlatform(platform: NodeJS.Platform = process.platform): DesktopPlatform {
  return platform === 'darwin' || platform === 'win32' ? platform : 'linux';
}

export interface MenuState {
  platform: DesktopPlatform;
  packaged: boolean;
  port: number;
  server: ServerMenuState;
  /** This app started the server, so it may restart it. False when it attached to one already running. */
  startedHere: boolean;
  zoom: number;
  /** The server log file exists, so Show Server Log has something to open. */
  logExists: boolean;
}

export interface MenuActions {
  command(command: DesktopCommand): void;
  quickPrompt(): void;
  newWindow(): void;
  zoom(to: 'in' | 'out' | 'reset'): void;
  back(): void;
  forward(): void;
  restartServer(): void;
  showServerLog(): void;
  activityMonitor(): void;
}

const SERVER_LABEL: Record<ServerMenuState, string> = {
  starting: 'starting',
  ready: 'running',
  restarting: 'restarting',
  failed: 'not running',
  stopped: 'stopped',
};

export function serverStatusLabel(state: Pick<MenuState, 'port' | 'server' | 'startedHere'>): string {
  const label = SERVER_LABEL[state.server];
  const elsewhere = attached(state) ? `, ${serverOriginLabel(false)}` : '';
  return `Port ${state.port}: ${label}${elsewhere}`;
}

/** Running, but not started by this app: its output goes to whoever started it, not to this app's log file. */
const attached = (state: Pick<MenuState, 'server' | 'startedHere'>) => state.server === 'ready' && !state.startedHere;

const separator: MenuItemConstructorOptions = { type: 'separator' };

export function menuTemplate(state: MenuState, actions: MenuActions): MenuItemConstructorOptions[] {
  const mac = state.platform === 'darwin';
  const settings: MenuItemConstructorOptions = {
    id: 'settings',
    label: 'Settings…',
    accelerator: 'CmdOrCtrl+,',
    click: () => actions.command('settings'),
  };
  const about: MenuItemConstructorOptions = { id: 'about', role: 'about', label: 'About Omni' };

  const appMenu: MenuItemConstructorOptions = {
    label: 'Omni',
    submenu: [
      about,
      separator,
      settings,
      separator,
      { role: 'services' },
      separator,
      { role: 'hide', label: 'Hide Omni' },
      { role: 'hideOthers' },
      { role: 'unhide', label: 'Show All' },
      separator,
      { role: 'quit', label: 'Quit Omni' },
    ],
  };

  const file: MenuItemConstructorOptions = {
    label: 'File',
    submenu: [
      { id: 'new-thread', label: 'New Thread', accelerator: 'CmdOrCtrl+N', click: () => actions.command('new-thread') },
      { id: 'quick-prompt', label: 'Quick Prompt', click: () => actions.quickPrompt() },
      { id: 'new-window', label: 'New Window', accelerator: 'Shift+CmdOrCtrl+N', click: () => actions.newWindow() },
      separator,
      { role: 'close', label: 'Close Window' },
      ...(mac ? [] : [separator, settings, separator, { role: 'quit', label: 'Quit' } satisfies MenuItemConstructorOptions]),
    ],
  };

  const edit: MenuItemConstructorOptions = {
    label: 'Edit',
    submenu: [
      { role: 'undo' },
      { role: 'redo' },
      separator,
      { role: 'cut' },
      { role: 'copy' },
      { role: 'paste' },
      ...(mac ? [{ role: 'pasteAndMatchStyle' } satisfies MenuItemConstructorOptions] : []),
      { role: 'delete' },
      { role: 'selectAll' },
      ...(mac
        ? [separator, { label: 'Speech', submenu: [{ role: 'startSpeaking' }, { role: 'stopSpeaking' }] } satisfies MenuItemConstructorOptions]
        : []),
    ],
  };

  const view: MenuItemConstructorOptions = {
    label: 'View',
    submenu: [
      { id: 'actual-size', label: 'Actual Size', accelerator: 'CmdOrCtrl+0', enabled: state.zoom !== 1, click: () => actions.zoom('reset') },
      { id: 'zoom-in', label: 'Zoom In', accelerator: 'CmdOrCtrl+=', enabled: state.zoom < ZOOM_MAX, click: () => actions.zoom('in') },
      // Cmd-Plus too, for a keyboard where + is its own key. Hidden, so the menu lists Zoom In once.
      {
        id: 'zoom-in-plus',
        label: 'Zoom In',
        accelerator: 'CmdOrCtrl+Plus',
        visible: false,
        enabled: state.zoom < ZOOM_MAX,
        click: () => actions.zoom('in'),
      },
      { id: 'zoom-out', label: 'Zoom Out', accelerator: 'CmdOrCtrl+-', enabled: state.zoom > ZOOM_MIN, click: () => actions.zoom('out') },
      separator,
      { role: 'togglefullscreen', label: 'Toggle Full Screen' },
      ...(state.packaged
        ? []
        : [
            separator,
            { role: 'reload' } satisfies MenuItemConstructorOptions,
            { role: 'forceReload' } satisfies MenuItemConstructorOptions,
            { role: 'toggleDevTools', label: 'Toggle Developer Tools' } satisfies MenuItemConstructorOptions,
          ]),
    ],
  };

  const go: MenuItemConstructorOptions = {
    label: 'Go',
    submenu: [
      { id: 'back', label: 'Back', accelerator: 'CmdOrCtrl+[', click: () => actions.back() },
      { id: 'forward', label: 'Forward', accelerator: 'CmdOrCtrl+]', click: () => actions.forward() },
      separator,
      { id: 'home', label: 'Home', accelerator: 'Shift+CmdOrCtrl+H', click: () => actions.command('home') },
      { id: 'go-to', label: 'Go to…', accelerator: 'CmdOrCtrl+K', click: () => actions.command('go-to') },
      { id: 'search', label: 'Search', accelerator: 'Shift+CmdOrCtrl+F', click: () => actions.command('search') },
    ],
  };

  const server: MenuItemConstructorOptions = {
    label: 'Server',
    submenu: [
      { id: 'server-status', label: serverStatusLabel(state), enabled: false },
      separator,
      {
        id: 'restart-server',
        label: 'Restart Server',
        enabled: (state.startedHere && state.server === 'ready') || state.server === 'failed',
        click: () => actions.restartServer(),
      },
      { id: 'server-log', label: 'Show Server Log', enabled: state.logExists && !attached(state), click: () => actions.showServerLog() },
      // The sampler reads macOS tools, so the monitor is the Mac's only.
      ...(mac ? [separator, { id: 'activity-monitor', label: 'Activity Monitor', click: () => actions.activityMonitor() }] : []),
    ],
  };

  const window: MenuItemConstructorOptions = { role: 'windowMenu' };
  const help: MenuItemConstructorOptions = { role: 'help', submenu: mac ? [] : [about] };

  return [...(mac ? [appMenu] : []), file, edit, view, go, server, window, help];
}

/** Hash routes for the commands a window can carry out just by opening there, for when no Omni window is open. */
export function commandRoute(command: DesktopCommand): string | null {
  switch (command) {
    case 'home':
    case 'new-thread':
      return '#/';
    case 'settings':
      return '#/settings';
    case 'search':
      return '#/search?q=';
    case 'go-to':
      return null;
  }
}

/** What a right-click on the page tells the main process (a subset of Electron's ContextMenuParams). */
export interface EditMenuParams {
  isEditable: boolean;
  selectionText: string;
  misspelledWord: string;
  dictionarySuggestions: string[];
  editFlags: { canCut: boolean; canCopy: boolean; canPaste: boolean; canSelectAll: boolean };
}

export interface EditMenuActions {
  replaceMisspelling(word: string): void;
  learnWord(word: string): void;
}

/**
 * The native menu for a text field or a selection. Empty for anything else: the page's own menu (ContextMenuHost)
 * takes right-clicks on threads, folders and channels, and Electron never hears of those.
 */
export function editMenuTemplate(params: EditMenuParams, actions: EditMenuActions): MenuItemConstructorOptions[] {
  const selected = params.selectionText.trim().length > 0;
  if (!params.isEditable) {
    return selected ? [{ role: 'copy', enabled: params.editFlags.canCopy }] : [];
  }
  const spelling: MenuItemConstructorOptions[] = [];
  if (params.misspelledWord) {
    const word = params.misspelledWord;
    for (const suggestion of params.dictionarySuggestions.slice(0, 5)) {
      spelling.push({ label: suggestion, click: () => actions.replaceMisspelling(suggestion) });
    }
    if (!spelling.length) spelling.push({ label: 'No Guesses Found', enabled: false });
    spelling.push(separator, { label: 'Learn Spelling', click: () => actions.learnWord(word) }, separator);
  }
  return [
    ...spelling,
    { role: 'cut', enabled: params.editFlags.canCut },
    { role: 'copy', enabled: params.editFlags.canCopy },
    { role: 'paste', enabled: params.editFlags.canPaste },
    separator,
    { role: 'selectAll', enabled: params.editFlags.canSelectAll },
  ];
}
