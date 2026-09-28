import { describe, expect, it } from 'vitest';
import { SseParser } from '../server/harness/hermes/sse.ts';

describe('Hermes SSE parser', () => {
  it('skips comment lines and emits id plus data', () => {
    const p = new SseParser();
    const ev = p.push(': open\nid: 3\ndata: {"event":"run.started"}\n\n: keepalive\n\n');
    expect(ev).toEqual([{ id: '3', data: '{"event":"run.started"}' }]);
  });

  it('joins a line split across chunks, including a CRLF split after the CR', () => {
    const p = new SseParser();
    expect(p.push('data: {"a":')).toEqual([]);
    expect(p.push('1}\r\n\r')).toEqual([]);
    expect(p.push('\ndata: {"b":2}\n\n')).toEqual([
      { data: '{"a":1}' },
      { data: '{"b":2}' },
    ]);
  });

  it('flushes an event that the stream ended without a blank line', () => {
    const p = new SseParser();
    expect(p.push('id: 1\ndata: {"event":"run.completed"}')).toEqual([]);
    expect(p.flush()).toEqual([{ id: '1', data: '{"event":"run.completed"}' }]);
    expect(p.flush()).toEqual([]);
  });

  it('keeps multi-line data together', () => {
    const p = new SseParser();
    expect(p.push('data: one\ndata: two\n\n')).toEqual([{ data: 'one\ntwo' }]);
  });
});
