import { spawn } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import type { AdapterCallbacks, OutgoingMessage } from '../harness/adapter.ts';
import { detachedSession, processSession } from '../harness/session.ts';
import { waitFor } from './support.ts';

// The two shapes behind HarnessSession report the same lifecycle to the runner.

const msg: OutgoingMessage = { uuid: 'u1', text: 'hi', attachments: [], commands: [] };

function callbacks() {
  const exits: [number | null, NodeJS.Signals | null][] = [];
  const stderr: string[] = [];
  const cb: AdapterCallbacks = {
    record: () => {},
    usage: () => {},
    session: () => {},
    exit: (code, signal) => exits.push([code, signal]),
    stderr: (d) => stderr.push(d),
  };
  return { cb, exits, stderr };
}

describe('processSession', () => {
  it('ends stdin on close and reports the exit once, after the flush', async () => {
    const { cb, exits, stderr } = callbacks();
    const child = spawn('sh', ['-c', 'cat >/dev/null; echo bye >&2'], { stdio: ['pipe', 'pipe', 'pipe'] });
    const order: string[] = [];
    const s = processSession(child, { ...cb, exit: (c, sig) => (order.push('exit'), cb.exit(c, sig)) }, {
      send: () => true,
      interrupt: () => true,
      flush: () => order.push('flush'),
    });
    expect(s.pid).toBe(child.pid);
    expect(s.alive).toBe(true);
    s.end('close');
    await waitFor(() => exits.length === 1, 'exit');
    expect(exits).toEqual([[0, null]]);
    expect(order).toEqual(['flush', 'exit']);
    expect(stderr.join('')).toBe('bye\n');
    expect(s.alive).toBe(false);
  });

  it('signals the process for the other modes', async () => {
    const { cb, exits } = callbacks();
    const s = processSession(spawn('sh', ['-c', 'exec sleep 30'], { stdio: ['pipe', 'pipe', 'pipe'] }), cb, { send: () => true, interrupt: () => true });
    s.end('stop');
    await waitFor(() => exits.length === 1, 'exit');
    expect(exits).toEqual([[null, 'SIGINT']]);
  });
});

describe('detachedSession', () => {
  it('has no process, ends on the first end with the mode as its exit, and takes nothing after', async () => {
    const { cb, exits } = callbacks();
    const ends: string[] = [];
    const sent: OutgoingMessage[] = [];
    const s = detachedSession(cb, { send: (m) => (sent.push(m), true), interrupt: () => true, onEnd: (mode) => ends.push(mode) });
    expect(s.pid).toBeUndefined();
    expect(s.send(msg)).toBe(true);
    s.end('stop');
    s.end('kill');
    // Like a process, the exit comes after the call that ended it.
    expect(exits).toEqual([]);
    await waitFor(() => exits.length === 1, 'exit');
    expect(exits).toEqual([[null, 'SIGINT']]);
    expect(ends).toEqual(['stop']);
    expect(s.alive).toBe(false);
    expect(s.send(msg)).toBe(false);
    expect(s.interrupt('i1')).toBe(false);
    expect(sent).toEqual([msg]);
  });

  it('reports a close as a clean exit', async () => {
    const { cb, exits } = callbacks();
    detachedSession(cb, { send: () => true, interrupt: () => true }).end('close');
    await waitFor(() => exits.length === 1, 'exit');
    expect(exits).toEqual([[0, null]]);
  });
});
