import { describe, expect, it } from 'vitest';

import { linkLabel, linkOf } from '../src/live/connection';
import type { SSEState } from '@omni/client-core';

const open: SSEState = { kind: 'open' };

describe('linkOf', () => {
  it('is unpaired without a server, whatever the streams say', () => {
    expect(linkOf({ paired: false, foreground: true, feed: open, thread: open })).toEqual({ kind: 'unpaired' });
  });

  it('is paused while the app is in the background', () => {
    expect(linkOf({ paired: true, foreground: false, feed: open, thread: null })).toEqual({ kind: 'paused' });
  });

  it('is live once the feed and the open thread are both open', () => {
    expect(linkOf({ paired: true, foreground: true, feed: open, thread: open })).toEqual({ kind: 'live' });
    expect(linkOf({ paired: true, foreground: true, feed: open, thread: null })).toEqual({ kind: 'live' });
  });

  it('is connecting until the feed has opened', () => {
    expect(linkOf({ paired: true, foreground: true, feed: null, thread: null })).toEqual({ kind: 'connecting' });
    expect(linkOf({ paired: true, foreground: true, feed: { kind: 'connecting' }, thread: open })).toEqual({ kind: 'connecting' });
  });

  it('reports the highest retry attempt among the streams', () => {
    const feed: SSEState = { kind: 'reconnecting', attempt: 1, delayMs: 1000 };
    const thread: SSEState = { kind: 'reconnecting', attempt: 3, delayMs: 4000 };
    expect(linkOf({ paired: true, foreground: true, feed, thread })).toEqual({ kind: 'reconnecting', attempt: 3 });
  });

  it('lets a refused credential outrank a retry', () => {
    const feed: SSEState = { kind: 'reconnecting', attempt: 4, delayMs: 15000 };
    expect(linkOf({ paired: true, foreground: true, feed, thread: { kind: 'unauthorized' } })).toEqual({ kind: 'signed-out' });
  });

  it('ignores a closed stream', () => {
    expect(linkOf({ paired: true, foreground: true, feed: open, thread: { kind: 'closed' } })).toEqual({ kind: 'live' });
  });
});

describe('linkLabel', () => {
  it('says Reconnecting on the first retry and Offline, retrying from the second', () => {
    expect(linkLabel({ kind: 'reconnecting', attempt: 1 })).toEqual({ text: 'Reconnecting', tone: 'muted' });
    expect(linkLabel({ kind: 'reconnecting', attempt: 2 })).toEqual({ text: 'Offline, retrying', tone: 'warn' });
  });

  it('marks only live as ok and a refused credential as needing the user', () => {
    expect(linkLabel({ kind: 'live' }).tone).toBe('ok');
    expect(linkLabel({ kind: 'signed-out' })).toEqual({ text: 'Sign in again', tone: 'warn' });
    expect(linkLabel({ kind: 'paused' }).tone).toBe('muted');
  });
});
