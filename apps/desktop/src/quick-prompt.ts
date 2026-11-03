// The Quick Prompt: a shortcut from any app opens a small panel that starts a thread.
// The panel is one reused window on the Web UI's #/quick-prompt page. The page keeps the prompt and Wispr Flow's
// listening state; this side registers the shortcut, places, shows and hides the panel, and opens Wispr Flow's links.
import { app, BrowserWindow, globalShortcut, screen, shell, type Rectangle } from 'electron';
import {
  QUICK_PROMPT_ACCELERATORS,
  type DesktopEvent,
  type DesktopSettings,
  type QuickPromptStatus,
} from '@omni/shared/desktop-bridge.ts';
import type { AppContext } from './context.ts';
import { handle, on } from './handle.ts';
import { EVENT } from './ipc.ts';
import { safeRoute } from './options.ts';
import { isWebUiDocument, linkTarget } from './window-rules.ts';
import { routeUrl } from './windows.ts';

const MAC = process.platform === 'darwin';

export const QUICK_PROMPT_ROUTE = '#/quick-prompt';
export const PANEL_WIDTH = 640;
export const PANEL_MIN_HEIGHT = 96;
export const PANEL_MAX_HEIGHT = 600;
const SETTLE_MS = 400;

// On Wayland, Chromium reaches global shortcuts only through the desktop portal's GlobalShortcuts, behind this feature.
// It keeps any features already asked for on the command line.
if (process.platform === 'linux' && (process.env.XDG_SESSION_TYPE === 'wayland' || process.env.WAYLAND_DISPLAY)) {
  const prior = app.commandLine.getSwitchValue('enable-features');
  app.commandLine.appendSwitch('enable-features', prior ? `${prior},GlobalShortcutsPortal` : 'GlobalShortcutsPortal');
}

/** The accelerator to hold for these settings, or null while the Quick Prompt is off. */
export function acceleratorFor(settings: DesktopSettings): string | null {
  return settings.quickPrompt.enabled ? QUICK_PROMPT_ACCELERATORS[settings.quickPrompt.shortcut] : null;
}

/** The panel's top-left corner: centered on the screen under the pointer, its top edge 22% down the work area. */
export function panelOrigin(area: Rectangle, width: number): { x: number; y: number } {
  return { x: Math.round(area.x + (area.width - width) / 2), y: Math.round(area.y + area.height * 0.22) };
}

/** The panel's height in window pixels for a page that is `cssHeight` tall at `zoom`, kept on screen. */
export function panelHeight(cssHeight: number, zoom: number): number {
  if (!Number.isFinite(cssHeight) || cssHeight <= 0) return PANEL_MIN_HEIGHT;
  const z = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  return Math.min(PANEL_MAX_HEIGHT, Math.max(PANEL_MIN_HEIGHT, Math.ceil(cssHeight * z)));
}

/** Wispr Flow's link for hands-free dictation. Flow takes these without showing its window. */
export function wisprUrl(action: 'start' | 'stop'): string {
  return `wispr-flow://${action}-hands-free`;
}

/** The link to send as Omni quits: Wispr Flow outlives Omni, so dictation the panel started would keep the mic on. */
export function wisprOnQuit(listening: boolean): string | null {
  return listening ? wisprUrl('stop') : null;
}

interface State {
  ctx: AppContext | null;
  panel: BrowserWindow | null;
  accelerator: string | null;
  /** False while another app holds the shortcut. */
  registered: boolean;
  /** macOS: Omni was the active app when the panel opened, so putting it away should not hand focus back. */
  wasActive: boolean;
  /** macOS: whether Omni is the active app now. */
  active: boolean;
  /** When the panel last showed itself or changed its own size. */
  movedAt: number;
  /** The last link sent to Wispr Flow was start: it is listening for the panel. */
  wisprListening: boolean;
}

const state: State = {
  ctx: null,
  panel: null,
  accelerator: null,
  registered: true,
  wasActive: false,
  active: false,
  movedAt: 0,
  wisprListening: false,
};

export function installQuickPrompt(ctx: AppContext): void {
  if (state.ctx) return;
  state.ctx = ctx;

  handle('omni:quick-prompt:status', () => status());
  on('omni:quick-prompt:open', () => openQuickPrompt(ctx));
  on('omni:quick-prompt:done', (event, route) => {
    if (event.sender !== livePanel()?.webContents) return;
    hide(ctx, { route: safeRoute(route) ?? undefined, handBack: true });
  });
  on('omni:quick-prompt:resize', (event, height) => {
    const panel = livePanel();
    if (!panel || event.sender !== panel.webContents || typeof height !== 'number') return;
    const bounds = panel.getBounds();
    const next = panelHeight(height, panel.webContents.getZoomFactor());
    if (next === bounds.height) return;
    state.movedAt = Date.now();
    panel.setBounds({ x: bounds.x, y: bounds.y, width: PANEL_WIDTH, height: next });
  });
  on('omni:wispr', (_event, action) => {
    if ((action !== 'start' && action !== 'stop') || !wisprInstalled()) return;
    state.wisprListening = action === 'start';
    void shell.openExternal(wisprUrl(action), { activate: false });
  });
  // Quitting with the panel open (Cmd-Q while it listens) closes it without the page's own stop. A quit the dialog
  // in quit.ts still holds (event.defaultPrevented) may yet be cancelled, so wait for the one that goes through.
  app.on('before-quit', (event) => {
    if (event.defaultPrevented) return;
    const stop = wisprOnQuit(state.wisprListening);
    if (!stop) return;
    state.wisprListening = false;
    hide(ctx, { handBack: false });
    void shell.openExternal(stop, { activate: false });
  });

  if (MAC) {
    state.active = BrowserWindow.getFocusedWindow() !== null;
    app.on('did-become-active', () => (state.active = true));
    app.on('did-resign-active', () => (state.active = false));
  } else {
    // A hidden panel is still a window, so it would keep the app open after its last real window closes.
    const watch = (win: BrowserWindow) =>
      win.on('closed', () => {
        const panel = livePanel();
        if (panel && BrowserWindow.getAllWindows().every((w) => w === panel)) panel.destroy();
      });
    BrowserWindow.getAllWindows().forEach(watch);
    app.on('browser-window-created', (_event, win) => watch(win));
  }

  apply(ctx.settings.get());
  ctx.settings.onChange((next) => apply(next));
  app.on('will-quit', () => {
    if (state.accelerator && state.registered) globalShortcut.unregister(state.accelerator);
  });
}

/** Opens the panel, as the shortcut and File > Quick Prompt do. */
export function openQuickPrompt(ctx: AppContext): void {
  // Before the server is up the panel could neither send nor close.
  if (!state.ctx) return;
  const existing = livePanel();
  if (!existing?.isVisible()) state.wasActive = state.active;
  if (!existing) {
    // The page runs its own open as it first shows (QuickPromptStatus.visible), so no event goes ahead of it.
    const panel = createPanel(ctx);
    panel.once('ready-to-show', () => reveal(panel));
    return;
  }
  if (existing.webContents.isLoading()) return;
  if (!existing.isVisible()) reveal(existing);
  send(existing, { type: 'quick-prompt', action: 'open' });
}

function status(): QuickPromptStatus {
  return { registered: state.registered, wispr: wisprInstalled(), visible: livePanel()?.isVisible() ?? false };
}

function livePanel(): BrowserWindow | null {
  return state.panel && !state.panel.isDestroyed() ? state.panel : null;
}

function send(panel: BrowserWindow, event: DesktopEvent): void {
  panel.webContents.send(EVENT, event);
}

/** Holds the shortcut the settings name, and lets go of the old one. False from register: another app has it. */
function apply(settings: DesktopSettings): void {
  const accelerator = acceleratorFor(settings);
  if (accelerator === state.accelerator) return;
  if (state.accelerator && state.registered) globalShortcut.unregister(state.accelerator);
  state.accelerator = accelerator;
  state.registered = accelerator ? register(accelerator) : true;
}

function register(accelerator: string): boolean {
  try {
    const ok = globalShortcut.register(accelerator, () => {
      if (state.ctx) toggle(state.ctx);
    });
    if (!ok) console.warn(`[omni] Quick Prompt: another app already uses ${accelerator}`);
    return ok;
  } catch (err) {
    console.warn(`[omni] Quick Prompt: could not register ${accelerator}:`, err);
    return false;
  }
}

/** The shortcut opens the panel. While it shows, the page decides: stop Wispr Flow so its words land, or close. */
function toggle(ctx: AppContext): void {
  const panel = livePanel();
  if (panel?.isVisible()) send(panel, { type: 'quick-prompt', action: 'shortcut' });
  else openQuickPrompt(ctx);
}

/** macOS: Wispr Flow is installed when an app takes its links. Elsewhere the panel never starts it. */
function wisprInstalled(): boolean {
  return MAC && app.getApplicationNameForProtocol(wisprUrl('start')) !== '';
}

function createPanel(ctx: AppContext): BrowserWindow {
  const panel = new BrowserWindow({
    width: PANEL_WIDTH,
    height: 150,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: MAC,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    title: 'Quick Prompt',
    // A non-activating panel that floats over full-screen apps and shows on every Space.
    type: MAC ? 'panel' : undefined,
    icon: ctx.paths.icon ?? undefined,
    webPreferences: {
      preload: ctx.paths.preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
    },
  });
  state.panel = panel;
  panel.setAlwaysOnTop(true, 'floating');
  panel.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  // Clicking elsewhere puts it away, and leaves focus where the click went. A compositor that focuses the window
  // under the pointer (Hyprland, Sway) can take the focus as the panel shows or resizes itself; that blur is not the user's.
  panel.on('blur', () => {
    if (Date.now() - state.movedAt < SETTLE_MS) panel.focus();
    else hide(ctx, { handBack: false });
  });
  panel.on('closed', () => {
    if (state.panel === panel) state.panel = null;
  });
  // Origins, not prefixes: http://127.0.0.1:4747@evil.example/ starts with the app's URL too.
  panel.webContents.setWindowOpenHandler(({ url }) => {
    const target = linkTarget(url, { app: ctx.appUrl(), server: ctx.backend.origin() });
    if (target.kind === 'external' && /^https?:/.test(target.url)) void shell.openExternal(target.url);
    return { action: 'deny' };
  });
  panel.webContents.on('will-navigate', (event, url) => {
    if (!isWebUiDocument(url, ctx.appUrl())) event.preventDefault();
  });
  void panel.loadURL(routeUrl(ctx.appUrl(), QUICK_PROMPT_ROUTE)).catch((err: unknown) => {
    if (!panel.isDestroyed()) console.error('[omni] Quick Prompt failed to load:', err);
  });
  return panel;
}

function reveal(panel: BrowserWindow): void {
  if (panel.isDestroyed()) return;
  const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  const { x, y } = panelOrigin(area, PANEL_WIDTH);
  panel.setBounds({ x, y, width: PANEL_WIDTH, height: panel.getBounds().height });
  state.movedAt = Date.now();
  // show() activates the app on macOS, which brings every Omni window forward. A 'panel' window becomes key through
  // focus() without activating. Wayland has no showInactive.
  if (MAC) panel.showInactive();
  else panel.show();
  panel.focus();
  panel.webContents.focus();
}

/** Puts the panel away. With a route, the main window opens there and comes forward. */
function hide(ctx: AppContext, input: { route?: string; handBack: boolean }): void {
  const panel = livePanel();
  const shown = panel?.isVisible() ?? false;
  if (panel && shown) {
    panel.hide();
    send(panel, { type: 'quick-prompt', action: 'hidden' });
  }
  if (input.route) {
    ctx.showMain(input.route);
    if (MAC) app.focus({ steal: true });
  } else if (MAC && shown && input.handBack && !state.wasActive && state.active) {
    // A fallback: the panel should not activate Omni, but if it did, hand focus back to the app the shortcut was pressed in.
    app.hide();
  }
}
