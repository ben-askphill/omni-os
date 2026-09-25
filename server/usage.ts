// Per-harness plan usage. Claude's comes from its stream; Codex's from the app-server's
// rate-limit reads and notifications; Cursor reports none. Stored in kv so it survives a
// restart, and published on the feed so the usage card updates live.
import { kv } from './db.ts';
import { publishFeed } from './bus.ts';
import type { Usage } from './stream.ts';
import { HARNESS_IDS, type HarnessId } from './harness/types.ts';

const key = (harness: string) => `usage:${harness}`;

export function recordUsage(harness: HarnessId, usage: Usage) {
  kv.set(key(harness), usage);
  publishFeed({ type: 'usage', harness, usage });
}

export function usageFor(harness: HarnessId): Usage | null {
  return kv.get<Usage>(key(harness)) ?? null;
}

export function usageByHarness(): Record<HarnessId, Usage | null> {
  const out = {} as Record<HarnessId, Usage | null>;
  for (const h of HARNESS_IDS) out[h] = usageFor(h);
  return out;
}
