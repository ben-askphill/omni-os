import type { Insights } from '@omni/shared/insights.ts';

/** The Inbox dashboard's last answer for one `/insights` path, and when it arrived. */
export interface KeptInsights {
  data: Insights;
  at: number;
}

/** Younger than this, opening the Inbox draws the kept answer and asks nothing. Older, it draws it and asks behind it. */
export const FRESH_MS = 5 * 60_000;

// Outlives the page, so leaving the Inbox and coming back draws at once. A reload of the app starts it empty.
const kept = new Map<string, KeptInsights>();

export const keptInsights = (path: string) => kept.get(path);

export function keepInsights(path: string, data: Insights, at = Date.now()): KeptInsights {
  const entry = { data, at };
  kept.set(path, entry);
  return entry;
}

/** A partial answer (the logs or GitHub still being read) is never fresh, so the next open asks for the rest. */
export const isFresh = (entry: KeptInsights | undefined, now = Date.now()) =>
  !!entry && entry.data.usage.complete && entry.data.prs !== null && now - entry.at < FRESH_MS;
