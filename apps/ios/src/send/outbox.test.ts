import { OmniHttpError } from '@omni/client-core';
import { describe, expect, it } from 'vitest';

import type { Staged } from '../attachments/model';
import { beginSend, classifyFailure, EMPTY_OUTBOX, failSend, retrySend, sendKey, settleSend, takeFailed, type Outbox, type SendFailure } from './outbox';

const offline: SendFailure = { kind: 'offline', message: 'offline', ambiguous: true };
const refused: SendFailure = { kind: 'refused', message: 'No', ambiguous: false };

let n = 0;
const newId = () => `id-${++n}`;

function started(text = 'hello', mode?: 'steer' | 'queue'): Outbox {
  const o = beginSend(EMPTY_OUTBOX, text, mode, newId);
  if (!o) throw new Error('did not start');
  return o;
}

describe('beginSend', () => {
  it('puts the trimmed message in the slot under a new id', () => {
    const o = beginSend(EMPTY_OUTBOX, '  hello \n', 'queue', () => 'a');
    expect(o?.item).toEqual({ phase: 'sending', requestId: 'a', key: JSON.stringify(['hello', 'queue', '', '']), text: 'hello', files: [], context: [], mode: 'queue' });
  });

  it('sends nothing for blank text', () => {
    expect(beginSend(EMPTY_OUTBOX, ' \n ', undefined, newId)).toBeNull();
  });

  it('keeps one message out at a time, so order holds', () => {
    const sending = started();
    expect(beginSend(sending, 'second', undefined, newId)).toBeNull();
    const failed = failSend(sending, sending.item!.requestId, offline);
    expect(beginSend(failed, 'second', undefined, newId)).toBeNull();
  });
});

describe('retry without duplicates', () => {
  it('retries a lost answer under the same request id', () => {
    const first = started('ship it');
    const id = first.item!.requestId;
    const failed = failSend(first, id, offline);
    expect(failed.item).toMatchObject({ phase: 'failed', requestId: id, failure: offline });
    const again = retrySend(failed);
    expect(again?.item).toMatchObject({ phase: 'sending', requestId: id, text: 'ship it' });
  });

  it('keeps the id through any number of failures, and spends it once accepted', () => {
    let o = started();
    const id = o.item!.requestId;
    for (let i = 0; i < 3; i++) {
      o = failSend(o, id, offline);
      o = retrySend(o)!;
      expect(o.item?.requestId).toBe(id);
    }
    o = settleSend(o, id);
    expect(o).toEqual(EMPTY_OUTBOX);
  });

  it('keeps the mode it was first sent in', () => {
    const o = beginSend(EMPTY_OUTBOX, 'go', 'steer', () => 'q')!;
    const retried = retrySend(failSend(o, 'q', offline))!;
    expect(retried.item).toMatchObject({ mode: 'steer', requestId: 'q' });
  });

  it('resolves an edited-away ambiguous message to its first id when Ben writes it again', () => {
    const o = beginSend(EMPTY_OUTBOX, 'same words', undefined, () => 'first')!;
    const failed = failSend(o, 'first', offline);
    const { outbox, text } = takeFailed(failed)!;
    expect(text).toBe('same words');
    expect(outbox.item).toBeNull();
    expect(beginSend(outbox, 'same words', undefined, () => 'second')?.item?.requestId).toBe('first');
    expect(beginSend(outbox, 'other words', undefined, () => 'third')?.item?.requestId).toBe('third');
  });

  it('gives a message the server refused a new id when Ben writes it again', () => {
    const o = beginSend(EMPTY_OUTBOX, 'same words', undefined, () => 'first')!;
    const { outbox } = takeFailed(failSend(o, 'first', refused))!;
    expect(beginSend(outbox, 'same words', undefined, () => 'second')?.item?.requestId).toBe('second');
  });

  it('ignores an answer for a send that is no longer the slot', () => {
    const o = started();
    expect(settleSend(o, 'someone-else')).toBe(o);
    expect(failSend(o, 'someone-else', offline)).toBe(o);
  });
});

const photo: Staged = { id: 'p1', uri: 'file:///cache/a.jpg', name: 'a.jpg', type: 'image/jpeg', size: 1000, image: true, source: 'library' };
const doc: Staged = { id: 'd1', uri: 'file:///cache/b.pdf', name: 'b.pdf', type: 'application/pdf', size: 2000, image: false, source: 'files' };

describe('a message with files', () => {
  it('holds its files in the slot and gives them back with its text on Edit', () => {
    const o = beginSend(EMPTY_OUTBOX, 'look', undefined, () => 'a', [photo, doc])!;
    expect(o.item).toMatchObject({ phase: 'sending', files: [photo, doc] });
    const taken = takeFailed(failSend(o, 'a', offline))!;
    expect(taken.text).toBe('look');
    expect(taken.files).toEqual([photo, doc]);
  });

  it('keeps the request id for the same words with the same files, and takes a new one for other files', () => {
    const o = beginSend(EMPTY_OUTBOX, 'look', undefined, () => 'first', [photo])!;
    const { outbox } = takeFailed(failSend(o, 'first', offline))!;
    expect(beginSend(outbox, 'look', undefined, () => 'second', [photo])?.item?.requestId).toBe('first');
    expect(beginSend(outbox, 'look', undefined, () => 'third', [photo, doc])?.item?.requestId).toBe('third');
    expect(beginSend(outbox, 'look', undefined, () => 'fourth')?.item?.requestId).toBe('fourth');
  });

  it('retries with the same files under the same id', () => {
    const o = beginSend(EMPTY_OUTBOX, 'look', undefined, () => 'a', [photo])!;
    const retried = retrySend(failSend(o, 'a', { kind: 'cancelled', message: 'x', ambiguous: true }))!;
    expect(retried.item).toMatchObject({ phase: 'sending', requestId: 'a', files: [photo] });
  });
});

describe('what can be retried', () => {
  it('retries a refused or server-failed message, not one the server signed out', () => {
    const o = started();
    const id = o.item!.requestId;
    expect(retrySend(failSend(o, id, refused))).not.toBeNull();
    expect(retrySend(failSend(o, id, { kind: 'server', message: 'boom', ambiguous: true }))).not.toBeNull();
    expect(retrySend(failSend(o, id, { kind: 'signed-out', message: 'out', ambiguous: false }))).toBeNull();
  });

  it('has nothing to retry or take while a send is out', () => {
    expect(retrySend(started())).toBeNull();
    expect(takeFailed(started())).toBeNull();
    expect(retrySend(EMPTY_OUTBOX)).toBeNull();
  });
});

describe('classifyFailure', () => {
  const http = (status: number, message = `status ${status}`) => new OmniHttpError({ kind: 'http', status, message, body: null, retryAfter: null });

  it.each([
    ['no answer', new OmniHttpError({ kind: 'unreachable', detail: 'Network request failed' }), 'offline', true],
    ['timeout', new OmniHttpError({ kind: 'unreachable', detail: 'timed out' }), 'offline', true],
    ['a 401', http(401), 'signed-out', false],
    ['a cancelled upload', new OmniHttpError({ kind: 'cancelled' }), 'cancelled', true],
    ['a 413', http(413, '<html>Request Entity Too Large</html>'), 'refused', false],
    ['a 415', http(415, 'Unsupported Media Type'), 'refused', false],
    ['a 409', http(409, 'This thread is on your other Mac.'), 'refused', false],
    ['a 400', http(400), 'refused', false],
    ['a 500', http(500, 'database is locked'), 'server', true],
    ['a 502', http(502), 'server', true],
    ['a page that is not JSON', new OmniHttpError({ kind: 'not-json', status: 200, contentType: 'text/html' }), 'server', true],
    ['a redirect', new OmniHttpError({ kind: 'redirect' }), 'server', true],
    ['something else thrown', new Error('Not paired'), 'server', true],
  ] as const)('%s is %s', (_name, error, kind, ambiguous) => {
    expect(classifyFailure(error)).toMatchObject({ kind, ambiguous });
  });

  it("says the server's own words for a refusal and a server error", () => {
    expect(classifyFailure(http(409, 'This thread is on your other Mac.')).message).toBe('This thread is on your other Mac.');
    expect(classifyFailure(http(500, 'database is locked')).message).toBe('database is locked');
  });

  it('tells Ben the message is kept when the server cannot be reached', () => {
    expect(classifyFailure(new OmniHttpError({ kind: 'unreachable', detail: 'x' })).message).toMatch(/kept here/);
  });
});

describe('a message with context', () => {
  const ctx = (id: string) => ({ id, kind: 'diff_selection', v: 1, label: 'a.ts', note: '', body: {} });

  it('goes out with no text when it carries context', () => {
    const o = beginSend(EMPTY_OUTBOX, '  ', undefined, newId, [], [ctx('c1')]);
    expect(o?.item).toMatchObject({ phase: 'sending', text: '', context: [ctx('c1')] });
  });

  it('is a different message from the same words without it, and from other context', () => {
    expect(sendKey('fix', undefined, [], [ctx('c1')])).not.toBe(sendKey('fix', undefined));
    expect(sendKey('fix', undefined, [], [ctx('c1')])).not.toBe(sendKey('fix', undefined, [], [ctx('c2')]));
    expect(sendKey('fix', 'queue')).toBe(JSON.stringify(['fix', 'queue', '', '']));
  });

  it('keeps its context across a retry under the same id', () => {
    const first = beginSend(EMPTY_OUTBOX, 'fix', undefined, () => 'a', [photo], [ctx('c1')])!;
    const failed = failSend(first, 'a', offline);
    expect(retrySend(failed)?.item).toMatchObject({ phase: 'sending', requestId: 'a', context: [ctx('c1')] });
  });
});
