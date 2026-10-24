import { describe, expect, it } from 'vitest';
import type { RunName } from '@omni/shared/run-switch.ts';
import { CURSOR_CLOUD_REFUSAL, HERMES_REFUSAL, planSwitch, type RunState } from '../runner/switch-plan.ts';

const opus: RunName = { harness: 'claude-code', model: 'opus', effort: 'high', harnessName: 'Claude Code', modelLabel: 'Opus' };
const gpt = { harness: 'codex', model: 'gpt-5.6-sol', effort: '' };
const claude = { harness: 'claude-code', model: 'opus', effort: 'high' };

const ran = (over: Partial<RunState> = {}): RunState => ({ ...claude, id: 'thread-1', has_run: 1, session_id: 'claude-1', sessions: {}, handover: null, ...over });
/** Content (messages, replies, tool calls) at these event ids. */
const content = (...ids: number[]) => (after: number) => ids.some((id) => id > after);

describe('planSwitch', () => {
  it('changes nothing for the same run', () => {
    expect(planSwitch(ran(), claude, opus, 10, content())).toEqual({ kind: 'none' });
  });

  it('keeps the session and any pending handover on the same harness', () => {
    const handover = { from: opus, since: 0 };
    expect(planSwitch(ran({ effort: 'low' }), claude, opus, 10, content())).toEqual({ kind: 'settings', session_id: 'claude-1', sessions: {}, handover: null });
    const pending = ran({ ...gpt, session_id: 't1', handover });
    expect(planSwitch(pending, { ...gpt, model: 'gpt-6-astra' }, opus, 10, content())).toMatchObject({ kind: 'settings', handover });
  });

  it('treats a thread that never ran as settings on any harness, with no session yet', () => {
    // Codex noted its session before its first turn failed: Claude must not take that id.
    const failed = ran({ ...gpt, has_run: 0, session_id: 'th_9' });
    expect(planSwitch(failed, claude, opus, 3, content(1))).toEqual({ kind: 'settings', session_id: 'thread-1', sessions: {}, handover: null });
  });

  it('refuses moving to or from Hermes, but not a model change on Hermes', () => {
    expect(planSwitch(ran(), { harness: 'hermes', model: '', effort: '' }, opus, 10, content())).toEqual({ kind: 'reject', error: HERMES_REFUSAL });
    expect(planSwitch(ran({ harness: 'hermes', model: '', effort: '' }), claude, opus, 10, content())).toMatchObject({ kind: 'reject' });
    expect(planSwitch(ran({ harness: 'hermes', model: '', effort: '' }), { harness: 'hermes', model: 'x', effort: '' }, opus, 10, content())).toMatchObject({ kind: 'settings' });
  });

  it('refuses moving to or from Cursor Cloud, and a model change on it', () => {
    const cloud = { harness: 'cursor-cloud', model: 'default', effort: '' } as const;
    expect(planSwitch(ran(), cloud, opus, 10, content())).toEqual({ kind: 'reject', error: CURSOR_CLOUD_REFUSAL });
    expect(planSwitch(ran(cloud), claude, opus, 10, content())).toEqual({ kind: 'reject', error: CURSOR_CLOUD_REFUSAL });
    expect(planSwitch(ran(cloud), { ...cloud, model: 'composer-2' }, opus, 10, content())).toEqual({ kind: 'reject', error: CURSOR_CLOUD_REFUSAL });
    expect(planSwitch(ran(cloud), cloud, opus, 10, content())).toEqual({ kind: 'none' });
  });

  it('hands a thread to a harness it never ran on with the whole thread, keeping the session it leaves', () => {
    expect(planSwitch(ran(), gpt, opus, 10, content(2, 9))).toEqual({
      kind: 'handover',
      session_id: 'claude-1',
      sessions: { 'claude-code': { id: 'claude-1', seen: 10 } },
      handover: { from: opus, since: 0 },
    });
  });

  it("switching back after the other harness ran resumes Claude's old session with what it missed", () => {
    const onCodex = ran({ ...gpt, session_id: 'th_1', sessions: { 'claude-code': { id: 'claude-1', seen: 10 } } });
    const codexName: RunName = { ...gpt, harnessName: 'Codex', modelLabel: 'GPT-5.6 Sol' };
    expect(planSwitch(onCodex, claude, codexName, 20, content(12, 15))).toEqual({
      kind: 'handover',
      session_id: 'claude-1',
      sessions: { codex: { id: 'th_1', seen: 20 } },
      handover: { from: codexName, since: 10 },
    });
  });

  it('goes back to the session a pending handover came from when nothing ran since', () => {
    const pending = ran({ ...gpt, session_id: 'claude-1', sessions: { 'claude-code': { id: 'claude-1', seen: 10 } }, handover: { from: opus, since: 0 } });
    // Only the switch row (id 11) came after: no content.
    expect(planSwitch(pending, claude, opus, 11, content(2, 9))).toEqual({ kind: 'back', session_id: 'claude-1', sessions: {}, handover: null });
  });

  it('keeps where a handover came from when it is passed on before it ran', () => {
    const pending = ran({ ...gpt, session_id: 'claude-1', sessions: { 'claude-code': { id: 'claude-1', seen: 10 } }, handover: { from: opus, since: 0 } });
    const cursor = { harness: 'cursor', model: 'composer-2', effort: '' };
    const codexName: RunName = { ...gpt, harnessName: 'Codex', modelLabel: 'GPT-5.6 Sol' };
    expect(planSwitch(pending, cursor, codexName, 11, content(2, 9))).toEqual({
      kind: 'handover',
      session_id: 'claude-1',
      sessions: { 'claude-code': { id: 'claude-1', seen: 10 } },
      handover: { from: opus, since: 0 },
    });
  });

  it('keeps a resumed session whose catch-up is still pending, at what it had seen', () => {
    const codexName: RunName = { ...gpt, harnessName: 'Codex', modelLabel: 'GPT-5.6 Sol' };
    const pending = ran({ session_id: 'claude-1', sessions: { codex: { id: 'th_1', seen: 20 } }, handover: { from: codexName, since: 10 } });
    // Back to Codex before Claude caught up: Codex has missed nothing, and Claude keeps its old place.
    expect(planSwitch(pending, gpt, opus, 21, content(12, 15))).toEqual({
      kind: 'back',
      session_id: 'th_1',
      sessions: { 'claude-code': { id: 'claude-1', seen: 10 } },
      handover: null,
    });
  });
});
