import { describe, expect, it } from 'vitest';
import { TOOL_OUTPUT, applyTail, type TailMessage } from '@omni/shared/tool-output.ts';
import { startRunner } from './runner-boot.ts';

// The live tail of a running tool call (#225, apps/server/tool-tail.ts): a noisy command never reaches the bus, a
// subscriber's buffer cannot outgrow TOOL_OUTPUT.pending however slowly it reads, the server tracks a bounded number
// of calls, and closing the connection frees the subscription.

const r = await startRunner();
const { app } = await import('../app.ts');
const { bus } = await import('../bus.ts');
const { ToolTails } = await import('../tool-tail.ts');
const { toolTails } = await import('../tool-tail.ts');

const thread = (id: string) =>
  r.db.threads.create({
    id, channel_id: 'scratch', title: `Thread ${id}`, status: 'running', role: null, model: null, session_id: id, cwd: r.tmp,
    branch: null, parent_id: null, task_id: null, source: 'manual', automation: null,
  });
const PENDING = TOOL_OUTPUT.pending;
const tailOf = (m: TailMessage | null) => (m?.kind === 'tail' ? m : null);

describe('a running call', () => {
  it('keeps a late subscriber to the newest output, and counts what it dropped', () => {
    const t = new ToolTails();
    t.begin('t', 'c');
    for (let i = 0; i < 100; i++) t.append('t', 'c', `${String(i).padStart(4, '0')} ${'x'.repeat(995)}\n`);
    const late = t.subscribe('t', 'c');
    const m = tailOf(late.take())!;
    expect(m.reset).toBe(true);
    expect(m.text.length).toBeLessThanOrEqual(PENDING);
    expect(m.text.endsWith(`0099 ${'x'.repeat(995)}\n`)).toBe(true);
    expect(m.skipped + m.text.length).toBe(100 * 1001);
  });

  it('bounds a slow subscriber: older output is dropped and counted, never queued', () => {
    const t = new ToolTails();
    t.begin('t', 'c');
    const slow = t.subscribe('t', 'c');
    expect(tailOf(slow.take())).toMatchObject({ text: '', skipped: 0, reset: true });
    let sent = 0;
    for (let i = 0; i < 5_000; i++) {
      const line = `${i} ${'y'.repeat(200)}\n`;
      sent += line.length;
      t.append('t', 'c', line);
    }
    const m = tailOf(slow.take())!;
    expect(m.reset).toBeUndefined();
    expect(m.text.length).toBeLessThanOrEqual(PENDING);
    expect(m.skipped + m.text.length).toBe(sent);
    expect(slow.take(), 'the buffer is empty after a take').toBeNull();
    // A client that applies the messages never holds more than its own cap.
    expect(applyTail('a'.repeat(TOOL_OUTPUT.clientTail), m).length).toBeLessThanOrEqual(TOOL_OUTPUT.clientTail);
  });

  it('never splits a surrogate pair where it drops', () => {
    const t = new ToolTails();
    t.begin('t', 'c');
    const s = t.subscribe('t', 'c');
    s.take();
    t.append('t', 'c', '😀'.repeat(PENDING));
    const m = tailOf(s.take())!;
    expect(m.text.charCodeAt(0) >= 0xdc00 && m.text.charCodeAt(0) <= 0xdfff).toBe(false);
    expect(m.text.length).toBeLessThanOrEqual(PENDING);
  });

  it('ends its subscribers when the call ends, after what they have not read', () => {
    const t = new ToolTails();
    t.begin('t', 'c');
    const s = t.subscribe('t', 'c');
    s.take();
    t.append('t', 'c', 'last words');
    t.end('t', 'c');
    expect(tailOf(s.take())).toMatchObject({ text: 'last words' });
    expect(s.take()).toEqual({ kind: 'end', live: true });
    expect(t.stats()).toEqual({ calls: 0, tails: 0 });
    s.close();
  });

  it('says there is no live output for a call it does not track', () => {
    const t = new ToolTails();
    expect(t.subscribe('t', 'unknown').take()).toEqual({ kind: 'end', live: false });
  });

  it('tracks a bounded number of calls, the oldest ending first, and ends a thread\'s calls with its process', () => {
    const t = new ToolTails();
    const first = (t.begin('t', 'c0'), t.subscribe('t', 'c0'));
    first.take();
    for (let i = 1; i <= TOOL_OUTPUT.calls; i++) t.begin('t', `c${i}`);
    expect(t.stats().calls).toBe(TOOL_OUTPUT.calls);
    expect(first.take()).toEqual({ kind: 'end', live: false });
    const a = (t.begin('p', 'x'), t.subscribe('p', 'x'));
    a.take();
    t.endThread('p');
    expect(a.take()).toEqual({ kind: 'end', live: true });
    // The 65th call pushed the oldest out, then the thread's call ended.
    expect(t.stats().calls).toBe(TOOL_OUTPUT.calls - 1);
  });
});

/** An open tail stream: its messages, and a way to read slowly. */
function open(threadId: string, call: string) {
  const ac = new AbortController();
  const frames: TailMessage[] = [];
  let buf = '';
  let wake: () => void = () => {};
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  const pump = (async () => {
    const res = await app.request(`/api/threads/${threadId}/tools/${call}/tail`, { signal: ac.signal });
    reader = res.body!.getReader();
    const dec = new TextDecoder();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      buf += dec.decode(value, { stream: true });
      let cut: number;
      while ((cut = buf.indexOf('\n\n')) >= 0) {
        const lines = buf.slice(0, cut).split('\n');
        buf = buf.slice(cut + 2);
        const data = lines.includes('event: ping') ? undefined : lines.find((l) => l.startsWith('data: '));
        if (data) frames.push(JSON.parse(data.slice(6)));
        wake();
      }
    }
  })().catch(() => {});
  return {
    frames,
    async until(test: (m: TailMessage) => boolean, ms = 5_000) {
      const end = Date.now() + ms;
      for (;;) {
        const hit = frames.find(test);
        if (hit) return hit;
        if (Date.now() > end) throw new Error(`no matching frame in ${JSON.stringify(frames).slice(0, 400)}`);
        await new Promise<void>((resolve) => {
          wake = resolve;
          setTimeout(resolve, 50);
        });
      }
    },
    async close() {
      ac.abort();
      await reader?.cancel().catch(() => {});
      await pump;
    },
  };
}
const settled = async (check: () => boolean, ms = 3_000) => {
  const end = Date.now() + ms;
  while (!check() && Date.now() < end) await new Promise((resolve) => setTimeout(resolve, 20));
  return check();
};

describe('GET /api/threads/:id/tools/:toolUseId/tail', () => {
  thread('live');

  it('follows a noisy command in few, bounded messages, off the bus, and ends with the call', async () => {
    const seen: unknown[] = [];
    const onThread = (e: unknown) => seen.push(e);
    const onFeed = (e: unknown) => seen.push(e);
    bus.on('thread:live', onThread);
    bus.on('feed', onFeed);
    try {
      toolTails.begin('live', 'noisy');
      const s = open('live', 'noisy');
      await s.until((m) => m.kind === 'tail' && !!m.reset);
      let sent = 0;
      for (let i = 0; i < 20_000; i++) {
        const line = `line ${i} ${'z'.repeat(80)}\n`;
        sent += line.length;
        toolTails.append('live', 'noisy', line);
        if (i % 2_000 === 0) await new Promise((resolve) => setTimeout(resolve, 5));
      }
      toolTails.end('live', 'noisy');
      await s.until((m) => m.kind === 'end');
      const tails = s.frames.filter((m): m is Extract<TailMessage, { kind: 'tail' }> => m.kind === 'tail');
      expect(tails.length, 'messages for 20,000 lines of output').toBeLessThan(200);
      for (const m of tails) expect(m.text.length).toBeLessThanOrEqual(PENDING);
      expect(tails.reduce((n, m) => n + m.text.length + m.skipped, 0)).toBe(sent);
      expect(s.frames.at(-1)).toEqual({ kind: 'end', live: true });
      expect(seen, 'nothing reached the thread bus or the global feed').toEqual([]);
      await s.close();
    } finally {
      bus.off('thread:live', onThread);
      bus.off('feed', onFeed);
    }
    expect(toolTails.stats()).toEqual({ calls: 0, tails: 0 });
  });

  it('releases the subscription when the client closes the connection', async () => {
    toolTails.begin('live', 'quiet');
    const s = open('live', 'quiet');
    await s.until((m) => m.kind === 'tail');
    expect(toolTails.stats().tails).toBe(1);
    await s.close();
    expect(await settled(() => toolTails.stats().tails === 0), 'subscribers after close').toBe(true);
    // The call itself goes on until its result.
    expect(toolTails.stats().calls).toBe(1);
    toolTails.end('live', 'quiet');
  });

  it('ends at once for a call with no live output, and 404s for a thread that is not there', async () => {
    const s = open('live', 'claude-bash');
    await s.until((m) => m.kind === 'end');
    expect(s.frames).toEqual([{ kind: 'end', live: false }]);
    await s.close();
    expect((await app.request('/api/threads/nope/tools/x/tail')).status).toBe(404);
  });
});
