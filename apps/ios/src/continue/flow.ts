import { OmniHttpError, type HarnessInfo, type OmniApi, type Thread } from '@omni/client-core';
import {
  canStart,
  startBody,
  startError,
  type ContinueAction,
  type ContinueSource,
  type ContinueState,
  type StartError,
} from '@omni/shared/continue-flow.ts';
import type { Run } from '@omni/shared/run-switch.ts';

import { failureOf, SIGNED_OUT_ERROR } from '../failure';
import { newRequestId } from '../send/sender';
import { runChipLabel, runSheetModel, type RunSheetModel, type RunThread } from '../thread/run-model';

export type ContinueApi = Pick<OmniApi, 'thread' | 'continuePreview' | 'continueThread' | 'closeTerminal'>;
type Dispatch = (action: ContinueAction) => void;

// ---------- the thread being continued ----------

export type SourceState = { status: 'loading' } | { status: 'ready'; source: ContinueSource } | { status: 'failed'; error: string };

/** Reads the thread the screen continues: its title for the intro, its harness for the default run, its channel for the catalog. Never rejects. */
export async function loadSource(api: Pick<OmniApi, 'thread'>, threadId: string): Promise<SourceState> {
  try {
    const { thread } = await api.thread(threadId);
    return { status: 'ready', source: { id: thread.id, title: thread.title, harness: thread.harness, channel_id: thread.channel_id } };
  } catch (e) {
    const gone = e instanceof OmniHttpError && e.failure.kind === 'http' && e.failure.status === 404;
    return { status: 'failed', error: gone ? 'This thread is gone. It may have been archived or removed on the server.' : failureOf(e).error };
  }
}

// ---------- the preview ----------

/**
 * Asks for the Carryover the picked run and attachments would read. `alive` is false once a later ask replaced this one
 * (or the screen closed), and then the answer is dropped, so a slow preview never overwrites a newer one. The reducer
 * drops an answer for a run or attachments that are no longer picked too.
 */
export async function loadPreview(api: Pick<OmniApi, 'continuePreview'>, sourceId: string, run: Run, picked: string[], dispatch: Dispatch, alive: () => boolean): Promise<void> {
  try {
    const preview = await api.continuePreview(sourceId, { ...run, attachments: picked });
    if (alive()) dispatch({ type: 'previewed', run, picked, preview });
  } catch (e) {
    if (alive()) dispatch({ type: 'previewFailed', run, picked, error: failureOf(e).error });
  }
}

// ---------- starting ----------

/** A refused Start as the sheet shows it. A 401 that survived the refresh says the phone was signed out. */
export function startFailure(e: unknown): StartError {
  return failureOf(e).kind === 'revoked' ? { kind: 'error', error: SIGNED_OUT_ERROR } : startError(e);
}

/**
 * Starts the continued thread from the state on screen. Resolves with the new thread to open, or null when nothing was
 * started: Start was not allowed, or the server refused (`changed`, `busy`, `request_reused` and plain errors go to the
 * reducer). A retry of the same Start keeps its request id, so a lost answer cannot make two threads.
 */
export async function startContinue(api: Pick<OmniApi, 'continueThread'>, sourceId: string, s: ContinueState, dispatch: Dispatch): Promise<Thread | null> {
  if (!canStart(s) || !s.run || s.preview.kind !== 'ready') return null;
  const { body, attempt } = startBody(s.run, s.text, s.preview.preview.revision, s.attempt, newRequestId, s.picked);
  dispatch({ type: 'posting', attempt });
  try {
    return (await api.continueThread(sourceId, body)).thread;
  } catch (e) {
    dispatch({ type: 'refused', error: startFailure(e) });
    return null;
  }
}

/** Closes the shell open in the source's Terminal tab, then asks for the preview again, which no longer says `terminal`. */
export async function closeSourceTerminal(api: Pick<OmniApi, 'closeTerminal'>, sourceId: string, dispatch: Dispatch): Promise<void> {
  try {
    await api.closeTerminal(sourceId);
    dispatch({ type: 'recheck' });
  } catch (e) {
    dispatch({ type: 'refused', error: { kind: 'error', error: failureOf(e).error } });
  }
}

// ---------- the run picker ----------

const asRunThread = (run: Run): RunThread => ({
  harness: run.harness,
  model: run.model,
  effort: run.effort,
  auto_reason: null,
  queued_harness: null,
  queued_model: null,
  queued_effort: null,
});

/** The first model of the first harness, to open the picker on when no local harness is ready. */
function firstRun(offered: readonly HarnessInfo[]): Run | null {
  const h = offered[0];
  const m = h?.models.find((x) => x.default) ?? h?.models[0];
  return h && m ? { harness: h.id, model: m.id, effort: '' } : null;
}

/** "Codex · GPT" style label for the run on the Continue on row, and the harness under it. */
export function runLabel(run: Run, offered: readonly HarnessInfo[]): { title: string; harness: string } {
  return { title: runChipLabel(asRunThread(run), [...offered]) || run.model, harness: offered.find((h) => h.id === run.harness)?.name ?? run.harness };
}

/** The picker's rows for the harnesses Continue offers, with the picked run checked. Null when there is nothing to list. */
export function pickerModel(run: Run | null, offered: readonly HarnessInfo[]): RunSheetModel | null {
  const shown = run ?? firstRun(offered);
  return shown ? runSheetModel(asRunThread(shown), [...offered]) : null;
}

/** The run a tap in the picker asks for: another model starts at its default effort, an effort keeps the model. */
export function runFor(run: Run | null, pick: { harness: string; model: string } | { effort: string }): Run | null {
  if ('effort' in pick) return run ? { ...run, effort: pick.effort } : null;
  return { harness: pick.harness, model: pick.model, effort: '' };
}
