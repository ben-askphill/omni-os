// Quitting, as the SwiftUI app did it (OmniKit/Quit.swift): a server this app started stops with it, unless turns
// still run on it. Then the app asks whether to keep the server running for them. A server someone else started keeps
// running, and the app quits at once. The activity monitor this app started stops either way. Restart Server asks
// the same question before it stops a server with turns on it.
import { app, BrowserWindow, dialog } from 'electron';
import { stopActivityMonitor } from './activity-monitor.ts';
import type { AppContext } from './context.ts';

/** `runningTurns` is null when the server did not say: the app asks rather than stop turns it cannot see. */
export type QuitDecision = { kind: 'quit'; stopServer: boolean } | { kind: 'ask'; runningTurns: number | null };
export type QuitChoice = 'keep-server-running' | 'stop-and-quit' | 'cancel';
export type QuitAction = { kind: 'stay-open' } | { kind: 'quit'; interruptTurns: boolean; stopServer: boolean };

export function decideQuit(input: { startedHere: boolean; runningTurns: number | null }): QuitDecision {
  if (!input.startedHere) return { kind: 'quit', stopServer: false };
  return input.runningTurns === 0 ? { kind: 'quit', stopServer: true } : { kind: 'ask', runningTurns: input.runningTurns };
}

export function quitAction(choice: QuitChoice): QuitAction {
  switch (choice) {
    case 'keep-server-running':
      return { kind: 'quit', interruptTurns: false, stopServer: false };
    case 'stop-and-quit':
      return { kind: 'quit', interruptTurns: true, stopServer: true };
    case 'cancel':
      return { kind: 'stay-open' };
  }
}

export const QUIT_CHOICES: readonly QuitChoice[] = ['keep-server-running', 'stop-and-quit', 'cancel'];

/** The dialog's text, worded as the SwiftUI app's QuitDialog. Buttons follow QUIT_CHOICES. */
export function quitDialog(runningTurns: number | null): { message: string; detail: string; buttons: string[] } {
  const buttons = ['Keep Server Running', 'Stop Them and Quit', 'Cancel'];
  if (runningTurns === null) {
    return {
      message: 'Turns may still be running',
      detail: 'The server did not answer in time. Keep it running in the background to let any turns finish, or stop them and quit.',
      buttons,
    };
  }
  return {
    message: runningTurns === 1 ? '1 turn is still running' : `${runningTurns} turns are still running`,
    detail: 'Keep the server running in the background to let them finish, or stop them and quit.',
    buttons,
  };
}

export type RestartChoice = 'when-finished' | 'stop-and-restart' | 'cancel';
export const RESTART_CHOICES: readonly RestartChoice[] = ['when-finished', 'stop-and-restart', 'cancel'];

/** Restart Server's question when turns run, as the quit dialog words it. Buttons follow RESTART_CHOICES. */
export function restartDialog(runningTurns: number | null): { message: string; detail: string; buttons: string[] } {
  const buttons = ['Restart When They Finish', 'Stop Them and Restart', 'Cancel'];
  const message =
    runningTurns === null ? 'Turns may still be running' : runningTurns === 1 ? '1 turn is still running' : `${runningTurns} turns are still running`;
  const detail =
    runningTurns === null
      ? 'The server did not answer in time. Restart it once no turn runs, or stop any turns and restart now.'
      : 'Restarting the server now stops them. Restart it once they finish, or stop them and restart now.';
  return { message, detail, buttons };
}

async function ask<T>(ctx: AppContext, text: { message: string; detail: string; buttons: string[] }, choices: readonly T[], cancel: T): Promise<T> {
  const options: Electron.MessageBoxOptions = {
    type: 'warning',
    message: text.message,
    detail: text.detail,
    buttons: text.buttons,
    defaultId: 0,
    cancelId: choices.indexOf(cancel),
    noLink: true,
  };
  const parent = ctx.mainWindow();
  const { response } = parent ? await dialog.showMessageBox(parent, options) : await dialog.showMessageBox(options);
  return choices[response] ?? cancel;
}

/** How often Restart When They Finish asks the server whether turns still run. */
const IDLE_POLL_MS = 2000;
let restartPending = false;

/**
 * Server > Restart Server on a ready server this app started. With turns running it asks first: wait for them (as the
 * SwiftUI app's ServerRestart did), stop them, or leave the server alone.
 */
export async function restartServer(ctx: AppContext): Promise<void> {
  if (restartPending) return;
  restartPending = true;
  try {
    const running = await ctx.backend.runningTurns();
    if (running !== 0) {
      const choice = await ask(ctx, restartDialog(running), RESTART_CHOICES, 'cancel');
      if (choice === 'cancel') return;
      if (choice === 'stop-and-restart') await ctx.backend.interruptTurns();
      else if (!(await untilIdle(ctx))) return;
    }
    if (ctx.backend.current.kind === 'ready' && !ctx.quitting()) await ctx.backend.restart();
  } finally {
    restartPending = false;
  }
}

/** Waits until no turn runs. False when the server stopped being ready meanwhile, or the app is quitting. */
async function untilIdle(ctx: AppContext): Promise<boolean> {
  while (ctx.backend.current.kind === 'ready' && !ctx.quitting()) {
    if ((await ctx.backend.runningTurns()) === 0) return true;
    await new Promise((resolve) => setTimeout(resolve, IDLE_POLL_MS));
  }
  return false;
}

/** True to go on quitting. */
async function prepareToQuit(ctx: AppContext): Promise<boolean> {
  const startedHere = ctx.backend.info().startedHere;
  const decision = decideQuit({ startedHere, runningTurns: startedHere ? await ctx.backend.runningTurns() : 0 });
  const action: QuitAction =
    decision.kind === 'ask'
      ? quitAction(await ask(ctx, quitDialog(decision.runningTurns), QUIT_CHOICES, 'cancel'))
      : { kind: 'quit', interruptTurns: false, stopServer: decision.stopServer };
  if (action.kind === 'stay-open') return false;
  if (action.interruptTurns) await ctx.backend.interruptTurns();
  // Backend.stop only stops a server this app started. One someone else started keeps running, and a start still reading
  // the login shell's PATH gives up instead of spawning a server after the app has gone.
  if (action.stopServer || !startedHere) await ctx.backend.stop();
  await stopActivityMonitor();
  return true;
}

const cancelListeners = new Set<() => void>();

/** Runs when the user cancels a held quit, so whatever asked to quit (Install Update) stands down. */
export function onQuitCancelled(listener: () => void): void {
  cancelListeners.add(listener);
}

export function installQuitHold(ctx: AppContext): void {
  let decided = false;
  let deciding = false;
  // First in line, so the other before-quit listeners see the quit held (event.defaultPrevented) while it asks.
  app.prependListener('before-quit', (event: Electron.Event) => {
    if (decided) return;
    event.preventDefault();
    if (deciding) return;
    deciding = true;
    void prepareToQuit(ctx)
      .catch((err: unknown) => {
        console.error('[omni] quit:', err);
        return true;
      })
      .then((proceed) => {
        deciding = false;
        if (proceed) {
          decided = true;
          app.quit();
          return;
        }
        for (const listener of cancelListeners) listener();
        if (BrowserWindow.getAllWindows().length === 0 && ctx.backend.current.kind === 'ready') {
          // Linux quits when its last window closes: Cancel brings one back instead of leaving the app windowless.
          ctx.showMain();
        }
      });
  });
}
