import { describe, expect, it } from 'vitest';
import { TOOL_OUTPUT, type OutputChunk } from '@omni/shared/tool-output.ts';
import { buildItems, type TranscriptEvent } from '../src/transcript/fold.ts';
import { IDLE, hasLiveOutput, outputLeft, outputTarget, outputText, tailMessage, toolOutput, type OutputIO, type OutputState, type OutputTarget } from '../src/tool-output.ts';

// An open tool row's output: the saved text in chunks, a running call's bounded tail, and the release on close.

const chunk = (offset: number, text: string, next: number | null, total = 20, extra: Partial<OutputChunk> = {}): OutputChunk => ({
  event_id: 7, tool_use_id: 'c1', offset, text, next, total, is_error: false, truncated: false, ...extra,
});

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** An IO whose chunk requests wait for the test to answer them, and whose tail connections the test feeds. */
function fakeIO() {
  const asked: { event: number; offset: number; signal: AbortSignal; resolve: (c: OutputChunk) => void; reject: (e: unknown) => void }[] = [];
  const tails: { tool: string; send: (d: unknown) => void; closes: number }[] = [];
  const io: OutputIO = {
    chunk: (event, offset, signal) =>
      new Promise((resolve, reject) => {
        asked.push({ event, offset, signal, resolve, reject });
        signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      }),
    tail: (tool, onData) => {
      const t = { tool, send: onData, closes: 0 };
      tails.push(t);
      return { close: () => void t.closes++ };
    },
  };
  return { io, asked, tails };
}

/** A loader with its newest state and every state it reported. */
function open(io: OutputIO, target: OutputTarget) {
  const seen: OutputState[] = [];
  const loader = toolOutput(io, target, (s) => seen.push(s));
  return { loader, seen, now: () => seen[seen.length - 1] };
}

const SAVED: OutputTarget = { kind: 'saved', event: 7 };
const LIVE: OutputTarget = { kind: 'live', tool: 'c1' };
const tail = (text: string, extra: { reset?: boolean; skipped?: number } = {}) => ({ kind: 'tail', text, skipped: 0, ...extra });

describe('which output a row reads', () => {
  const at = '2026-10-25T09:00:00.000Z';
  const use: TranscriptEvent = { id: 1, kind: 'tool_use', payload: JSON.stringify({ id: 'c1', name: 'Bash', input: { command: 'ls' }, parent: null }), created_at: at };
  const callWith = (...rows: unknown[]) => {
    const events = [use, ...rows.map((p, i) => ({ id: i + 2, kind: 'tool_result', payload: JSON.stringify(p), created_at: at }))];
    const group = buildItems(events).items[0];
    if (group.type !== 'tools') throw new Error('no tool group');
    return group.calls[0];
  };

  it('reads the saved text of a compact result, found from its payload', () => {
    const c = callWith({ tool_use_id: 'c1', text: 'x'.repeat(1024), is_error: false, truncated: true, output: { chars: 5000, lines: 40 } });
    expect(outputTarget(c, false)).toEqual({ kind: 'saved', event: 2 });
    expect(outputTarget(c, true)).toEqual({ kind: 'saved', event: 2 });
  });

  it('loads nothing for a whole result, a legacy one or a clipped one', () => {
    const whole = callWith({ tool_use_id: 'c1', text: 'ok', is_error: false, truncated: false });
    expect(outputTarget(whole, true)).toBeNull();
    const junk = callWith({ tool_use_id: 'c1', text: 'ok', is_error: false, truncated: false, output: { chars: 'many' } });
    expect(outputTarget(junk, true)).toBeNull();
  });

  it('follows the tail of a call with no result while its thread runs', () => {
    const c = callWith();
    expect(outputTarget(c, true)).toEqual({ kind: 'live', tool: 'c1' });
    expect(outputTarget(c, false)).toBeNull();
  });

  it('knows which harness prints while a call runs', () => {
    expect(hasLiveOutput('codex')).toBe(true);
    expect(['claude-code', 'cursor', 'hermes', 'cursor-cloud'].some(hasLiveOutput)).toBe(false);
  });
});

describe('saved output', () => {
  it('loads the first chunk by itself and shows the preview until it arrives', async () => {
    const { io, asked } = fakeIO();
    const o = open(io, SAVED);
    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatchObject({ event: 7, offset: 0 });
    expect(o.now().busy).toBe(true);
    expect(outputText(o.now(), 'PREVIEW')).toBe('PREVIEW');
    asked[0].resolve(chunk(0, 'PREVIEW and more', 16, 40));
    await flush();
    expect(o.now()).toMatchObject({ busy: false, error: null });
    expect(outputText(o.now(), 'PREVIEW')).toBe('PREVIEW and more');
    expect(outputLeft(o.now())).toBe(24);
  });

  it('loads on to the end, asking from the offset it was given', async () => {
    const { io, asked } = fakeIO();
    const o = open(io, SAVED);
    asked[0].resolve(chunk(0, 'abcde', 7, 12));
    await flush();
    o.loader.more();
    expect(asked[1].offset).toBe(7);
    asked[1].resolve(chunk(7, 'fghij', 11, 12));
    await flush();
    o.loader.more();
    expect(asked[2].offset).toBe(11);
    asked[2].resolve(chunk(11, 'k', null, 12, { truncated: true }));
    await flush();
    expect(o.now().saved).toEqual({ text: 'abcdefghijk', next: null, total: 12, truncated: true });
    expect(outputLeft(o.now())).toBe(0);
    o.loader.more();
    expect(asked).toHaveLength(3);
  });

  it('keeps one chunk in flight however often it is asked', async () => {
    const { io, asked } = fakeIO();
    const o = open(io, SAVED);
    o.loader.more();
    o.loader.more();
    expect(asked).toHaveLength(1);
    asked[0].resolve(chunk(0, 'abc', 3, 9));
    await flush();
    o.loader.more();
    o.loader.more();
    expect(asked).toHaveLength(2);
  });

  it('ignores a repeat or a chunk out of place', async () => {
    const { io, asked } = fakeIO();
    const o = open(io, SAVED);
    asked[0].resolve(chunk(0, 'abc', 3, 9));
    await flush();
    o.loader.more();
    asked[1].resolve(chunk(0, 'abc', 3, 9));
    await flush();
    expect(o.now().saved).toMatchObject({ text: 'abc', next: 3 });
    o.loader.more();
    asked[2].resolve(chunk(6, 'ghi', null, 9));
    await flush();
    expect(o.now().saved).toMatchObject({ text: 'abc', next: 3 });
  });

  it('keeps the preview and offers a retry when a chunk fails', async () => {
    const { io, asked } = fakeIO();
    const o = open(io, SAVED);
    asked[0].reject(new Error('Cannot reach the Omni server. Is it running?'));
    await flush();
    expect(o.now()).toMatchObject({ busy: false, error: 'Cannot reach the Omni server. Is it running?' });
    expect(outputText(o.now(), 'PREVIEW')).toBe('PREVIEW');
    expect(outputLeft(o.now())).toBe(0);
    o.loader.more();
    expect(asked[1]).toMatchObject({ event: 7, offset: 0 });
    expect(o.now()).toMatchObject({ busy: true, error: null });
    asked[1].resolve(chunk(0, 'abc', null, 3));
    await flush();
    expect(o.now()).toMatchObject({ busy: false, error: null, saved: { text: 'abc' } });
  });

  it('retries a later chunk from where the loaded text ends', async () => {
    const { io, asked } = fakeIO();
    const o = open(io, SAVED);
    asked[0].resolve(chunk(0, 'abc', 3, 9));
    await flush();
    o.loader.more();
    asked[1].reject(new Error('boom'));
    await flush();
    expect(o.now().error).toBe('boom');
    expect(outputText(o.now())).toBe('abc');
    o.loader.more();
    expect(asked[2].offset).toBe(3);
  });

  it('aborts the request, drops the text and reports nothing once released', async () => {
    const { io, asked } = fakeIO();
    const o = open(io, SAVED);
    asked[0].resolve(chunk(0, 'abc', 3, 9));
    await flush();
    o.loader.more();
    const reported = o.seen.length;
    o.loader.release();
    expect(asked[1].signal.aborted).toBe(true);
    await flush();
    expect(o.seen).toHaveLength(reported);
    expect(o.loader.state()).toBe(IDLE);
    o.loader.more();
    expect(asked).toHaveLength(2);
  });

  it('drops a late answer after release', async () => {
    const { io, asked } = fakeIO();
    const o = open(io, SAVED);
    o.loader.release();
    asked[0].resolve(chunk(0, 'abc', null, 3));
    await flush();
    expect(o.loader.state()).toBe(IDLE);
    expect(o.now().saved.text).toBe('');
  });
});

describe('live tail', () => {
  it('opens one connection for the call and shows what it prints', () => {
    const { io, asked, tails } = fakeIO();
    const o = open(io, LIVE);
    expect(asked).toHaveLength(0);
    expect(tails).toHaveLength(1);
    expect(tails[0].tool).toBe('c1');
    tails[0].send(tail('one\n', { reset: true }));
    tails[0].send(tail('two\n'));
    expect(o.now().tail).toBe('one\ntwo\n');
    expect(o.now().skipped).toBe(false);
    tails[0].send(tail('fresh\n', { reset: true }));
    expect(o.now().tail).toBe('fresh\n');
  });

  it('never holds more than the client tail, and says older output is not shown', () => {
    const { io, tails } = fakeIO();
    const o = open(io, LIVE);
    const piece = 'x'.repeat(TOOL_OUTPUT.clientTail / 4);
    tails[0].send(tail(piece, { reset: true }));
    for (let i = 0; i < 6; i++) tails[0].send(tail(piece));
    expect(o.now().tail.length).toBe(TOOL_OUTPUT.clientTail);
    expect(o.now().skipped).toBe(true);
    for (const s of o.seen) expect(s.tail.length).toBeLessThanOrEqual(TOOL_OUTPUT.clientTail);
  });

  it('says so when the server dropped output, and forgets it on a reset that dropped none', () => {
    const { io, tails } = fakeIO();
    const o = open(io, LIVE);
    tails[0].send(tail('late', { reset: true, skipped: 4096 }));
    expect(o.now()).toMatchObject({ tail: 'late', skipped: true });
    tails[0].send(tail('more'));
    expect(o.now().skipped).toBe(true);
    tails[0].send(tail('whole', { reset: true }));
    expect(o.now()).toMatchObject({ tail: 'whole', skipped: false });
  });

  it('closes its connection when the stream ends, with or without live output', () => {
    const { io, tails } = fakeIO();
    const o = open(io, LIVE);
    tails[0].send(tail('out', { reset: true }));
    tails[0].send({ kind: 'end', live: false });
    expect(tails[0].closes).toBe(1);
    expect(o.now().tail).toBe('out');
  });

  it('closes a connection that ended before it was handed back', () => {
    const closes: number[] = [];
    const io: OutputIO = {
      chunk: () => new Promise(() => {}),
      tail: (_tool, onData) => {
        onData({ kind: 'end', live: false });
        return { close: () => void closes.push(1) };
      },
    };
    open(io, LIVE);
    expect(closes).toEqual([1]);
  });

  it('ignores a message it cannot read', () => {
    const { io, tails } = fakeIO();
    const o = open(io, LIVE);
    const before = o.seen.length;
    for (const junk of [null, 'text', 5, {}, { kind: 'tail' }, { kind: 'tail', text: 4 }, { kind: 'other' }]) tails[0].send(junk);
    expect(o.seen).toHaveLength(before);
  });

  it('releases the connection and what it held when the row closes', () => {
    const { io, tails } = fakeIO();
    const o = open(io, LIVE);
    tails[0].send(tail('out', { reset: true }));
    o.loader.release();
    expect(tails[0].closes).toBe(1);
    expect(o.loader.state()).toBe(IDLE);
    const reported = o.seen.length;
    tails[0].send(tail('late'));
    expect(o.seen).toHaveLength(reported);
  });

  it('opens a connection for each row that is open and none for a closed one', () => {
    const { io, tails } = fakeIO();
    const a = open(io, LIVE);
    const b = open(io, { kind: 'live', tool: 'c2' });
    expect(tails.map((t) => t.tool)).toEqual(['c1', 'c2']);
    a.loader.release();
    b.loader.release();
    expect(tails.map((t) => t.closes)).toEqual([1, 1]);
  });
});

describe('tailMessage', () => {
  it('reads the two messages the server sends', () => {
    expect(tailMessage({ kind: 'tail', text: 'a', skipped: 3, reset: true })).toEqual({ kind: 'tail', text: 'a', skipped: 3, reset: true });
    expect(tailMessage({ kind: 'tail', text: 'a' })).toEqual({ kind: 'tail', text: 'a', skipped: 0 });
    expect(tailMessage({ kind: 'end', live: true })).toEqual({ kind: 'end', live: true });
    expect(tailMessage({ kind: 'end' })).toEqual({ kind: 'end', live: false });
  });
});
