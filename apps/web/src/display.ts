import { useSyncExternalStore } from 'react';
import { anyRepo, DEFAULT_DISPLAY, parseDisplay, showsCode, type CodeChannel, type DisplayPrefs } from '@omni/shared/display.ts';
import { api } from './api.ts';

/**
 * Show technical details and the Shopify add-on (GET /api/display), for the whole Web UI: desktop, phone layout and
 * the desktop app. One snapshot for the page, so a pure helper reads it as a component does. The last value this
 * browser saw is its first, so a page that opens does not flash the other way while the server answers.
 */
const KEY = 'omni.display';
let current: DisplayPrefs = (() => {
  try {
    return parseDisplay(JSON.parse(localStorage.getItem(KEY) ?? 'null') ?? DEFAULT_DISPLAY);
  } catch {
    return DEFAULT_DISPLAY;
  }
})();
const listeners = new Set<() => void>();
const subscribe = (fn: () => void) => (listeners.add(fn), () => listeners.delete(fn));

/** Puts a value in place for this page without asking the server: what it answered, or a test's choice. */
export function takeDisplay(next: DisplayPrefs) {
  if (next.technical === current.technical && next.shopify === current.shopify) return;
  current = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* private mode or blocked storage: the server still has it */
  }
  for (const fn of listeners) fn();
}

/** The switches now, for code outside a component. */
export const readDisplay = (): DisplayPrefs => current;
/** Whether the status words and control names read technical. */
export const technicalNow = (): boolean => current.technical;

/** Ask the server again: on start and whenever the feed says they changed. */
export function loadDisplay(): Promise<void> {
  return api
    .get<unknown>('/display')
    .then((v) => takeDisplay(parseDisplay(v)))
    .catch(() => {});
}

/** Set a switch: it shows at once, the server keeps it. */
export async function saveDisplay(patch: Partial<DisplayPrefs>): Promise<void> {
  const before = current;
  takeDisplay({ ...current, ...patch });
  try {
    takeDisplay(parseDisplay(await api.put<unknown>('/display', patch)));
  } catch (e) {
    takeDisplay(before);
    throw e;
  }
}

export const useDisplay = (): DisplayPrefs => useSyncExternalStore(subscribe, readDisplay, readDisplay);
/** Whether the status words and control names read technical. */
export const useTechnical = (): boolean => useDisplay().technical;
/** Whether the Pull requests page has a way in (rail, sidebar, palette, phone tab, Overview card): the switch, or a channel with a repo. */
export const prsShown = (prefs: DisplayPrefs, channels: readonly { repo_path?: string | null }[]): boolean => prefs.technical || anyRepo(channels);
export const usePRsShown = (channels: readonly { repo_path?: string | null }[]): boolean => prsShown(useDisplay(), channels);
/** Whether a channel shows its code detail: the switch, or a repo (showsCode). */
export const useShowsCode = (channel: CodeChannel): boolean => showsCode(useDisplay(), channel);
