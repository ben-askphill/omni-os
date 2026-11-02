// Quitting: the server this app started stops with it.
import { app } from 'electron';
import type { AppContext } from './context.ts';

export function installQuitHold(ctx: AppContext): void {
  let stopped = false;
  app.on('will-quit', (event) => {
    if (stopped || !ctx.backend.info().startedHere) return;
    event.preventDefault();
    void ctx.backend.stop().finally(() => {
      stopped = true;
      app.quit();
    });
  });
}
