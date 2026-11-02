// The app's own updates.
import type { DesktopUpdateView } from '@omni/shared/desktop-bridge.ts';
import type { AppContext } from './context.ts';
import { handle, on } from './handle.ts';

export function installUpdates(_ctx: AppContext): void {
  const view: DesktopUpdateView = { state: 'unsupported', reason: 'Updates are not set up yet.' };
  handle('omni:updates:get', () => view);
  handle('omni:updates:check', () => view);
  on('omni:updates:install', () => {});
}
