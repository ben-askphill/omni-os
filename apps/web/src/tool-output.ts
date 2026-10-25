// A tool row's output as the Web UI reads it (#225), React-free so the tests drive it: useToolOutput holds the state.
// A compact result is read from its saved text one chunk at a time, a running call through its bounded tail. The
// loader lives as long as its row is open, and `release` drops everything it held. The joins on the text are
// @omni/shared/tool-output.ts; this adds the requests, one chunk in flight, and what the row shows meanwhile.
import { applyChunk, applyTail, noOutput, outputMeta, type LoadedOutput, type OutputChunk, type TailMessage } from '@omni/shared/tool-output.ts';
import { errorText } from './api.ts';
import type { ToolCall } from './transcript/fold.ts';

/** Where an open row reads its output from. */
export type OutputTarget = { kind: 'saved'; event: number } | { kind: 'live'; tool: string };

/**
 * A compact result has its saved text to read. A call with no result reads its tail while its thread runs. A whole
 * result (a short one, or one from before #225) holds all it has, so there is nothing to load.
 */
export function outputTarget(c: Pick<ToolCall, 'id' | 'result'>, running: boolean): OutputTarget | null {
  if (c.result) return outputMeta(c.result) ? { kind: 'saved', event: c.result.event } : null;
  return running ? { kind: 'live', tool: c.id } : null;
}

/** Whether a harness reports a call's output while it runs. Codex does for its commands; the others report it at the end. */
export const hasLiveOutput = (harness: string) => harness === 'codex';

export interface OutputIO {
  /** GET /threads/:id/events/:eventId/output: the chunk at `offset`. Rejects once `signal` aborts. */
  chunk: (event: number, offset: number, signal: AbortSignal) => Promise<OutputChunk>;
  /** GET /threads/:id/tools/:toolUseId/tail: each message's JSON until closed. */
  tail: (tool: string, onData: (data: unknown) => void) => { close: () => void };
}

export interface OutputState {
  /** The saved text held so far, chunk by chunk. */
  saved: LoadedOutput;
  /** A chunk is on its way. */
  busy: boolean;
  /** Why the last chunk failed, until the next try. */
  error: string | null;
  /** A running call's newest output, at most TOOL_OUTPUT.clientTail units. */
  tail: string;
  /** Older output than `tail` holds was dropped, by the server or here. */
  skipped: boolean;
}

export const IDLE: OutputState = { saved: noOutput(), busy: false, error: null, tail: '', skipped: false };

/** What an open row shows: what has loaded, else the preview its result carries. */
export const outputText = (s: OutputState, preview = '') => s.tail || s.saved.text || preview;

/** Code points of the saved text still to load: none before the first chunk and after the last. */
export const outputLeft = (s: OutputState) => (s.saved.next === null || !s.saved.total ? 0 : s.saved.total - s.saved.next);

/** A tail message from the wire, or null for anything else. */
export function tailMessage(d: unknown): TailMessage | null {
  const o = d && typeof d === 'object' ? (d as Record<string, unknown>) : null;
  if (!o) return null;
  if (o.kind === 'end') return { kind: 'end', live: o.live === true };
  if (o.kind !== 'tail' || typeof o.text !== 'string') return null;
  return { kind: 'tail', text: o.text, skipped: typeof o.skipped === 'number' ? o.skipped : 0, ...(o.reset === true && { reset: true }) };
}

/**
 * Starts reading a target: the first chunk of a saved output, or a call's tail. `changed` gets every new state,
 * the first one at once. `more` loads the next chunk, or the same one again after a failure. `release` aborts the
 * request, closes the tail and drops the text, and nothing is reported after it.
 */
export function toolOutput(io: OutputIO, target: OutputTarget, changed: (s: OutputState) => void) {
  let s = IDLE;
  let released = false;
  let request: AbortController | null = null;
  let tail: { close: () => void } | null = null;

  const set = (patch: Partial<OutputState>) => {
    if (released) return;
    s = { ...s, ...patch };
    changed(s);
  };

  const more = () => {
    if (target.kind !== 'saved' || released || request || s.saved.next === null) return;
    request = new AbortController();
    set({ busy: true, error: null });
    io.chunk(target.event, s.saved.next, request.signal).then(
      (c) => {
        request = null;
        set({ saved: applyChunk(s.saved, c), busy: false });
      },
      (e: unknown) => {
        request = null;
        set({ busy: false, error: errorText(e) });
      },
    );
  };

  const follow = (tool: string) => {
    let ended = false;
    const hear = (data: unknown) => {
      const m = tailMessage(data);
      if (!m || released) return;
      if (m.kind === 'end') {
        // The call finished or has no live output. Its result arrives through the thread stream; a reconnect would only
        // ask again.
        ended = true;
        tail?.close();
        return;
      }
      const held = m.reset ? '' : s.tail;
      const next = applyTail(held, m);
      set({ tail: next, skipped: (m.reset ? false : s.skipped) || next.length < held.length + m.text.length || m.skipped > 0 });
    };
    tail = io.tail(tool, hear);
    if (ended) tail.close();
  };

  changed(s);
  if (target.kind === 'saved') more();
  else follow(target.tool);

  return {
    more,
    state: () => s,
    release() {
      released = true;
      request?.abort();
      tail?.close();
      s = IDLE;
    },
  };
}
