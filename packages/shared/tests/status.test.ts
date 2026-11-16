import { describe, expect, it } from 'vitest';
import { PHASE, STATUS, glyphFor, inboxStatus, resultGlyph, statusLabel, threadGlyph, threadPhase, turnPhase, waitsElsewhere } from '../status.ts';

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

const row = (kind: string, payload: unknown = {}) => ({ kind, payload: JSON.stringify(payload) });

describe('the phase a working thread shows', () => {
  it('names every phase for the dot\'s tooltip', () => {
    expect(Object.values(PHASE).map((p) => p.label)).toEqual(['Starting', 'Running', 'Running a tool', 'Waiting on crew', 'Checks running']);
    for (const p of Object.values(PHASE)) expect(p.hint).not.toBe('');
  });

  it('reads Starting while the folder is prepared, queued or running', () => {
    expect(threadPhase({ status: 'queued', setup: 'preparing' })).toBe('starting');
    expect(threadPhase({ status: 'running', setup: 'preparing' })).toBe('starting');
    // A failed setup is not at work, and a stopped thread whose setup row was left behind is not either.
    expect(threadPhase({ status: 'failed', setup: 'failed' })).toBeNull();
    expect(threadPhase({ status: 'stopped', setup: 'preparing' })).toBeNull();
  });

  it('reads its own turn first, then the crew it waits on', () => {
    expect(threadPhase({ status: 'running' })).toBe('working');
    expect(threadPhase({ status: 'running', delegating: true })).toBe('working');
    expect(threadPhase({ status: 'done', delegating: true })).toBe('delegating');
    expect(threadPhase({ status: 'running' }, 'tool')).toBe('tool');
    // The turn's phase belongs to a running turn only.
    expect(threadPhase({ status: 'done', delegating: true }, 'tool')).toBe('delegating');
  });

  it('has no phase for a thread that is not at work', () => {
    for (const status of ['queued', 'done', 'failed', 'stopped', 'imported']) expect(threadPhase({ status })).toBeNull();
    expect(threadPhase({ status: 'queued', delegating: true })).toBeNull();
  });

  it('pulses slower for the phases that wait on something else', () => {
    expect((['starting', 'working', 'tool', 'delegating', 'checking'] as const).filter(waitsElsewhere)).toEqual(['starting', 'delegating', 'checking']);
  });
});

describe('the phase of a running turn, from its rows', () => {
  it('is starting until the harness takes the message', () => {
    expect(turnPhase([])).toBe('starting');
    expect(turnPhase([row('user'), row('assistant_text'), row('result')])).toBe('starting');
    // A status or an init alone says the process is up, not that it read the message.
    expect(turnPhase([row('result'), row('init'), row('status', { text: 'Compacting' })])).toBe('starting');
  });

  it('is working once the message is replayed or anything is said', () => {
    expect(turnPhase([row('result'), row('user')])).toBe('working');
    expect(turnPhase([row('user'), row('assistant_text', { text: 'On it' })])).toBe('working');
  });

  it('is a tool while a call has no result, and working again once it returns', () => {
    const call = row('tool_use', { id: 'a', name: 'Bash' });
    expect(turnPhase([row('user'), call])).toBe('tool');
    expect(turnPhase([row('user'), call, row('tool_result', { tool_use_id: 'a' })])).toBe('working');
    expect(turnPhase([row('user'), call, row('tool_result', { tool_use_id: 'a' }), row('tool_use', { id: 'b' })])).toBe('tool');
  });

  it('does not read a call the last turn left open', () => {
    expect(turnPhase([row('user'), row('tool_use', { id: 'old' }), row('result'), row('user')])).toBe('working');
  });

  it('skips a row it cannot read', () => {
    expect(turnPhase([row('user'), { kind: 'tool_use', payload: '{' }])).toBe('working');
  });
});
