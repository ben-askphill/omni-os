// Per-harness plan usage. Claude's comes from its stream; Codex's from the app-server's
// rate-limit reads and notifications; Cursor's monthly cycle from its dashboard (cursor-usage.ts). Stored in kv so it survives a
// restart, and published on the feed so the usage card updates live.
//
// `usage:<harness>` is the last reading on any machine (kv syncs, last writer wins), so with two accounts on one
// harness it says nothing about which. The routing and older clients read it. Each reading also goes under the
// account it was read as (harness-accounts.ts attributeUsage), which is what the Usage card shows per account.
import { kv } from './db.ts';
import { publishFeed } from './bus.ts';
import { attributeUsage } from './harness-accounts.ts';
import type { Usage } from './stream.ts';
import { HARNESS_IDS, type HarnessId } from './harness/types.ts';

const key = (harness: string) => `usage:${harness}`;

/**
 * A plan reading for the account the harness runs as on this machine. `account: false` keeps it off every account,
 * for a reading that may have come from another login (Cursor's dashboard through the IDE's session).
 */
export function recordUsage(harness: HarnessId, usage: Usage, { account = true }: { account?: boolean } = {}) {
  kv.set(key(harness), usage);
  publishFeed({ type: 'usage', harness, usage });
  if (account) void attributeUsage(harness, usage);
}

/** The harness has no reading any more: the card shows "no data". */
export function clearUsage(harness: HarnessId) {
  kv.set(key(harness), null);
  publishFeed({ type: 'usage', harness, usage: null });
  void attributeUsage(harness, null);
}

export function usageFor(harness: HarnessId): Usage | null {
  return kv.get<Usage>(key(harness)) ?? null;
}

export function usageByHarness(): Record<HarnessId, Usage | null> {
  const out = {} as Record<HarnessId, Usage | null>;
  for (const h of HARNESS_IDS) out[h] = usageFor(h);
  return out;
}
