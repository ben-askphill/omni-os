// What the app shows when the server cannot start or stops on its own: a small window with what went wrong and the
// last lines of the log. The main window stays open behind it, and the Web UI reconnects by itself once Try Again
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

const STYLE = `
:root { color-scheme: light dark; --bg: #f7f7f5; --card: #ffffff; --fg: #1a1a1a; --fg2: #444; --fg3: #6b6b6b;
  --line: rgba(0,0,0,.1); --well: #f2f2f0; --primary: #1a1a1a; --on-primary: #fff; }
@media (prefers-color-scheme: dark) { :root { --bg: #141414; --card: #1d1d1d; --fg: #ededed; --fg2: #c8c8c8;
  --fg3: #9a9a9a; --line: rgba(255,255,255,.12); --well: #161616; --primary: #ededed; --on-primary: #141414; } }
* { box-sizing: border-box; }
html, body { margin: 0; height: 100%; overflow: hidden; }
body { font: 13.5px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; background: var(--bg); color: var(--fg);
  display: flex; align-items: center; justify-content: center; padding: 20px; -webkit-user-select: text; }
main { width: 100%; max-width: 600px; max-height: 100%; overflow-y: auto; background: var(--card); border: 1px solid var(--line);
  border-radius: 20px; padding: 24px 28px; display: flex; flex-direction: column; align-items: center; gap: 12px; }
main > * { flex-shrink: 0; }
.glyph { width: 44px; height: 44px; border-radius: 50%; background: var(--well); display: grid; place-items: center;
  color: #d97706; font-weight: 700; font-size: 18px; }
h1 { margin: 0; font-size: 21px; font-weight: 500; letter-spacing: -0.01em; }
p { margin: 0; color: var(--fg2); text-align: center; white-space: pre-wrap; overflow-wrap: anywhere; }
/* The log gives up height first, down to the caption and 48px of lines. Below that the card scrolls. */
.log { width: 100%; min-height: 72px; flex: 0 1 auto; display: flex; flex-direction: column; }
main > .log { flex-shrink: 1; }
.caption { font-size: 11.5px; color: var(--fg3); margin: 0 0 6px 4px; }
pre { margin: 0; min-height: 48px; max-height: 220px; flex: 0 1 auto; overflow: auto; background: var(--well); border: 1px solid var(--line);
  border-radius: 12px; padding: 10px; font: 11.5px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace;
  color: var(--fg2); white-space: pre-wrap; overflow-wrap: anywhere; }
nav { display: flex; gap: 8px; flex-wrap: wrap; justify-content: center; margin-top: 4px; }
a { display: inline-flex; align-items: center; height: 34px; padding: 0 16px; border-radius: 17px; text-decoration: none;
  border: 1px solid var(--line); color: var(--fg); font-weight: 500; }
a.primary { background: var(--primary); color: var(--on-primary); border-color: transparent; }
a:focus-visible { outline: 2px solid #3b82f6; outline-offset: 2px; }
.spinner { width: 22px; height: 22px; border: 2px solid var(--line); border-top-color: var(--fg3); border-radius: 50%;
  animation: spin .8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.progress { color: var(--fg3); }
`;

function button(action: ScreenAction, label: string, primary = false): string {
  return `<a href="https://${ACTION_HOST}/${action}"${primary ? ' class="primary"' : ''}>${label}</a>`;
}

export function screenHtml(view: ScreenView): string {
  let body: string;
  if (view.kind === 'starting') {
    body = `<main><div class="spinner"></div><p class="progress">Starting the server on port ${view.port}</p></main>`;
  } else {
    const log = view.logTail.trim()
      ? `<section class="log"><div class="caption">Last lines of the log</div><pre id="tail">${escapeHtml(view.logTail.trim())}</pre></section>`
      : '';
    const buttons = [button('try-again', 'Try Again', true), view.logExists ? button('open-log', 'Open Log') : '', button('quit', 'Quit')];
    body = `<main><div class="glyph">!</div><h1>Server problem</h1><p>${escapeHtml(view.message)}</p>${log}<nav>${buttons.join('')}</nav></main>`;
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
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#141414' : '#f7f7f5',
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

/** Server > Restart Server while the server is down: the screen's Try Again, in the screen, which it brings back. */
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
    // Hidden windows such as the Quick Prompt panel and the open main window do not count, since neither offers Try Again.
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
