// The application menu (menu-template.ts), rebuilt when the server or the zoom changes so each item's enabled
// state is right. Commands go to the focused Omni window's page, which carries them out (DesktopHooks.tsx).
import { app, Menu, shell } from 'electron';
import { existsSync } from 'node:fs';
import type { DesktopCommand } from '@omni/shared/desktop-bridge.ts';
import { openActivityMonitor } from './activity-monitor.ts';
import type { BackendState } from './backend/index.ts';
import type { AppContext } from './context.ts';
import { EVENT } from './ipc.ts';
import { commandRoute, desktopPlatform, menuTemplate, type MenuActions, type ServerMenuState } from './menu-template.ts';
import { openQuickPrompt } from './quick-prompt.ts';
import { restartServer } from './quit.ts';
import { retryFromMenu } from './server-screen.ts';
import { applyZoom, bringForward, focusedOmniWindow, stepZoom } from './windows.ts';

function serverState(state: BackendState): ServerMenuState {
  switch (state.kind) {
    case 'idle':
    case 'starting':
      return 'starting';
    case 'ready':
      return 'ready';
    case 'restarting':
      return 'restarting';
    case 'failed':
      return 'failed';
    case 'stopped':
      return 'stopped';
  }
}

/** Has the focused Omni window carry out a command. With none open, the main window opens where the command leads. */
export function sendCommand(ctx: AppContext, command: DesktopCommand): void {
  const win = focusedOmniWindow(ctx);
  if (win) {
    bringForward(win);
    win.webContents.send(EVENT, { type: 'command', command });
    return;
  }
  if (ctx.backend.current.kind === 'ready') ctx.showMain(commandRoute(command) ?? undefined);
}

/** Server > Show Server Log, and the Web UI's Show Server Log. */
export function showServerLog(ctx: AppContext): void {
  void shell.openPath(ctx.backend.config.logFile);
}

export function installMenu(ctx: AppContext): void {
  app.setAboutPanelOptions({
    applicationName: 'Omni',
    applicationVersion: app.getVersion(),
    ...(ctx.paths.icon && process.platform !== 'darwin' ? { iconPath: ctx.paths.icon } : {}),
  });

  const history = (step: 'back' | 'forward') => {
    const nav = focusedOmniWindow(ctx)?.webContents.navigationHistory;
    if (!nav) return;
    if (step === 'back' && nav.canGoBack()) nav.goBack();
    if (step === 'forward' && nav.canGoForward()) nav.goForward();
  };

  const actions: MenuActions = {
    command: (command) => sendCommand(ctx, command),
    quickPrompt: () => openQuickPrompt(ctx),
    newWindow: () => {
      if (ctx.backend.current.kind === 'ready') ctx.openWindow('#/');
    },
    zoom: (to) => stepZoom(ctx, to),
    back: () => history('back'),
    forward: () => history('forward'),
    restartServer: () => {
      if (ctx.backend.current.kind === 'failed') retryFromMenu(ctx);
      else void restartServer(ctx);
    },
    showServerLog: () => showServerLog(ctx),
    activityMonitor: () => openActivityMonitor(ctx),
  };

  const build = () => {
    const template = menuTemplate(
      {
        platform: desktopPlatform(),
        packaged: app.isPackaged,
        port: ctx.backend.config.port,
        server: serverState(ctx.backend.current),
        startedHere: ctx.backend.info().startedHere,
        zoom: ctx.settings.get().zoom,
        logExists: existsSync(ctx.backend.config.logFile),
      },
      actions,
    );
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  };

  build();
  ctx.backend.onState(build);
  ctx.settings.onChange((next, previous) => {
    if (next.zoom !== previous.zoom) {
      applyZoom(next.zoom);
      build();
    }
  });
}
