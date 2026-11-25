// Settings > Usage panel: which harness and account rows the Usage panel shows and in what order
// (@omni/shared/usage-panel.ts). Kept in the synced kv, so every client here and on the user's other machines shows
// the same panel, and it survives a restart. Nothing is saved until the user changes it: the defaults are the
// built-in order with Hermes off.
import { kv } from './db.ts';
import { publishFeed } from './bus.ts';
import { parseUsagePanel, type UsagePanelPrefs } from '@omni/shared/usage-panel.ts';

export const USAGE_PANEL_KEY = 'usage-panel';

export const usagePanelPrefs = (): UsagePanelPrefs => parseUsagePanel(kv.get<unknown>(USAGE_PANEL_KEY));

export function setUsagePanelPrefs(next: UsagePanelPrefs): UsagePanelPrefs {
  kv.set(USAGE_PANEL_KEY, next);
  publishFeed({ type: 'usage_panel' });
  return next;
}
