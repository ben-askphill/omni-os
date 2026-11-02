import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_DESKTOP_SETTINGS, applySettingsPatch } from '@omni/shared/desktop-bridge.ts';

// The module asks Electron for its command line as it loads; the rules under test are pure.
const appended: [string, string][] = [];
vi.mock('electron', () => ({
  app: { commandLine: { getSwitchValue: () => 'Foo', appendSwitch: (name: string, value: string) => appended.push([name, value]) } },
  BrowserWindow: class {},
  globalShortcut: {},
  ipcMain: {},
  screen: {},
  shell: {},
}));

const qp = await import('../src/quick-prompt.ts');

describe('the Quick Prompt shortcut', () => {
  it('holds the chosen accelerator while on, and none while off', () => {
    expect(qp.acceleratorFor(DEFAULT_DESKTOP_SETTINGS)).toBe('Control+Alt+Space');
    expect(qp.acceleratorFor(applySettingsPatch(DEFAULT_DESKTOP_SETTINGS, { quickPrompt: { shortcut: 'optionSpace' } }))).toBe('Alt+Space');
    expect(qp.acceleratorFor(applySettingsPatch(DEFAULT_DESKTOP_SETTINGS, { quickPrompt: { enabled: false } }))).toBeNull();
  });

  it('asks Wayland for the portal and keeps the features already on the command line', () => {
    const wayland = process.platform === 'linux' && (process.env.XDG_SESSION_TYPE === 'wayland' || !!process.env.WAYLAND_DISPLAY);
    expect(appended).toEqual(wayland ? [['enable-features', 'Foo,GlobalShortcutsPortal']] : []);
  });
});

describe('the Quick Prompt panel', () => {
  it('centers on the work area, a little above the middle', () => {
    expect(qp.panelOrigin({ x: 0, y: 25, width: 1440, height: 875 }, 640)).toEqual({ x: 400, y: 218 });
    // A second display left of the main one.
    expect(qp.panelOrigin({ x: -1920, y: 0, width: 1920, height: 1080 }, 640)).toEqual({ x: -1280, y: 238 });
  });

  it('fits the page at its zoom, and stays on screen', () => {
    expect(qp.panelHeight(132, 1)).toBe(132);
    expect(qp.panelHeight(132.2, 1.25)).toBe(166);
    expect(qp.panelHeight(40, 1)).toBe(qp.PANEL_MIN_HEIGHT);
    expect(qp.panelHeight(5000, 1)).toBe(qp.PANEL_MAX_HEIGHT);
    expect(qp.panelHeight(Number.NaN, 1)).toBe(qp.PANEL_MIN_HEIGHT);
    expect(qp.panelHeight(200, 0)).toBe(200);
  });

  it('starts and stops Wispr Flow through its own links', () => {
    expect(qp.wisprUrl('start')).toBe('wispr-flow://start-hands-free');
    expect(qp.wisprUrl('stop')).toBe('wispr-flow://stop-hands-free');
  });

  it('stops Wispr Flow as Omni quits only while the panel had it listening', () => {
    expect(qp.wisprOnQuit(true)).toBe('wispr-flow://stop-hands-free');
    expect(qp.wisprOnQuit(false)).toBeNull();
  });
});
