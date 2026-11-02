// What the app shows when the server cannot start or stops on its own.
import { app, dialog } from 'electron';
import type { AppContext } from './context.ts';

export function showServerFailure(_ctx: AppContext, message: string): void {
  dialog.showErrorBox('Omni could not start its server', message);
  app.quit();
}
