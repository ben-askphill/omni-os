// What the app shows when the server cannot start or stops on its own: a small window with what went wrong and the
// last lines of the log. The main window stays open behind it, and the Web UI reconnects by itself once Try again
// brings the server back.
import { app, BrowserWindow, nativeTheme, shell } from 'electron';
import { existsSync } from 'node:fs';
import type { AppContext } from './context.ts';
import { installQuickPrompt } from './quick-prompt.ts';
import { bringForward } from './windows.ts';

/** The page's buttons are links to this host. The window catches the navigation and never loads it. */
const ACTION_HOST = 'omni-server-screen.invalid';
export type ScreenAction = 'try-again' | 'open-log' | 'quit';
const ACTIONS: readonly ScreenAction[] = ['try-again', 'open-log', 'quit'];

export type ScreenView =
  | { kind: 'failed'; message: string; logTail: string; logExists: boolean }
  | { kind: 'starting'; port: number };

export function actionOf(url: string): ScreenAction | null {
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== ACTION_HOST) return null;
    const action = parsed.pathname.slice(1);
    return (ACTIONS as readonly string[]).includes(action) ? (action as ScreenAction) : null;
  } catch {
    return null;
  }
}

export function escapeHtml(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

// The Web UI's tokens (apps/web/src/index.css), since this page loads before it and cannot read them.
const STYLE = `
:root { color-scheme: light dark; --bg: #ffffff; --surface: #f7f7f6; --surface-2: #f1f1f0; --surface-3: #ecebe7; --fg: #17181a;
  --fg-2: #3c3b37; --fg-3: #62615c; --line: rgba(23,24,26,.08); --warn: #b45309; --ink: #17181a; --on-ink: #ffffff; }
@media (prefers-color-scheme: dark) { :root { --bg: #121316; --surface: #191b1e; --surface-2: #222428; --surface-3: #2a2c31;
  --fg: #eceae5; --fg-2: #b8b7b1; --fg-3: #a09f99; --line: rgba(236,235,231,.08); --warn: #f5b544; --ink: #eceae5; --on-ink: #101114; } }
* { box-sizing: border-box; }
html, body { margin: 0; height: 100%; overflow: hidden; }
body { font: 400 13px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; background: var(--bg); color: var(--fg);
  display: flex; align-items: center; justify-content: center; padding: 32px 40px; -webkit-user-select: text; }
/* The window is the surface: no card inside it. */
main { width: 100%; max-width: 560px; max-height: 100%; overflow-y: auto; display: flex; flex-direction: column; align-items: center;
  text-align: center; }
main > * { flex-shrink: 0; }
.alert { color: var(--warn); display: block; }
h1 { margin: 16px 0 0; font-size: 26px; line-height: 1.15; font-weight: 500; letter-spacing: -0.01em; }
p { margin: 10px 0 0; font-size: 14px; line-height: 1.5; color: var(--fg-2); white-space: pre-wrap; overflow-wrap: anywhere; }
/* The log gives up height first, down to the caption and 48px of lines. Below that the page scrolls. */
.log { width: 100%; margin-top: 24px; min-height: 72px; flex: 0 1 auto; display: flex; flex-direction: column; text-align: left; }
main > .log { flex-shrink: 1; }
.caption { font-size: 12px; color: var(--fg-3); margin: 0 0 6px 4px; }
pre { margin: 0; min-height: 48px; max-height: 220px; flex: 0 1 auto; overflow: auto; background: var(--surface);
  border-radius: 14px; padding: 12px 14px; font: 11.5px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace;
  color: var(--fg-2); white-space: pre-wrap; overflow-wrap: anywhere; }
nav { display: flex; gap: 8px; flex-wrap: wrap; justify-content: center; margin-top: 24px; }
a { display: inline-flex; align-items: center; height: 34px; padding: 0 16px; border-radius: 999px; text-decoration: none;
  font-weight: 500; font-size: 13px; }
a.primary { background: var(--ink); color: var(--on-ink); }
a.secondary { background: var(--surface-2); color: var(--fg); }
a.secondary:hover { background: var(--surface-3); }
a.ghost { color: var(--fg-2); }
a.ghost:hover { color: var(--fg); background: var(--surface-2); }
a:focus-visible { outline: 1.5px solid var(--fg); outline-offset: 2px; }
.spinner { width: 22px; height: 22px; border: 2px solid var(--line); border-top-color: var(--fg-3); border-radius: 50%;
  animation: spin .8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.progress { color: var(--fg-3); }
`;

/** The design system's alert icon (packages/shared/icons.ts), drawn in --warn. */
const ALERT_ICON =
  '<svg class="alert" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>';

function button(action: ScreenAction, label: string, variant: 'primary' | 'secondary' | 'ghost'): string {
  return `<a href="https://${ACTION_HOST}/${action}" class="${variant}">${label}</a>`;
}

export function screenHtml(view: ScreenView): string {
  let body: string;
  if (view.kind === 'starting') {
    body = `<main><div class="spinner"></div><p class="progress">Starting the server on port ${view.port}</p></main>`;
  } else {
    const log = view.logTail.trim()
      ? `<section class="log"><div class="caption">Last lines of the server log</div><pre id="tail">${escapeHtml(view.logTail.trim())}</pre></section>`
      : '';
    const buttons = [button('try-again', 'Try again', 'primary'), view.logExists ? button('open-log', 'Show server log', 'secondary') : '', button('quit', 'Quit', 'ghost')];
    body = `<main>${ALERT_ICON}<h1>Server problem</h1><p>${escapeHtml(view.message)}</p>${log}<nav>${buttons.join('')}</nav></main>`;
  }
  // The log scrolls from the bottom. The CSP allows only this one inline script.
  const script = `<script>const t=document.getElementById('tail');if(t)t.scrollTop=t.scrollHeight;</script>`;
  return (
    `<!doctype html><html><head><meta charset="utf-8">` +
    `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'">` +
    `<title>Omni</title><style>${STYLE}</style></head><body>${body}${script}</body></html>`
  );
}

let screen: BrowserWindow | null = null;
let retrying = false;
let reopenHooked = false;

function render(win: BrowserWindow, view: ScreenView): void {
  void win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(screenHtml(view))}`);
}

function failedView(ctx: AppContext, message: string): ScreenView {
  const state = ctx.backend.current;
  const logTail = state.kind === 'failed' ? state.logTail : '';
  return { kind: 'failed', message, logTail, logExists: existsSync(ctx.backend.config.logFile) };
}

async function tryAgain(ctx: AppContext, win: BrowserWindow): Promise<void> {
  if (retrying) return;
  retrying = true;
  const firstStart = !ctx.backend.hasBeenReady;
  render(win, { kind: 'starting', port: ctx.backend.config.port });
  try {
    const state = await ctx.backend.restart();
    // A failure renders itself again: main.ts sends every failed state to showServerFailure.
    if (state.kind !== 'ready') return;
    if (!win.isDestroyed()) win.close();
    ctx.showMain();
    if (firstStart) installQuickPrompt(ctx);
  } finally {
    retrying = false;
  }
}

function perform(ctx: AppContext, win: BrowserWindow, action: ScreenAction): void {
  switch (action) {
    case 'try-again':
      void tryAgain(ctx, win);
      return;
    case 'open-log':
      void shell.openPath(ctx.backend.config.logFile);
      return;
    case 'quit':
      app.quit();
      return;
  }
}

function createScreen(ctx: AppContext): BrowserWindow {
  const win = new BrowserWindow({
    width: 640,
    height: 580,
    minWidth: 420,
    minHeight: 320,
    show: false,
    title: 'Omni',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#121316' : '#ffffff',
    autoHideMenuBar: true,
    icon: ctx.paths.icon ?? undefined,
    // A plain page: no bridge and no Node.
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.once('ready-to-show', () => win.show());
  win.webContents.on('will-navigate', (event, url) => {
    event.preventDefault();
    const action = actionOf(url);
    if (action) perform(ctx, win, action);
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.on('closed', () => {
    if (screen === win) screen = null;
  });
  return win;
}

/** Server > Restart Server while the server is down: the screen's Try again, in the screen, which it brings back. */
export function retryFromMenu(ctx: AppContext): void {
  const state = ctx.backend.current;
  if (state.kind !== 'failed') return;
  showServerFailure(ctx, state.message);
  if (screen && !screen.isDestroyed()) void tryAgain(ctx, screen);
}

/** Brings the open screen forward, failed or retrying. False when none is open. */
export function focusServerScreen(): boolean {
  if (!screen || screen.isDestroyed()) return false;
  bringForward(screen);
  return true;
}

/** Shows the failure, in the open screen or a new one. Called for each failed state, at the first start or later. */
export function showServerFailure(ctx: AppContext, message: string): void {
  if (ctx.quitting()) return;
  if (!reopenHooked) {
    reopenHooked = true;
    // A Mac app stays in the Dock with its windows closed: clicking it brings the screen back while the server is down.
    // Hidden windows such as the Quick Prompt panel and the open main window do not count, since neither offers Try again.
    app.on('activate', () => {
      const state = ctx.backend.current;
      if (state.kind !== 'failed') return;
      if (!focusServerScreen()) showServerFailure(ctx, state.message);
    });
  }
  const win = screen && !screen.isDestroyed() ? screen : createScreen(ctx);
  screen = win;
  render(win, failedView(ctx, message));
  if (win.isVisible()) {
    win.show();
    win.focus();
  }
}
