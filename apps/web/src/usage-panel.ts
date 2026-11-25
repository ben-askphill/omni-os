import { useSyncExternalStore } from 'react';
import { DEFAULT_USAGE_PANEL, parseUsagePanel, sameUsagePanel, type UsagePanelPrefs } from '@omni/shared/usage-panel.ts';
import { api } from './api.ts';

// Settings > Usage panel (GET /api/usage-panel), one value for the whole Web UI: desktop, the phone layout and the
// desktop app. The server keeps it; until it answers, the panel shows the built-in order with Hermes off.

let current: UsagePanelPrefs = DEFAULT_USAGE_PANEL;
const listeners = new Set<() => void>();
const subscribe = (fn: () => void) => (listeners.add(fn), () => listeners.delete(fn));
const read = () => current;

export function takeUsagePanel(next: UsagePanelPrefs) {
  if (sameUsagePanel(next, current)) return;
  current = next;
  for (const fn of listeners) fn();
}

/** On start, on a reconnect and whenever the feed says it changed. */
export function loadUsagePanel(): Promise<void> {
  return api
    .get<unknown>('/usage-panel')
    .then((v) => takeUsagePanel(parseUsagePanel(v)))
    .catch(() => {});
}

/** Shows at once; the server keeps it, and a refusal puts the value before it back. */
export async function saveUsagePanel(next: UsagePanelPrefs): Promise<void> {
  const before = current;
  takeUsagePanel(next);
  try {
    takeUsagePanel(parseUsagePanel(await api.put<unknown>('/usage-panel', next)));
  } catch (e) {
    takeUsagePanel(before);
    throw e;
  }
}

export const useUsagePanel = (): UsagePanelPrefs => useSyncExternalStore(subscribe, read, read);
