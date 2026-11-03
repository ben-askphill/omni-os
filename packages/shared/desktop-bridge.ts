// What the desktop app (apps/desktop, Electron) adds to the Web UI: `window.omniDesktop`, set by its preload.
// The Web UI in a browser or on a phone has no bridge, so every caller checks for it (apps/web/src/desktop.ts).
// Types and the few pure rules both sides share. The preload implements it over IPC, the main process answers.

export type DesktopPlatform = 'darwin' | 'linux' | 'win32';

/** A menu item or global shortcut that the page carries out, because only the page knows how. */
export type DesktopCommand = 'new-thread' | 'go-to' | 'search' | 'home' | 'settings';

export type DesktopEvent =
  | { type: 'command'; command: DesktopCommand }
  /** The machine woke from sleep or came back online: worth asking the server to sync. */
  | { type: 'resume' }
  | { type: 'update'; update: DesktopUpdateView }
  | { type: 'settings'; settings: DesktopSettings }
  /** To the Quick Prompt panel only. `open`: it was just shown. `shortcut`: its shortcut, pressed while it shows. `hidden`: it was put away. */
  | { type: 'quick-prompt'; action: 'open' | 'shortcut' | 'hidden' };

/** The Quick Prompt's shortcut choices. Fixed, so none is a key the OS keeps for itself (Cmd-Space is Spotlight). */
export const QUICK_PROMPT_SHORTCUTS = ['controlOptionSpace', 'optionSpace', 'shiftOptionSpace', 'controlShiftSpace'] as const;
export type QuickPromptShortcut = (typeof QUICK_PROMPT_SHORTCUTS)[number];

/** Electron accelerator per choice. Option is Alt off the Mac. */
export const QUICK_PROMPT_ACCELERATORS: Record<QuickPromptShortcut, string> = {
  controlOptionSpace: 'Control+Alt+Space',
  optionSpace: 'Alt+Space',
  shiftOptionSpace: 'Shift+Alt+Space',
  controlShiftSpace: 'Control+Shift+Space',
};

export function quickPromptShortcutLabel(shortcut: QuickPromptShortcut, platform: DesktopPlatform): string {
  const mac = platform === 'darwin';
  switch (shortcut) {
    case 'controlOptionSpace':
      return mac ? '⌃⌥Space' : 'Ctrl+Alt+Space';
    case 'optionSpace':
      return mac ? '⌥Space' : 'Alt+Space';
    case 'shiftOptionSpace':
      return mac ? '⌥⇧Space' : 'Alt+Shift+Space';
    case 'controlShiftSpace':
      return mac ? '⌃⇧Space' : 'Ctrl+Shift+Space';
  }
}

export const ZOOM_MIN = 0.8;
export const ZOOM_MAX = 1.6;
export const ZOOM_STEP = 0.1;

/** Keeps a zoom factor in range and on a whole step, so In and Out land back on 100%. */
export function clampZoom(factor: number): number {
  if (!Number.isFinite(factor)) return 1;
  const stepped = Math.round(factor / ZOOM_STEP) * ZOOM_STEP;
  return Math.round(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, stepped)) * 100) / 100;
}

export interface DesktopSettings {
  quickPrompt: {
    enabled: boolean;
    shortcut: QuickPromptShortcut;
    /** Start Wispr Flow hands-free as the panel opens (macOS, when Wispr Flow is installed). */
    dictate: boolean;
  };
  /** Open at login. Only where `loginItemSupported`. */
  launchAtLogin: boolean;
  zoom: number;
}

export const DEFAULT_DESKTOP_SETTINGS: DesktopSettings = {
  quickPrompt: { enabled: true, shortcut: 'controlOptionSpace', dictate: true },
  launchAtLogin: false,
  zoom: 1,
};

export type DesktopSettingsPatch = {
  quickPrompt?: Partial<DesktopSettings['quickPrompt']>;
  launchAtLogin?: boolean;
  zoom?: number;
};

/** Reads stored settings field by field: an unknown or broken value takes its default, never fails the whole file. */
export function parseDesktopSettings(raw: unknown): DesktopSettings {
  const d = DEFAULT_DESKTOP_SETTINGS;
  const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
  const root = obj(raw);
  const qp = obj(root.quickPrompt);
  const bool = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback);
  const shortcut = QUICK_PROMPT_SHORTCUTS.includes(qp.shortcut as QuickPromptShortcut) ? (qp.shortcut as QuickPromptShortcut) : d.quickPrompt.shortcut;
  return {
    quickPrompt: { enabled: bool(qp.enabled, d.quickPrompt.enabled), shortcut, dictate: bool(qp.dictate, d.quickPrompt.dictate) },
    launchAtLogin: bool(root.launchAtLogin, d.launchAtLogin),
    zoom: typeof root.zoom === 'number' ? clampZoom(root.zoom) : d.zoom,
  };
}

export function applySettingsPatch(current: DesktopSettings, patch: DesktopSettingsPatch): DesktopSettings {
  return parseDesktopSettings({
    ...current,
    ...patch,
    quickPrompt: { ...current.quickPrompt, ...patch.quickPrompt },
  });
}

/** The app's own updater (electron-updater). `unsupported` covers dev builds, an app in a folder it cannot replace itself in, and no feed. */
export type DesktopUpdateView =
  | { state: 'unsupported'; reason: string }
  | { state: 'idle'; checkedAt: string | null }
  | { state: 'checking' }
  | { state: 'downloading'; version: string; percent: number }
  /** Downloaded. Relaunch installs it. */
  | { state: 'ready'; version: string }
  /** `downloadUrl`: the page with the latest build, to get it by hand while the app cannot update itself. */
  | { state: 'error'; message: string; downloadUrl?: string };

export interface DesktopServerInfo {
  port: number;
  dataDir: string;
  logFile: string;
  /** This app started the server, so quitting the app stops it. False when it attached to one already running. */
  startedHere: boolean;
}

/**
 * Who started the server, as the Server menu and Settings > Desktop app both say it. An attached server's log is not
 * `logFile`, which only the app's own server writes to, so neither offers it.
 */
export const serverOriginLabel = (startedHere: boolean): string => (startedHere ? 'started by this app' : 'started outside this app');

export interface DesktopBridge {
  readonly platform: DesktopPlatform;
  /** The app's version, as its About panel shows it. */
  readonly version: string;
  readonly packaged: boolean;
  readonly loginItemSupported: boolean;
  /** Subscribes to the main process. Returns the unsubscribe. */
  onEvent(listener: (event: DesktopEvent) => void): () => void;
  /** Opens a hash route (`#/t/<id>`) in a window of its own. */
  openWindow(route: string): void;
  /** Brings this window forward, as a notification click should. */
  focus(): void;
  /** Keeps the native window chrome and menus on the theme the Web UI picked. */
  setAppearance(mode: 'system' | 'light' | 'dark'): void;
  settings: {
    get(): Promise<DesktopSettings>;
    set(patch: DesktopSettingsPatch): Promise<DesktopSettings>;
  };
  quickPrompt: {
    /** Closes the Quick Prompt panel. With a route, the main window opens there. */
    done(route?: string): void;
    status(): Promise<QuickPromptStatus>;
    /** Shows the panel, as its shortcut does. */
    open(): void;
    /** The panel's page asks for its height in CSS pixels, so the panel fits the prompt as it grows. */
    resize(height: number): void;
  };
  /** Starts or stops Wispr Flow hands-free dictation (macOS). */
  wispr(action: 'start' | 'stop'): void;
  updates: {
    get(): Promise<DesktopUpdateView>;
    check(): Promise<DesktopUpdateView>;
    /** Quits, installs the downloaded update and opens the app again. */
    install(): void;
  };
  server: {
    info(): Promise<DesktopServerInfo>;
    showLog(): void;
  };
  /** The Web tab's real browser (`<webview>`). The main process gives each one its session and pick preload. */
  nativeBrowser: {
    /** A screenshot of the visible page of this window's `<webview>`, by its `getWebContentsId()`. */
    capture(webContentsId: number): Promise<NativeBrowserShot>;
  };
}

/** A Web tab screenshot: a PNG while it fits the server's inline limit, else a JPEG. */
export interface NativeBrowserShot {
  mime: 'image/png' | 'image/jpeg';
  data: Uint8Array;
}

// The Web tab's page and the Omni page that shows it talk directly, never through the main process: the host asks with
// `webview.send(NATIVE_PICK_ASK, request)`, and the guest's pick preload answers with `ipcRenderer.sendToHost`.
export const NATIVE_PICK_ASK = 'omni-pick:ask';
export const NATIVE_PICK_ANSWER = 'omni-pick:answer';
/** Unasked, guest to host: the page scrolled, or a key the Web tab handles was pressed in the page. */
export const NATIVE_PICK_EVENT = 'omni-pick:event';

export type NativePickRequest = { id: number; op: 'look' } | { id: number; op: 'inspect' | 'pick'; x: number; y: number };

/** `value`: a NativePageLook for `look`, else what the shared pick script returned (RawInspect or RawPick), unchecked. */
export interface NativePickAnswer {
  id: number;
  value: unknown;
}

/** The page as its own window sees it, in CSS pixels. */
export interface NativePageLook {
  url: string;
  title: string;
  width: number;
  height: number;
  scrollX: number;
  scrollY: number;
}

export type NativeGuestEvent =
  | { type: 'scroll'; x: number; y: number }
  /** Escape and Alt for live Annotate, and the browser's own shortcuts (`l` address bar, `r` reload, `[` back, `]` forward). */
  | { type: 'key'; key: 'Escape' | 'Alt' | 'l' | 'r' | '[' | ']'; down: boolean };

export interface QuickPromptStatus {
  /** False while another app holds the shortcut. True while the Quick Prompt is off. */
  registered: boolean;
  /** Wispr Flow is installed and takes its links (macOS). */
  wispr: boolean;
  /** The panel shows now. */
  visible: boolean;
}
