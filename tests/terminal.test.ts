import { afterAll, describe, expect, it } from 'vitest';
import { mkdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { startRunner } from './runner-boot.ts';

// /api/threads/:id/terminal: a real shell per thread, in the thread's working directory.

process.env.SHELL = '/bin/sh';
const r = await startRunner();
const { terminalApi } = await import('../server/terminal-api.ts');
const { closeAllTerminals, getTerminal, SCROLLBACK_LINES } = await import('../server/terminal.ts');
afterAll(() => closeAllTerminals());

const call = async (path: string, method = 'GET', body?: unknown) => {
  const res = await terminalApi.request(path, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
};

/** Reads a terminal stream's messages until `done` says stop. */
async function readStream(id: string, done: (msgs: any[]) => boolean, query = '') {
  const ctrl = new AbortController();
  const res = await terminalApi.request(`/${id}/terminal/stream${query}`, { signal: ctrl.signal });
  expect(res.headers.get('content-type')).toContain('text/event-stream');
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  const msgs: any[] = [];
  let buf = '';
  const deadline = Date.now() + 8000;
  while (!done(msgs)) {
    if (Date.now() > deadline) throw new Error(`timed out; got ${JSON.stringify(msgs)}`);
    const { value, done: end } = await reader.read();
    if (end) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const chunk = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const line = chunk.split('\n').find((l) => l.startsWith('data: '));
      if (line && line.length > 6) msgs.push(JSON.parse(line.slice(6)));
    }
  }
  ctrl.abort();
  await reader.cancel().catch(() => {});
  return msgs;
}
const output = (msgs: any[]) => msgs.map((m) => m.data ?? '').join('');

/** The server's headless screen, scrollback included, as text lines. */
const lines = (id: string) => {
  const b = getTerminal(id)!.screen.buffer.active;
  return Array.from({ length: b.length }, (_, i) => b.getLine(i)!.translateToString(true));
};
/** The same, with soft-wrapped rows joined back into their lines. */
const screen = (id: string) => {
  const b = getTerminal(id)!.screen.buffer.active;
  return lines(id).reduce((out, l, i) => out + (i > 0 && !b.getLine(i)!.isWrapped ? '\n' : '') + l, '');
};

const idleThread = async () => {
  const t = await r.start('hello', { title: 'Shell' });
  await r.untilResults(t.id, 1);
  const cwd = join(r.tmp, `cwd-${t.id.slice(0, 6)}`);
  mkdirSync(cwd, { recursive: true });
  r.db.threads.update(t.id, { cwd });
  return { id: t.id, cwd: realpathSync(cwd) };
};

describe('thread terminal', () => {
  it('opens a shell in the thread cwd on first stream, runs input, and knows the thread', async () => {
    const t = await idleThread();
    expect((await call(`/${t.id}/terminal`)).body).toMatchObject({ open: false, running: false });

    const pending = readStream(t.id, (m) => output(m).includes('OUT:'), '?cols=100&rows=30');
    await r.until('the shell', () => getTerminal(t.id));
    expect((await call(`/${t.id}/terminal/input`, 'POST', { data: 'echo "OUT:$(pwd)|$OMNI_THREAD_ID|$(tput cols)"\n' })).status).toBe(200);
    const msgs = await pending;
    expect(msgs[0]).toMatchObject({ kind: 'snapshot', running: true });
    await r.until('the echo', () => /OUT:[^\n]*\|[^\n]*\|\d+/.test(screen(t.id)));
    const line = screen(t.id).match(/OUT:([^|\r\n]*)\|([^|]*)\|(\d+)/)!;
    expect(realpathSync(line[1])).toBe(t.cwd);
    expect(line[2]).toBe(t.id);
    expect(line[3]).toBe('100');

    const state = await call(`/${t.id}/terminal`);
    expect(state.body).toMatchObject({ open: true, running: true, cwd: expect.stringContaining('cwd-'), cols: 100, rows: 30 });
  });

  it('replays recent output to a client that attaches later, and resizes', async () => {
    const t = await idleThread();
    await call(`/${t.id}/terminal`, 'POST', { cols: 80, rows: 24 });
    await call(`/${t.id}/terminal/input`, 'POST', { data: 'echo REPLAY-$((6*7))\n' });
    await r.until('the echo', () => screen(t.id).includes('REPLAY-42'));
    const msgs = await readStream(t.id, (m) => m.length >= 1);
    expect(msgs[0].kind).toBe('snapshot');
    expect(msgs[0].data).toContain('REPLAY-42');

    expect((await call(`/${t.id}/terminal/resize`, 'POST', { cols: 120, rows: 40 })).status).toBe(200);
    await call(`/${t.id}/terminal/input`, 'POST', { data: 'echo SIZE-$(tput cols)x$(tput lines)\n' });
    await r.until('the size', () => screen(t.id).includes('SIZE-120x40'));
  });

  it('says when the shell exits, stays exited on reconnect, and POST starts a fresh one', async () => {
    const t = await idleThread();
    await call(`/${t.id}/terminal`, 'POST', {});
    const pending = readStream(t.id, (m) => m.some((x) => x.kind === 'exit'));
    await call(`/${t.id}/terminal/input`, 'POST', { data: 'exit 3\n' });
    const msgs = await pending;
    expect(msgs.find((m) => m.kind === 'exit')).toEqual({ kind: 'exit', code: 3 });

    const again = await readStream(t.id, (m) => m.length >= 1);
    expect(again[0]).toMatchObject({ kind: 'snapshot', running: false, code: 3 });
    expect((await call(`/${t.id}/terminal/input`, 'POST', { data: 'ls\n' })).status).toBe(409);

    const fresh = await call(`/${t.id}/terminal`, 'POST', {});
    expect(fresh.body).toMatchObject({ open: true, running: true, code: null });
  });

  it('hangs up on DELETE', async () => {
    const t = await idleThread();
    const { body } = await call(`/${t.id}/terminal`, 'POST', {});
    expect((await call(`/${t.id}/terminal`, 'DELETE')).body).toMatchObject({ open: false });
    expect(getTerminal(t.id)).toBeUndefined();
    await r.until('the shell to die', () => {
      try {
        process.kill(body.pid, 0);
        return false;
      } catch {
        return true;
      }
    });
  });

  it('reflows the screen to a narrower client before the snapshot', async () => {
    const t = await idleThread();
    await call(`/${t.id}/terminal`, 'POST', { cols: 120, rows: 24 });
    await call(`/${t.id}/terminal/input`, 'POST', { data: `echo WIDE-${'y'.repeat(70)}\n` });
    await r.until('the echo', () => screen(t.id).includes('WIDE-'));
    const msgs = await readStream(t.id, (m) => m.length >= 1, '?cols=40&rows=20');
    expect(msgs[0].kind).toBe('snapshot');
    expect(getTerminal(t.id)).toMatchObject({ cols: 40, rows: 20 });
    // The 75-character line now wraps at 40 on the server too, so the client draws what the shell sees.
    expect(lines(t.id).every((l) => l.length <= 40)).toBe(true);
    expect(msgs[0].data).toContain('WIDE-');
  });

  it('caps the scrollback', async () => {
    const t = await idleThread();
    await call(`/${t.id}/terminal`, 'POST', {});
    await call(`/${t.id}/terminal/input`, 'POST', { data: 'i=0; while [ $i -lt 4000 ]; do echo "line $i"; i=$((i+1)); done; echo CAP-DONE\n' });
    await r.until('the output', () => screen(t.id).includes('\nCAP-DONE'), 15000);
    expect(lines(t.id).length).toBeLessThanOrEqual(SCROLLBACK_LINES + 24);
  }, 20000);

  it('is 404 for an unknown thread, 409 when the cwd is gone, 400 on a bad body', async () => {
    expect((await call('/nope/terminal')).status).toBe(404);
    expect((await call('/nope/terminal/stream')).status).toBe(404);
    const t = await idleThread();
    r.db.threads.update(t.id, { cwd: join(r.tmp, 'gone') });
    expect((await call(`/${t.id}/terminal`, 'POST', {})).status).toBe(409);
    expect((await call(`/${t.id}/terminal/resize`, 'POST', { cols: 'wide' })).status).toBe(400);
  });
});
