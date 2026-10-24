import { describe, expect, it } from 'vitest';
import { HISTORY_BUDGET } from '@omni/shared/history.ts';
import { longThread } from '@omni/test-fixtures/long-thread.ts';
import { startRunner } from './runner-boot.ts';

// The thread stream's catch-up (#224, apps/server/stream-catch-up.ts): a connection replays the rows after `after` when
// they fit one page, else sends the newest page in a sync; either way one sync carries the thread's state now. Live
// rows racing the catch-up arrive exactly once, and every row the stream sends fits rowBytes.

const r = await startRunner();
const { app } = await import('../app.ts');
const { bus, publishFeed } = await import('../bus.ts');
const { addEvent } = await import('../runner/state.ts');
const { recordContext } = await import('../context.ts');
const { headPage } = await import('../history.ts');

const B = HISTORY_BUDGET;
const thread = (id: string) =>
  r.db.threads.create({
    id, channel_id: 'scratch', title: `Thread ${id}`, status: 'done', role: null, model: null, session_id: id, cwd: r.tmp,
    branch: null, parent_id: null, task_id: null, source: 'manual', automation: null,
  });
const text = (n: number, i = 0) => ({ text: `${i} ${'x'.repeat(n)}` });

type Frame = { id?: string; event?: string; data: any };

/** An open stream: frames as they arrive, and a wait for one that matches. */
function open(threadId: string, after: string | null) {
  const ac = new AbortController();
  const frames: Frame[] = [];
  let buf = '';
  let wake: () => void = () => {};
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  const ready = app.request(`/api/threads/${threadId}/stream${after === null ? '' : `?after=${after}`}`, { signal: ac.signal });
  const pump = (async () => {
    reader = (await ready).body!.getReader();
    const dec = new TextDecoder();
    for (;;) {
      const { value, done } = await reader!.read();
      if (done) return;
      buf += dec.decode(value, { stream: true });
      let cut: number;
      while ((cut = buf.indexOf('\n\n')) >= 0) {
        const f: Frame = { data: '' };
        for (const line of buf.slice(0, cut).split('\n')) {
          const at = line.indexOf(': ');
          const [k, v] = at < 0 ? [line.replace(/:$/, ''), ''] : [line.slice(0, at), line.slice(at + 2)];
          if (k === 'id') f.id = v;
          else if (k === 'event') f.event = v;
          else if (k === 'data') f.data = v ? JSON.parse(v) : '';
        }
        buf = buf.slice(cut + 2);
        if (f.event !== 'ping') frames.push(f);
        wake();
      }
    }
  })().catch(() => {});
  return {
    frames,
    async until(test: (f: Frame) => boolean, ms = 10_000) {
      const end = Date.now() + ms;
      while (!frames.some(test)) {
        if (Date.now() > end) throw new Error(`no matching frame in ${JSON.stringify(frames.map((f) => f.data?.kind ?? f.data?.id))}`);
        await Promise.race([new Promise<void>((w) => (wake = w)), new Promise((w) => setTimeout(w, 50))]);
      }
      return frames.find(test)!;
    },
    async close() {
      ac.abort();
      await reader?.cancel().catch(() => {});
      await pump;
    },
  };
}

const isRow = (f: Frame) => typeof f.data?.id === 'number' && typeof f.data?.payload === 'string';
const isSync = (f: Frame) => f.data?.kind === 'sync';
const rowIds = (fs: Frame[]) => fs.filter(isRow).map((f) => f.data.id as number);
const before = (fs: Frame[], test: (f: Frame) => boolean) => fs.slice(0, fs.findIndex(test));
const after = (fs: Frame[], test: (f: Frame) => boolean) => fs.slice(fs.findIndex(test) + 1);
/** Every row the client holds once the sync is in: replayed and live, plus a snapshot's page. */
const held = (fs: Frame[]) => [...rowIds(before(fs, isSync)), ...(fs.find(isSync)?.data.events ?? []).map((e: any) => e.id), ...rowIds(after(fs, isSync))];

thread('short');
const short = Array.from({ length: 10 }, (_, i) => r.db.events.add('short', 'assistant_text', text(10, i)).id);

describe('a short disconnect', () => {
  it('replays only the missed rows, then one sync with the state and no events', async () => {
    const s = open('short', String(short[6]));
    const sync = await s.until(isSync);
    await s.close();
    expect(rowIds(before(s.frames, isSync))).toEqual(short.slice(7));
    expect(before(s.frames, isSync).map((f) => f.id)).toEqual(short.slice(7).map(String));
    expect(sync.id).toBeUndefined();
    expect(sync.data).toMatchObject({ catch_up: 'replay', events: [], thread: { id: 'short' }, pending: [], artifacts: [], live: false });
    expect(sync.data).not.toHaveProperty('history');
  });

  it('sends only the sync when nothing was missed', async () => {
    const s = open('short', String(short.at(-1)));
    await s.until(isSync);
    await s.close();
    expect(s.frames.filter(isRow)).toEqual([]);
  });

  it('replays from the start for a first connect with nothing held', async () => {
    const s = open('short', null);
    await s.until(isSync);
    await s.close();
    expect(rowIds(s.frames)).toEqual(short);
  });

  it('sends the thread context reading after the sync', async () => {
    recordContext('short', { used: 1200, max: 200_000, model: 'm', source: 'claude-cli', categories: [] } as any);
    const s = open('short', String(short.at(-1)));
    const ctx = await s.until((f) => f.data?.kind === 'context');
    await s.close();
    expect(s.frames.indexOf(ctx)).toBeGreaterThan(s.frames.findIndex(isSync));
    expect(ctx.data.context.used).toBe(1200);
  });
});

describe('a gap over the budget', () => {
  it('sends the newest page in place of more rows than a page holds', async () => {
    thread('many');
    const ids = Array.from({ length: B.rows + 5 }, (_, i) => r.db.events.add('many', 'assistant_text', text(10, i)).id);
    const s = open('many', '0');
    const sync = await s.until(isSync);
    await s.close();
    expect(before(s.frames, isSync)).toEqual([]);
    expect(sync.data.catch_up).toBe('snapshot');
    expect(sync.data.events).toEqual(headPage('many').events);
    expect(sync.data.history).toEqual(headPage('many').history);
    expect(sync.id).toBe(String(ids.at(-1)));
    // One row short of the budget still replays.
    const t = open('many', String(ids[4]));
    await t.until(isSync);
    await t.close();
    expect(rowIds(t.frames)).toEqual(ids.slice(5));
  });

  it('sends the newest page in place of more bytes than a page holds', async () => {
    thread('heavy');
    const ids = Array.from({ length: 12 }, (_, i) => r.db.events.add('heavy', 'assistant_text', text(25_000, i)).id);
    const s = open('heavy', '0');
    const sync = await s.until(isSync);
    await s.close();
    expect(sync.data.catch_up).toBe('snapshot');
    expect(Buffer.byteLength(JSON.stringify(sync.data.events))).toBeLessThanOrEqual(B.bytes + B.anchorBytes);
    const t = open('heavy', String(ids[4]));
    await t.until(isSync);
    await t.close();
    expect(rowIds(t.frames)).toEqual(ids.slice(5));
  });

  it('opens a large retained history on its newest page, and replays its last few rows', async () => {
    thread('long');
    for (const e of longThread()) r.db.events.add('long', e.kind, e.payload);
    const all = r.db.events.since('long');
    const s = open('long', String(all[0].id));
    const sync = await s.until(isSync);
    await s.close();
    expect(sync.data.catch_up).toBe('snapshot');
    expect(Buffer.byteLength(JSON.stringify(sync.data))).toBeLessThan(B.bytes + B.anchorBytes + 16 * 1024);
    expect(sync.data.events.length).toBeLessThanOrEqual(B.rows + B.anchors);
    const t = open('long', String(all.at(-4)!.id));
    await t.until(isSync);
    await t.close();
    expect(rowIds(t.frames)).toEqual(all.slice(-3).map((e) => e.id));
  });
});

describe('oversized rows', () => {
  it('clip in a replay and live, never sent whole', async () => {
    thread('big');
    const first = r.db.events.add('big', 'user', { text: 'hi', source: 'ben' }).id;
    const huge = r.db.events.add('big', 'tool_result', { tool_use_id: 'c', text: 'y'.repeat(2_000_000), truncated: false }).id;
    const s = open('big', String(first));
    await s.until(isSync);
    const live = addEvent('big', 'assistant_text', { text: 'z'.repeat(500_000) }).id;
    const f = await s.until((x) => x.data?.id === live);
    await s.close();
    const replayed = s.frames.find((x) => x.data?.id === huge)!;
    for (const row of [replayed.data, f.data]) {
      expect(Buffer.byteLength(JSON.stringify(row))).toBeLessThanOrEqual(B.rowBytes);
      expect(row.clipped.bytes).toBeGreaterThan(B.rowBytes);
    }
    expect(JSON.parse(replayed.data.payload)).toMatchObject({ tool_use_id: 'c', truncated: true });
  });
});

describe('a stale cursor', () => {
  it('past the thread end, or not an id, gets the newest page', async () => {
    for (const cursor of [String(short.at(-1)! + 1_000_000), 'nope', '-3', '1.5']) {
      const s = open('short', cursor);
      const sync = await s.until(isSync);
      await s.close();
      expect(before(s.frames, isSync), cursor).toEqual([]);
      expect(sync.data.catch_up, cursor).toBe('snapshot');
      expect(sync.data.events.map((e: any) => e.id), cursor).toEqual(short);
      // Past the end, the client may have seen that id already, and would drop the sync.
      expect(sync.id, cursor).toBe(/^\d+$/.test(cursor) ? undefined : String(short.at(-1)));
    }
  });

  it('on an empty thread is a snapshot with no rows and no id', async () => {
    thread('empty');
    const s = open('empty', '42');
    const sync = await s.until(isSync);
    await s.close();
    expect(sync.data).toMatchObject({ catch_up: 'snapshot', events: [], history: { from: 0, to: null, results_below: 0 } });
    expect(sync.id).toBeUndefined();
  });
});

describe('live output during the catch-up', () => {
  /** Runs `fn` once, right after the stream subscribes to `event` and before it reads its catch-up. */
  const onSubscribe = (event: string, fn: () => void) => {
    const hook = (name: string | symbol) => {
      if (name !== event) return;
      bus.off('newListener', hook);
      queueMicrotask(fn);
    };
    bus.on('newListener', hook);
  };

  it('a row written between the subscribe and the read arrives once', async () => {
    thread('race');
    const base = r.db.events.add('race', 'user', { text: 'go', source: 'ben' }).id;
    let raced = 0;
    onSubscribe('thread:race', () => (raced = addEvent('race', 'assistant_text', text(10)).id));
    const s = open('race', String(base));
    await s.until(isSync);
    const marker = addEvent('race', 'assistant_text', text(10, 1)).id;
    await s.until((f) => f.data?.id === marker);
    await s.close();
    expect(raced).toBeGreaterThan(base);
    expect(rowIds(s.frames)).toEqual([raced, marker]);
  });

  it('a row written between the subscribe and a snapshot arrives once, inside the page', async () => {
    thread('race-snap');
    for (let i = 0; i < B.rows + 5; i++) r.db.events.add('race-snap', 'assistant_text', text(10, i));
    let raced = 0;
    onSubscribe('thread:race-snap', () => (raced = addEvent('race-snap', 'assistant_text', text(10)).id));
    const s = open('race-snap', '0');
    const sync = await s.until(isSync);
    const marker = addEvent('race-snap', 'assistant_text', text(10, 1)).id;
    await s.until((f) => f.data?.id === marker);
    await s.close();
    expect(sync.data.events.at(-1).id).toBe(raced);
    expect(sync.id).toBe(String(raced));
    expect(rowIds(after(s.frames, isSync))).toEqual([marker]);
  });

  it('a thread change queued before the sync is not sent after it', async () => {
    thread('stale-state');
    const base = r.db.events.add('stale-state', 'user', { text: 'go', source: 'ben' }).id;
    const old = { ...r.db.threads.get('stale-state')!, title: 'Old title' };
    onSubscribe('feed', () => publishFeed({ type: 'thread', thread: old }));
    const s = open('stale-state', String(base));
    await s.until(isSync);
    const marker = addEvent('stale-state', 'assistant_text', text(10)).id;
    await s.until((f) => f.data?.id === marker);
    await s.close();
    expect(s.frames.filter((f) => f.data?.kind === 'thread')).toEqual([]);
    expect(s.frames.find(isSync)!.data.thread.title).toBe('Thread stale-state');
  });

  it('streams opened while rows pour in miss none and repeat none', async () => {
    thread('pour');
    const first = r.db.events.add('pour', 'user', { text: 'go', source: 'ben' }).id;
    const total = 400;
    const written: number[] = [first];
    const streams: { s: ReturnType<typeof open>; from: number }[] = [];
    for (let i = 0; i < total; i++) {
      written.push(addEvent('pour', 'assistant_text', text(i % 3 ? 10 : 1500, i)).id);
      if (i % 40 === 0) {
        // Late ones from the start: more rows than a page, so a snapshot.
        const from = i >= 320 ? first : written[Math.max(0, written.length - 1 - ((i * 7) % 350))];
        streams.push({ s: open('pour', String(from)), from });
      }
      await new Promise((w) => setImmediate(w));
    }
    const last = written.at(-1)!;
    for (const { s, from } of streams) {
      await s.until((f) => f.data?.id === last || (isSync(f) && f.data.events.some((e: any) => e.id === last)));
      await s.close();
      const ids = held(s.frames);
      const sync = s.frames.find(isSync)!;
      const start = sync.data.catch_up === 'snapshot' ? sync.data.history.from : from + 1;
      expect(ids, `after ${from}`).toEqual(written.filter((id) => id >= start));
      expect(new Set(ids).size).toBe(ids.length);
    }
    expect(streams.some(({ s }) => s.frames.find(isSync)!.data.catch_up === 'snapshot')).toBe(true);
    expect(streams.some(({ s }) => s.frames.find(isSync)!.data.catch_up === 'replay')).toBe(true);
  });
});
