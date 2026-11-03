// Launch at login (macOS and Windows), kept in step with the setting. The OS's own list is the truth: someone can
// remove Omni from Login Items in System Settings, so the setting takes what the OS says on every start.
import { app } from 'electron';
import type { AppContext } from './context.ts';

/** A development build would register the Electron binary itself, which shares no identity with Omni. */
export const LOGIN_ITEM_SUPPORTED = app.isPackaged && (process.platform === 'darwin' || process.platform === 'win32');

/** Whether the OS should change: only when the setting moved and the OS does not already agree. */
export function loginItemChange(next: boolean, previous: boolean, os: boolean): boolean | null {
  return next !== previous && next !== os ? next : null;
}

export function installLoginItem(ctx: AppContext): void {
  if (!LOGIN_ITEM_SUPPORTED) return;
  const os = () => app.getLoginItemSettings().openAtLogin;
  const now = os();
  if (ctx.settings.get().launchAtLogin !== now) ctx.settings.update({ launchAtLogin: now });
  ctx.settings.onChange((next, previous) => {
    const change = loginItemChange(next.launchAtLogin, previous.launchAtLogin, os());
    if (change === null) return;
    try {
      app.setLoginItemSettings({ openAtLogin: change });
    } catch (err) {
      console.warn('[omni] could not change Launch at login:', err);
    }
    // The OS can refuse (macOS asks for approval in Login Items). The setting then shows what the OS did.
    const after = os();
    if (after !== next.launchAtLogin) ctx.settings.update({ launchAtLogin: after });
  });
}
