// Settings' "Default model for new threads" across many channels at once: which channels are picked, and one default
// run (or a reset to Auto) sent to each of them as the same PATCH the single-channel card sends (runBody).
import { runBody, type ChannelRun } from './channel-form.ts';

/** No default at all: every field cleared, so the channel falls back to Auto and reads "Built-in default". */
export const NO_RUN: ChannelRun = { harness: '', model: '', effort: '' };

/** Whether a picked run says anything yet. Apply waits for one. */
export const picksRun = (run: ChannelRun) => !!(run.harness || run.model || run.effort);

/** `selected` with `id` flipped. */
export function toggleSelected(selected: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(selected);
  if (!next.delete(id)) next.add(id);
  return next;
}

/** The picked ids that are still listed, in list order: an archived or deleted channel drops out of the selection. */
export const selectedIds = (listed: readonly { id: string }[], selected: ReadonlySet<string>) => listed.filter((c) => selected.has(c.id)).map((c) => c.id);

export interface BulkRunResult {
  done: string[];
  failed: { id: string; error: string }[];
}

/**
 * Sends `run` to every channel in `ids` at once, through `patch` (PATCH /api/channels/:id). One channel failing does not
 * stop the rest: the result says which went through and which did not, so the caller can keep the failed ones picked.
 */
export async function applyRunToChannels(ids: readonly string[], run: ChannelRun, patch: (id: string, body: ReturnType<typeof runBody>) => Promise<unknown>): Promise<BulkRunResult> {
  const body = runBody(run);
  const settled = await Promise.allSettled(ids.map((id) => patch(id, body)));
  const result: BulkRunResult = { done: [], failed: [] };
  settled.forEach((s, i) => {
    if (s.status === 'fulfilled') result.done.push(ids[i]);
    else result.failed.push({ id: ids[i], error: s.reason instanceof Error ? s.reason.message : String(s.reason) });
  });
  return result;
}

/** Clears the default on every channel in `ids`, so each runs Auto again. */
export const resetChannelsToAuto = (ids: readonly string[], patch: (id: string, body: ReturnType<typeof runBody>) => Promise<unknown>) => applyRunToChannels(ids, NO_RUN, patch);

/** The line under the bulk bar after a run that did not fully go through, or null when every channel took it. */
export function bulkRunError(r: BulkRunResult, name: (id: string) => string): string | null {
  if (!r.failed.length) return null;
  const who = r.failed.map((f) => name(f.id)).join(', ');
  return `${r.failed.length === 1 ? `${who} did not save` : `${r.failed.length} channels did not save (${who})`}: ${r.failed[0].error}`;
}
