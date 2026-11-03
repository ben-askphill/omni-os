import type { MenuItemConstructorOptions } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import type { DesktopCommand } from '@omni/shared/desktop-bridge.ts';
import { commandRoute, desktopPlatform, editMenuTemplate, menuTemplate, serverStatusLabel, type MenuActions, type MenuState } from '../src/menu-template.ts';

const state = (over: Partial<MenuState> = {}): MenuState => ({
  platform: 'darwin',
  packaged: true,
  port: 4747,
  server: 'ready',
  startedHere: true,
  zoom: 1,
  logExists: true,
  ...over,
});

const actions = (): MenuActions & { commands: DesktopCommand[] } => {
  const commands: DesktopCommand[] = [];
  return {
    commands,
    command: (c) => commands.push(c),
    quickPrompt: vi.fn(),
    newWindow: vi.fn(),
    zoom: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    restartServer: vi.fn(),
    showServerLog: vi.fn(),
    activityMonitor: vi.fn(),
  };
};

const sub = (item: MenuItemConstructorOptions) => (item.submenu ?? []) as MenuItemConstructorOptions[];
const top = (template: MenuItemConstructorOptions[]) => template.map((m) => m.label ?? m.role);
const menu = (template: MenuItemConstructorOptions[], label: string) => {
  const found = template.find((m) => m.label === label || m.role === label);
  if (!found) throw new Error(`no ${label} menu`);
  return sub(found);
};
const item = (template: MenuItemConstructorOptions[], id: string) => {
  const found = template.flatMap(sub).find((m) => m.id === id);
  if (!found) throw new Error(`no ${id} item`);
  return found;
};
const click = (entry: MenuItemConstructorOptions) => (entry.click as () => void)();
const visible = (items: MenuItemConstructorOptions[]) => items.filter((m) => m.type !== 'separator' && m.visible !== false).map((m) => m.label ?? m.role);

describe('application menu', () => {
  it('has the Mac app menus, with the app menu first on macOS', () => {
    expect(top(menuTemplate(state(), actions()))).toEqual(['Omni', 'File', 'Edit', 'View', 'Go', 'Server', 'windowMenu', 'help']);
    expect(visible(menu(menuTemplate(state(), actions()), 'Omni'))).toEqual([
      'About Omni', 'Settings…', 'services', 'Hide Omni', 'hideOthers', 'Show All', 'Quit Omni',
    ]);
  });

  it('puts the app items under File and Help off the Mac', () => {
    const t = menuTemplate(state({ platform: 'linux' }), actions());
    expect(top(t)).toEqual(['File', 'Edit', 'View', 'Go', 'Server', 'windowMenu', 'help']);
    expect(visible(menu(t, 'File'))).toEqual(['New Thread', 'Quick Prompt', 'New Window', 'Close Window', 'Settings…', 'Quit']);
    expect(visible(menu(t, 'help'))).toEqual(['About Omni']);
    expect(visible(menu(t, 'Edit'))).not.toContain('pasteAndMatchStyle');
  });

  it('keeps the Mac shortcuts, as Cmd or Ctrl', () => {
    const t = menuTemplate(state(), actions());
    const keys = Object.fromEntries(
      ['settings', 'new-thread', 'new-window', 'actual-size', 'zoom-in', 'zoom-in-plus', 'zoom-out', 'back', 'forward', 'home', 'go-to', 'search'].map(
        (id) => [id, item(t, id).accelerator],
      ),
    );
    expect(keys).toEqual({
      settings: 'CmdOrCtrl+,',
      'new-thread': 'CmdOrCtrl+N',
      'new-window': 'Shift+CmdOrCtrl+N',
      'actual-size': 'CmdOrCtrl+0',
      'zoom-in': 'CmdOrCtrl+=',
      'zoom-in-plus': 'CmdOrCtrl+Plus',
      'zoom-out': 'CmdOrCtrl+-',
      back: 'CmdOrCtrl+[',
      forward: 'CmdOrCtrl+]',
      home: 'Shift+CmdOrCtrl+H',
      'go-to': 'CmdOrCtrl+K',
      search: 'Shift+CmdOrCtrl+F',
    });
    expect(visible(menu(t, 'Go'))).toEqual(['Back', 'Forward', 'Home', 'Go to…', 'Search']);
  });

  it('sends each page command', () => {
    const a = actions();
    const t = menuTemplate(state(), a);
    for (const id of ['settings', 'new-thread', 'home', 'go-to', 'search']) click(item(t, id));
    expect(a.commands).toEqual(['settings', 'new-thread', 'home', 'go-to', 'search']);
    click(item(t, 'quick-prompt'));
    click(item(t, 'activity-monitor'));
    expect(a.quickPrompt).toHaveBeenCalledOnce();
    expect(a.activityMonitor).toHaveBeenCalledOnce();
  });

  it('zooms in steps and disables a step past the range', () => {
    const a = actions();
    const t = menuTemplate(state(), a);
    click(item(t, 'zoom-in'));
    click(item(t, 'zoom-in-plus'));
    click(item(t, 'zoom-out'));
    click(item(t, 'actual-size'));
    expect(vi.mocked(a.zoom).mock.calls.map((c) => c[0])).toEqual(['in', 'in', 'out', 'reset']);
    expect(item(t, 'actual-size').enabled).toBe(false);
    const max = menuTemplate(state({ zoom: 1.6 }), a);
    expect([item(max, 'zoom-in').enabled, item(max, 'zoom-out').enabled, item(max, 'actual-size').enabled]).toEqual([false, true, true]);
    const min = menuTemplate(state({ zoom: 0.8 }), a);
    expect([item(min, 'zoom-in').enabled, item(min, 'zoom-out').enabled]).toEqual([true, false]);
  });

  it('shows the developer items only in a build that is not packaged', () => {
    const roles = (packaged: boolean) => menu(menuTemplate(state({ packaged }), actions()), 'View').map((m) => m.role).filter(Boolean);
    expect(roles(true)).toEqual(['togglefullscreen']);
    expect(roles(false)).toEqual(['togglefullscreen', 'reload', 'forceReload', 'toggleDevTools']);
  });

  it('restarts only a server this app started and is running', () => {
    expect(item(menuTemplate(state(), actions()), 'restart-server').enabled).toBe(true);
    expect(item(menuTemplate(state({ startedHere: false }), actions()), 'restart-server').enabled).toBe(false);
    expect(item(menuTemplate(state({ server: 'restarting' }), actions()), 'restart-server').enabled).toBe(false);
    expect(item(menuTemplate(state({ logExists: false }), actions()), 'server-log').enabled).toBe(false);
  });

  it("offers the log of the app's own server only, and after a failure", () => {
    expect(item(menuTemplate(state(), actions()), 'server-log').enabled).toBe(true);
    // A server running when the app opened writes elsewhere: the app's log file holds some other server's output.
    expect(item(menuTemplate(state({ startedHere: false }), actions()), 'server-log').enabled).toBe(false);
    expect(item(menuTemplate(state({ startedHere: false, server: 'failed' }), actions()), 'server-log').enabled).toBe(true);
  });

  it('labels the server state', () => {
    expect(serverStatusLabel({ port: 4747, server: 'ready', startedHere: true })).toBe('Port 4747: running');
    expect(serverStatusLabel({ port: 4762, server: 'ready', startedHere: false })).toBe('Port 4762: running, started outside this app');
    expect(serverStatusLabel({ port: 4747, server: 'failed', startedHere: false })).toBe('Port 4747: not running');
  });
});

describe('commandRoute', () => {
  it('opens a closed app where the command leads', () => {
    expect(commandRoute('home')).toBe('#/');
    expect(commandRoute('new-thread')).toBe('#/');
    expect(commandRoute('settings')).toBe('#/settings');
    expect(commandRoute('search')).toBe('#/search?q=');
    expect(commandRoute('go-to')).toBeNull();
  });
});

describe('editMenuTemplate', () => {
  const flags = { canCut: true, canCopy: true, canPaste: true, canSelectAll: true };
  const edit = { replaceMisspelling: vi.fn(), learnWord: vi.fn() };
  const base = { isEditable: false, selectionText: '', misspelledWord: '', dictionarySuggestions: [], editFlags: flags };

  it('shows nothing for a plain right-click', () => {
    expect(editMenuTemplate(base, edit)).toEqual([]);
  });

  it('offers Copy for a selection', () => {
    expect(editMenuTemplate({ ...base, selectionText: 'hello' }, edit).map((m) => m.role)).toEqual(['copy']);
  });

  it('offers the edit roles in a text field', () => {
    const t = editMenuTemplate({ ...base, isEditable: true, editFlags: { ...flags, canCut: false } }, edit);
    expect(t.map((m) => m.role ?? m.type)).toEqual(['cut', 'copy', 'paste', 'separator', 'selectAll']);
    expect(t[0]!.enabled).toBe(false);
  });

  it('puts spelling suggestions first', () => {
    const t = editMenuTemplate({ ...base, isEditable: true, misspelledWord: 'teh', dictionarySuggestions: ['the', 'ten'] }, edit);
    expect(t.slice(0, 5).map((m) => m.label ?? m.type)).toEqual(['the', 'ten', 'separator', 'Learn Spelling', 'separator']);
    (t[0]!.click as () => void)();
    (t[3]!.click as () => void)();
    expect(edit.replaceMisspelling).toHaveBeenCalledWith('the');
    expect(edit.learnWord).toHaveBeenCalledWith('teh');
    const none = editMenuTemplate({ ...base, isEditable: true, misspelledWord: 'qzx' }, edit);
    expect(none[0]).toMatchObject({ label: 'No Guesses Found', enabled: false });
  });
});

describe('the Server menu off the Mac', () => {
  it('offers the activity monitor on the Mac only, where its sampler runs', () => {
    const ids = (platform: MenuState['platform']) => (menu(menuTemplate(state({ platform }), actions()), 'Server').map((m) => m.id).filter(Boolean));
    expect(ids('darwin')).toContain('activity-monitor');
    expect(ids('linux')).not.toContain('activity-monitor');
    expect(ids('win32')).not.toContain('activity-monitor');
  });

  it('names any platform but the Mac and Windows Linux', () => {
    expect(desktopPlatform('darwin')).toBe('darwin');
    expect(desktopPlatform('win32')).toBe('win32');
    expect(desktopPlatform('linux')).toBe('linux');
    expect(desktopPlatform('freebsd')).toBe('linux');
  });
});
