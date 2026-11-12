import { describe, expect, it } from 'vitest';
import { STATUS, glyphFor, inboxStatus, resultGlyph, statusLabel, threadGlyph } from '../status.ts';

describe('status', () => {
  it('has one label for each state a person reads', () => {
    expect(['running', 'needs', 'limited', 'failed', 'done'].map((s) => STATUS[glyphFor(s)].label)).toEqual(['Running', 'Needs you', 'Limited', 'Failed', 'Done']);
  });

  it('draws a failure as failed, not as needs you', () => {
    expect(glyphFor('failed')).toBe('failed');
    expect(statusLabel('stopped')).toBe('Stopped');
    expect(glyphFor('imported')).toBe('idle');
  });

  it('reads a turn stopped at its usage limit as Limited', () => {
    expect(threadGlyph({ status: 'failed', limit_state: 'limited' })).toBe('limited');
    expect(threadGlyph({ status: 'failed', limit_state: 'scheduled' })).toBe('limited');
    expect(threadGlyph({ status: 'failed', limit_state: null })).toBe('failed');
    expect(threadGlyph({ status: 'running', limit_state: 'limited' })).toBe('running');
  });

  it('reads a thread waiting on what it delegated as running, and queued as queued', () => {
    expect(threadGlyph({ status: 'done', delegating: true })).toBe('running');
    expect(threadGlyph({ status: 'queued', delegating: true })).toBe('queued');
  });

  it('reads how a turn ended: a stopped turn is Stopped, a failed one Failed, else Done', () => {
    expect(['stopped', 'failed', 'done'].map((r) => STATUS[resultGlyph(r)].label)).toEqual(['Stopped', 'Failed', 'Done']);
  });
});

describe('inboxStatus', () => {
  const result = (status: string) => ({ blockers: [], result: { status } });

  it('says Stopped on a stopped thread, whatever its turn left running', () => {
    expect(inboxStatus({ status: 'stopped' }, result('stopped'))).toEqual({ glyph: 'settled', label: 'Stopped' });
    expect(inboxStatus({ status: 'stopped' }, null)).toBeNull();
  });

  it('puts what holds a thread up before its turn, then its turn before an unread result', () => {
    expect(inboxStatus({ status: 'running' }, { blockers: [{ kind: 'question' }], result: null })).toEqual({ glyph: 'needs', label: 'Needs you' });
    expect(inboxStatus({ status: 'failed' }, { blockers: [{ kind: 'limited' }], result: { status: 'failed' } })).toEqual({ glyph: 'limited', label: 'Limited' });
    expect(inboxStatus({ status: 'running' }, result('stopped'))).toEqual({ glyph: 'running', label: 'Running' });
    expect(inboxStatus({ status: 'queued', delegating: true })).toEqual({ glyph: 'queued', label: 'Queued' });
    expect(inboxStatus({ status: 'failed' }, result('failed'))).toEqual({ glyph: 'failed', label: 'Failed' });
    expect(inboxStatus({ status: 'done' }, result('done'))).toEqual({ glyph: 'done', label: 'Done' });
  });

  it("says what Home's dot says about the same thread", () => {
    // A thread as the server sends it, with the Needs you item that comes with it: a turn's result is its own status.
    const pairs = [
      [{ status: 'running' }, null],
      [{ status: 'queued' }, null],
      [{ status: 'stopped' }, result('stopped')],
      [{ status: 'failed' }, result('failed')],
      [{ status: 'done' }, result('done')],
      [{ status: 'stopped', delegating: true }, result('stopped')],
      [{ status: 'failed', limit_state: 'limited' }, { blockers: [{ kind: 'limited' as const }], result: { status: 'failed' } }],
    ] as const;
    for (const [t, need] of pairs) expect(inboxStatus(t, need)?.glyph).toBe(threadGlyph(t));
  });
});
