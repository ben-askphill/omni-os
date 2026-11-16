import { describe, expect, it } from 'vitest';
import { parseArgs } from '../src/args.ts';
import { connection } from '../src/connection.ts';
import { UsageError } from '../src/io.ts';
import { settle } from '../src/wait.ts';
import { detail, wire } from './helpers.ts';

describe('parseArgs', () => {
  const specs = { channel: { short: 'c', value: true }, wait: { short: 'w' } };
  it('reads long, short and inline values, switches, "-" and everything after "--"', () => {
    expect(parseArgs(['hi', '-c', 'acme', '--wait', 'there', '-', '--', '--not-a-flag'], specs, 'new')).toEqual({
      positional: ['hi', 'there', '-', '--not-a-flag'],
      flags: { channel: 'acme', wait: true },
    });
    expect(parseArgs(['--channel=volero'], specs, 'new').flags).toEqual({ channel: 'volero' });
  });
  it('refuses unknown options, a value on a switch and a missing value', () => {
    expect(() => parseArgs(['-x'], specs, 'new')).toThrow(UsageError);
    expect(() => parseArgs(['--wait=1'], specs, 'new')).toThrow(/takes no value/);
    expect(() => parseArgs(['-c'], specs, 'new')).toThrow(/needs a value/);
  });
});

describe('connection', () => {
  const read = (files: Record<string, string>) => (p: string) => files[p] ?? null;
  it('uses a thread’s OMNI_URL and OMNI_TOKEN as they are', () => {
    const c = connection({ env: { OMNI_URL: 'http://127.0.0.1:4799/', OMNI_TOKEN: ' t ', OMNI_THREAD_ID: 'me' }, readFile: read({}) });
    expect(c).toMatchObject({ baseUrl: 'http://127.0.0.1:4799', port: 4799, remote: false, thread: 'me' });
    expect(c.token()).toBe('t');
  });
  it('reads the token file on every request, so a rotated token is picked up', () => {
    const files: Record<string, string> = { '/d/api-token': 'one\n' };
    const c = connection({ env: { OMNI_INSTALL_DATA_DIR: '/d', OMNI_INSTALL_PORT: '4800' }, readFile: read(files) });
    expect(c.baseUrl).toBe('http://127.0.0.1:4800');
    expect(c.token()).toBe('one');
    files['/d/api-token'] = 'two';
    expect(c.token()).toBe('two');
    expect(c.tokenSource).toEqual({ kind: 'file', path: '/d/api-token', from: 'the install' });
  });
  it('prefers OMNI_TOKEN_FILE and OMNI_DATA_DIR to the install, and refuses a bad OMNI_URL', () => {
    const c = connection({ env: { OMNI_TOKEN_FILE: '/t', OMNI_DATA_DIR: '/a', OMNI_INSTALL_DATA_DIR: '/b' }, readFile: read({ '/t': 'x' }) });
    expect(c.tokenSource).toMatchObject({ path: '/t' });
    expect(c.dataDir).toBe('/a');
    expect(() => connection({ env: { OMNI_URL: 'box:4747' }, readFile: read({}) })).toThrow(/not an http/);
    expect(connection({ env: { OMNI_URL: 'https://box.tail.ts.net' }, readFile: read({}) }).remote).toBe(true);
  });
});

describe('settle', () => {
  const none = null;
  it('waits while a turn runs, a message waits to start one, or a handoff is on its way', () => {
    expect(settle(detail('thread.json'), none, { baseline: 0, sawBusy: true })).toBeNull();
    const idle = detail('thread-open.json');
    expect(settle({ ...idle, pending: [{ ...wire('thread.json').pending[0], state: 'waiting' }] }, none, { baseline: 0, sawBusy: true })).toBeNull();
    const offered = { ...idle, handoff: { state: { phase: 'offered', stale: false } } };
    expect(settle(offered as never, none, { baseline: 0, sawBusy: true })).toBeNull();
    // A handoff the view still shows after it was declined does not hold the wait.
    expect(settle({ ...offered, handoff: { state: { phase: 'declined', error: 'x' } } } as never, none, { baseline: 0, sawBusy: true })).toBe('done');
  });
  it('ends only on a turn after the start: seen running, a newer result, or a failure', () => {
    const idle = detail('thread-open.json');
    expect(settle(idle, none, { baseline: 156, sawBusy: false })).toBeNull();
    expect(settle(idle, none, { baseline: 155, sawBusy: false })).toBe('done');
    expect(settle({ ...idle, thread: { ...idle.thread, status: 'failed' } }, none, { baseline: 999, sawBusy: false })).toBe('failed');
    expect(settle({ ...idle, thread: { ...idle.thread, status: 'stopped' } }, none, { baseline: 0, sawBusy: true })).toBe('stopped');
  });
  it('needs you for a question at once, and for a failed delegated thread once the turn is over', () => {
    const item = (kind: string) => ({ ...wire('needs-you.json').items[0], blockers: [{ kind, detail: null, count: 1 }] });
    expect(settle(detail('thread.json'), item('question'), { baseline: 0, sawBusy: true })).toBe('needs-you');
    expect(settle(detail('thread.json'), item('child_failed'), { baseline: 0, sawBusy: true })).toBeNull();
    expect(settle(detail('thread-open.json'), item('child_failed'), { baseline: 0, sawBusy: true })).toBe('needs-you');
  });
});
