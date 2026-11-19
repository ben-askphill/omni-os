import { describe, expect, it } from 'vitest';
import { BLOCKER_GLYPH, MARK, PHASE, STATUS, blockerGlyph, blockerMark, glyphFor, inboxStatus, markOf, resultGlyph, statusLabel, threadGlyph, threadMark, threadPhase, turnPhase, type Mark } from '../status.ts';

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

  it('moves a mark only while work goes on: a halo for its own turn, a breath while it waits on other work', () => {
    const moving = (Object.keys(MARK) as Mark[]).filter((m) => MARK[m].motion !== 'still');
    expect(moving).toEqual(['starting', 'working', 'tool', 'delegating', 'checking', 'resuming']);
    for (const m of ['starting', 'working', 'tool'] as const) expect(MARK[m].motion).toBe('ping');
    // Nothing that waits on Ben, broke or ended moves.
    for (const m of Object.keys(MARK) as Mark[]) if (['you', 'broken', 'settled', 'quiet'].includes(MARK[m].family)) expect(MARK[m].motion).toBe('still');
  });
});

describe('the mark a thread shows', () => {
  it('keeps each phase as a mark of its own, with the phase\'s name', () => {
    for (const p of Object.keys(PHASE) as (keyof typeof PHASE)[]) expect(MARK[p]).toMatchObject({ ...PHASE[p], glyph: 'running' });
  });

  it('draws a bare glyph as its plain mark, and a phase while it is at work', () => {
    expect(markOf('running')).toBe('working');
    expect(markOf('running', 'tool')).toBe('tool');
    expect(markOf('queued', 'starting')).toBe('starting');
    expect(markOf('done', 'working')).toBe('done');
    expect(markOf('settled')).toBe('stopped');
    for (const g of Object.keys(STATUS) as (keyof typeof STATUS)[]) expect(MARK[markOf(g)].glyph).toBe(g);
  });

  it('names each blocker, in the family of the glyph it already drew', () => {
    expect(blockerMark({ kind: 'question' })).toBe('question');
    expect(blockerMark({ kind: 'question', from: ['kid'] })).toBe('crew_question');
    expect(blockerMark({ kind: 'child_failed' })).toBe('crew_failed');
    expect(blockerMark({ kind: 'setup' })).toBe('setup_failed');
    expect(blockerMark({ kind: 'limited' })).toBe('limited');
    expect(blockerMark({ kind: 'limited', scheduled: true })).toBe('resuming');
    expect(blockerMark({ kind: 'recovered' })).toBe('held');
    expect(blockerMark({ kind: 'uncertain' })).toBe('held');
    for (const kind of Object.keys(BLOCKER_GLYPH) as (keyof typeof BLOCKER_GLYPH)[]) expect(MARK[blockerMark({ kind })].glyph).toBe(BLOCKER_GLYPH[kind]);
  });

  it('reads a thread that waits for a sign-in as waiting on Ben, not as a failed setup', () => {
    expect(blockerMark({ kind: 'setup', signin: true })).toBe('signin');
    expect(blockerGlyph({ kind: 'setup', signin: true })).toBe('needs');
    expect(blockerGlyph({ kind: 'setup' })).toBe('failed');
    expect(MARK.signin).toMatchObject({ label: 'Sign in needed', glyph: 'needs', family: 'you' });
    expect(threadMark({ status: 'stopped', setup: 'signin' })).toBe('signin');
    expect(inboxStatus({ status: 'stopped' }, { blockers: [{ kind: 'setup', signin: true }], result: null })).toEqual({ glyph: 'needs', label: STATUS.needs.label });
  });

  it('puts what holds it up first, then its phase, then how it ended', () => {
    expect(threadMark({ status: 'running' }, { need: { blockers: [{ kind: 'question' }] } })).toBe('question');
    expect(threadMark({ status: 'running' }, { turn: 'tool' })).toBe('tool');
    expect(threadMark({ status: 'done', delegating: true })).toBe('delegating');
    expect(threadMark({ status: 'queued' })).toBe('queued');
    expect(threadMark({ status: 'queued', setup: 'preparing' })).toBe('starting');
    expect(threadMark({ status: 'failed', setup: 'failed' })).toBe('setup_failed');
    expect(threadMark({ status: 'failed', limit_state: 'limited' })).toBe('limited');
    expect(threadMark({ status: 'failed' })).toBe('failed');
    expect(threadMark({ status: 'stopped' })).toBe('stopped');
    expect(threadMark({ status: 'imported' })).toBe('idle');
  });

  it('reads Ready for review only on a finished thread whose pull request is open and not a draft', () => {
    expect(threadMark({ status: 'done' }, { pr: { state: 'OPEN', isDraft: false } })).toBe('review');
    expect(threadMark({ status: 'done' }, { pr: { state: 'OPEN', isDraft: true } })).toBe('done');
    expect(threadMark({ status: 'done' }, { pr: { state: 'MERGED', isDraft: false } })).toBe('done');
    expect(threadMark({ status: 'failed' }, { pr: { state: 'OPEN', isDraft: false } })).toBe('failed');
    expect(threadMark({ status: 'done' })).toBe('done');
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
