// The application menu.
import { Menu } from 'electron';
import type { AppContext } from './context.ts';

export function installMenu(_ctx: AppContext): void {
  Menu.setApplicationMenu(Menu.getApplicationMenu());
}
