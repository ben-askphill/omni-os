// The desktop app's events (menu commands, waking up), carried out by the page. Renders nothing.
import { desktop } from '../desktop.ts';

export function DesktopHooks() {
  if (!desktop) return null;
  return null;
}
