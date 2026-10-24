import { describe, expect, it } from 'vitest';
import { realpathSync } from 'node:fs';
import { TOOL_OUTPUT, type TailMessage } from '@omni/shared/tool-output.ts';
import { macFixture } from './fixture-shape.ts';
import { startRunner } from './runner-boot.ts';

// The shapes the Mac app reads for compact tool output (#225): a thread whose head holds a compact result beside a
// whole one, two chunks of the compact one's saved output, and a tail's messages. The server makes them here, in
// process, since the fixtures server runs the fake claude, which prints a tool's output only when it ends. The Swift
// tests decode the recorded files (apps/mac/OmniKit/Tests/OmniKitTests/ToolOutputTests.swift). To record them again:
//   OMNI_RECORD_MAC_FIXTURES=1 npx vitest run --config apps/server/vitest.config.ts apps/server/tests/tool-output-fixtures.test.ts

const r = await startRunner();
const { app } = await import('../app.ts');
const { toolTails } = await import('../tool-tail.ts');

const ID = 'output';
r.db.threads.create({
  id: ID, channel_id: 'scratch', title: 'Run the tests', status: 'done', role: null, model: null, session_id: ID, cwd: r.tmp,
  branch: null, parent_id: null, task_id: null, source: 'manual', automation: null,
});
const add = (kind: string, payload: unknown) => r.db.events.add(ID, kind, payload).id;
const failing = `Exit code 1\n${Array.from({ length: 140 }, (_, i) => `FAIL src/cart-${i}.test.ts > rounds the total (${i} ms)\n    expected 10.05 to be 10.06`).join('\n')}`;
add('user', { text: 'run the tests', source: 'ben' });
add('tool_use', { id: 'call-ls', name: 'Bash', input: { command: 'ls src' }, parent: null });
add('tool_result', { tool_use_id: 'call-ls', text: 'cart.ts\ntax.ts\n', is_error: false, truncated: false });
add('tool_use', { id: 'call-test', name: 'Bash', input: { command: 'npm test' }, parent: null });
const compact = add('tool_result', { tool_use_id: 'call-test', text: failing, is_error: true, truncated: false });
add('assistant_text', { text: 'Two things fail; the first is the rounding.' });
add('result', { ok: true, subtype: 'success', turns: 1 });

const get = async (path: string) => {
  const res = await app.request(`/api${path}`);
  expect(res.status, path).toBe(200);
  return res.json();
};

/** The messages of a tail stream, as they arrive. */
async function tailFrames(call: string, drive: (wait: (n: number) => Promise<void>) => Promise<void>): Promise<TailMessage[]> {
  const ac = new AbortController();
  const frames: TailMessage[] = [];
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let buf = '';
  let wake = () => {};
  const pump = (async () => {
    reader = (await app.request(`/api/threads/${ID}/tools/${call}/tail`, { signal: ac.signal })).body!.getReader();
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
  const wait = async (n: number) => {
    const end = Date.now() + 5_000;
    while (frames.length < n) {
      expect(Date.now(), `${n} frames, have ${JSON.stringify(frames).slice(0, 300)}`).toBeLessThan(end);
      await new Promise<void>((resolve) => {
        wake = resolve;
        setTimeout(resolve, 25);
      });
    }
  };
  await drive(wait);
  ac.abort();
  await reader?.cancel().catch(() => {});
  await pump;
  return frames;
}

describe('the Mac fixtures for tool output', () => {
  it('hold the shapes the server sends now', async () => {
    const places = [r.tmp, realpathSync(r.tmp)];
    const open = (await get(`/threads/${ID}?history=recent`)) as { events: { id: number; kind: string; payload: string }[] };
    const result = open.events.find((e) => e.id === compact)!;
    expect(JSON.parse(result.payload)).toMatchObject({ is_error: true, truncated: true, output: { exit_code: 1 } });
    expect(JSON.parse(open.events.find((e) => e.kind === 'tool_result')!.payload).output, 'a short result travels whole').toBeUndefined();
    macFixture('tool-output-open.json', open, places);

    const first = (await get(`/threads/${ID}/events/${compact}/output?offset=0&limit=400`)) as { next: number | null; total: number };
    expect(first.next).toBe(400);
    macFixture('tool-output-chunk.json', first, places);
    const last = (await get(`/threads/${ID}/events/${compact}/output?offset=${first.total - 100}&limit=400`)) as { next: number | null; text: string };
    expect(last).toMatchObject({ next: null });
    expect(last.text).toHaveLength(100);
    macFixture('tool-output-chunk-end.json', last, places);

    // The call is running with some output before the client joins, so its first message is the tail so far.
    toolTails.begin(ID, 'call-live');
    toolTails.append(ID, 'call-live', 'Compiling 1/3\n');
    const frames = await tailFrames('call-live', async (wait) => {
      await wait(1);
      toolTails.append(ID, 'call-live', 'Compiling 2/3\n');
      await wait(2);
      toolTails.append(ID, 'call-live', 'x'.repeat(TOOL_OUTPUT.pending + 50));
      await wait(3);
      toolTails.end(ID, 'call-live');
      await wait(4);
    });
    expect(frames.map((f) => f.kind)).toEqual(['tail', 'tail', 'tail', 'end']);
    expect(frames[0]).toMatchObject({ reset: true, text: 'Compiling 1/3\n', skipped: 0 });
    expect(frames[2]).toMatchObject({ kind: 'tail', skipped: 50 });
    // The big message is a run of one letter: its text is not the fixture.
    macFixture('tool-tail.json', frames.map((f) => (f.kind === 'tail' && f.text.length > 100 ? { ...f, text: `${f.text.slice(0, 8)}…` } : f)), places);
  });
});
