// Quitting, as the SwiftUI app did it (OmniKit/Quit.swift): a server this app started stops with it, unless turns
// still run on it. Then the app asks whether to keep the server running for them. A server it attached to keeps
// running, and the app quits at once. The activity monitor this app started stops either way.
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

const STATUS_TIMEOUT_MS = 3000;

/** Turns running on the server, or null when a ready server does not say within 3 seconds. */
async function runningTurns(ctx: AppContext): Promise<number | null> {
  if (ctx.backend.current.kind !== 'ready') return 0;
  try {
    const status = await ctx.backend.api<{ running?: unknown }>('/api/status', { signal: AbortSignal.timeout(STATUS_TIMEOUT_MS) });
    return typeof status.running === 'number' ? status.running : null;
  } catch {
    // Busy, as a server with several turns running can be. Stopping it now could end turns nobody was asked about.
    return null;
  }
}

/** Interrupts queued turns first, so none starts in between, then the running ones. */
async function interruptTurns(ctx: AppContext): Promise<void> {
  const ids: string[] = [];
  for (const status of ['queued', 'running']) {
    try {
      const threads = await ctx.backend.api<{ id: string }[]>(`/api/threads?status=${status}&limit=200`);
      ids.push(...threads.map((thread) => thread.id));
    } catch {
      // The server is going away anyway; a list it cannot give is nothing to stop.
    }
  }
  await Promise.allSettled(
    ids.map((id) => ctx.backend.api(`/api/threads/${encodeURIComponent(id)}/stop`, { method: 'POST' })),
  );
}

async function ask(ctx: AppContext, running: number | null): Promise<QuitChoice> {
  const text = quitDialog(running);
  const options: Electron.MessageBoxOptions = {
    type: 'warning',
    message: text.message,
    detail: text.detail,
    buttons: text.buttons,
    defaultId: 0,
    cancelId: QUIT_CHOICES.indexOf('cancel'),
    noLink: true,
  };
  const parent = ctx.mainWindow();
  const { response } = parent ? await dialog.showMessageBox(parent, options) : await dialog.showMessageBox(options);
  return QUIT_CHOICES[response] ?? 'cancel';
}

/** True to go on quitting. */
async function prepareToQuit(ctx: AppContext): Promise<boolean> {
  const startedHere = ctx.backend.info().startedHere;
  const decision = decideQuit({ startedHere, runningTurns: startedHere ? await runningTurns(ctx) : 0 });
  const action: QuitAction =
    decision.kind === 'ask' ? quitAction(await ask(ctx, decision.runningTurns)) : { kind: 'quit', interruptTurns: false, stopServer: decision.stopServer };
  if (action.kind === 'stay-open') return false;
  if (action.interruptTurns) await interruptTurns(ctx);
  // Backend.stop only stops a server this app started. One it attached to keeps running, and a start still reading
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
