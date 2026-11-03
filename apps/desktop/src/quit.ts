// Quitting: a server this app started stops with it, unless turns
// still run on it. Then the app asks whether to keep the server running for them. A server someone else started keeps
// running, and the app quits at once. The activity monitor this app started stops either way. Restart Server asks
// the same question before it stops a server with turns on it. Relaunch to Update asks it without Keep Server
// Running: the update replaces the files a server left running would still run from.
import { app, BrowserWindow, dialog } from 'electron';
import { stopActivityMonitor } from './activity-monitor.ts';
import type { AppContext } from './context.ts';

/** `runningTurns` is null when the server did not say: the app asks rather than stop turns it cannot see. */
export type QuitDecision = { kind: 'quit'; stopServer: boolean } | { kind: 'ask'; runningTurns: number | null };
export type QuitChoice = 'keep-server-running' | 'stop-and-quit' | 'cancel';
export type QuitAction = { kind: 'stay-open' } | { kind: 'wait-for-turns' } | { kind: 'quit'; interruptTurns: boolean; stopServer: boolean };

/** How the app quits, once the quit flow lets it go. updates.ts installs a downloaded update by it. */
export interface QuitPlan {
  /** Relaunch to Update asked for this quit, so the app opens again on the new version. */
  forUpdate: boolean;
  /** A server this app started keeps running after it (Keep Server Running). */
  serverKeepsRunning: boolean;
}

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

export type UpdateChoice = 'when-finished' | 'stop-and-update' | 'cancel';
export const UPDATE_CHOICES: readonly UpdateChoice[] = ['when-finished', 'stop-and-update', 'cancel'];

export function updateAction(choice: UpdateChoice): QuitAction {
  switch (choice) {
    case 'when-finished':
      return { kind: 'wait-for-turns' };
    case 'stop-and-update':
      return { kind: 'quit', interruptTurns: true, stopServer: true };
    case 'cancel':
      return { kind: 'stay-open' };
  }
}

/** The dialog's text. Buttons follow QUIT_CHOICES. */
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

/** Relaunch to Update's question when turns run. Buttons follow UPDATE_CHOICES. */
export function updateDialog(runningTurns: number | null): { message: string; detail: string; buttons: string[] } {
  const buttons = ['Update When They Finish', 'Stop Them and Update', 'Cancel'];
  const message =
    runningTurns === null ? 'Turns may still be running' : runningTurns === 1 ? '1 turn is still running' : `${runningTurns} turns are still running`;
  const detail =
    runningTurns === null
      ? 'The server did not answer in time. The update restarts it. Update once no turn runs, or stop any turns and update now.'
      : 'The update restarts the server, which stops them. Update once they finish, or stop them and update now.';
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
 * Server > Restart Server on a ready server this app started. With turns running it asks first: wait for them, stop
 * them, or leave the server alone.
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
    // A quit held for its question (Update When They Finish can start one on the same idle check) owns the server now.
    if (ctx.backend.current.kind === 'ready' && !ctx.quitting() && !quitHeld) await ctx.backend.restart();
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

let forUpdate = false;
let waitingToUpdate = false;
let quitHeld = false;
let plan: QuitPlan | null = null;

/** Set once the quit flow has let the app go, null until then. */
export function quitPlan(): QuitPlan | null {
  return plan;
}

/** Relaunch to Update: the quit flow, asking about running turns without Keep Server Running. */
export function quitToUpdate(): void {
  forUpdate = true;
  app.quit();
}

/** Update When They Finish: asks again once no turn runs. Ends without asking if the server stops or the app quits. */
async function updateWhenIdle(ctx: AppContext): Promise<void> {
  if (waitingToUpdate) return;
  waitingToUpdate = true;
  try {
    if (await untilIdle(ctx)) quitToUpdate();
  } finally {
    waitingToUpdate = false;
  }
}

/** The plan to quit by, or null to stay open. */
async function prepareToQuit(ctx: AppContext, update: boolean): Promise<QuitPlan | null> {
  const startedHere = ctx.backend.info().startedHere;
  const decision = decideQuit({ startedHere, runningTurns: startedHere ? await ctx.backend.runningTurns() : 0 });
  const action: QuitAction =
    decision.kind === 'quit'
      ? { kind: 'quit', interruptTurns: false, stopServer: decision.stopServer }
      : update
        ? updateAction(await ask(ctx, updateDialog(decision.runningTurns), UPDATE_CHOICES, 'cancel'))
        : quitAction(await ask(ctx, quitDialog(decision.runningTurns), QUIT_CHOICES, 'cancel'));
  if (action.kind === 'wait-for-turns') void updateWhenIdle(ctx);
  if (action.kind !== 'quit') return null;
  if (action.interruptTurns) await ctx.backend.interruptTurns();
  // Backend.stop only stops a server this app started. One someone else started keeps running, and a start still reading
  // the login shell's PATH gives up instead of spawning a server after the app has gone.
  if (action.stopServer || !startedHere) await ctx.backend.stop();
  await stopActivityMonitor();
  // A noted server this launch did not adopt is still this app's, and still runs from its files.
  return { forUpdate: update, serverKeepsRunning: startedHere ? !action.stopServer : ctx.backend.recordedServerUp() };
}

export function installQuitHold(ctx: AppContext): void {
  let decided = false;
  // First in line, so the other before-quit listeners see the quit held (event.defaultPrevented) while it asks.
  app.prependListener('before-quit', (event: Electron.Event) => {
    if (decided) return;
    event.preventDefault();
    // Read on every held quit, so a Relaunch to Update made while a quit is asked about does not carry to the next.
    const update = forUpdate;
    forUpdate = false;
    if (quitHeld) return;
    quitHeld = true;
    void prepareToQuit(ctx, update)
      .catch((err: unknown): QuitPlan => {
        console.error('[omni] quit:', err);
        // The server may be up still. Quit, but leave the update for a quit that knows it stopped.
        return { forUpdate: false, serverKeepsRunning: true };
      })
      .then((decidedPlan) => {
        quitHeld = false;
        if (decidedPlan) {
          plan = decidedPlan;
          decided = true;
          app.quit();
          return;
        }
        if (BrowserWindow.getAllWindows().length === 0 && ctx.backend.current.kind === 'ready') {
          // Linux quits when its last window closes: Cancel brings one back instead of leaving the app windowless.
          ctx.showMain();
        }
      });
  });
}
