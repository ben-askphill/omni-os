// OS events the page cares about, and the native theme the page picks.
import { nativeTheme, powerMonitor } from 'electron';
import type { AppContext } from './context.ts';
import { on } from './handle.ts';

export function installSystemEvents(ctx: AppContext): void {
  // Waking up or coming back online: the page asks the server to sync (apps/web/src/sync-nudge.ts).
  powerMonitor.on('resume', () => ctx.broadcast({ type: 'resume' }));
  powerMonitor.on('unlock-screen', () => ctx.broadcast({ type: 'resume' }));
  on('omni:appearance', (_event, mode) => {
    if (mode === 'system' || mode === 'light' || mode === 'dark') nativeTheme.themeSource = mode;
  });
}
