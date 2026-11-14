import { describe, expect, it } from 'vitest';
import { startRunner } from './runner-boot.ts';

// Claude Code's `/goal`: the thread row follows the goal from the CLI's stream, and the goal line replaces the CLI's
// own acknowledgements in the transcript.

const r = await startRunner();
const goal = (id: string) => {
  const t = r.thread(id);
  return { objective: t.goal_objective, status: t.goal_status, checks: t.goal_checks };
};

describe('a /goal on a Claude Code thread', () => {
  it('is pursued, counts each unmet check, and is complete once the turn ends', async () => {
    const t = await r.start('/goal the suite passes CHECKS:2');
    await r.untilResults(t.id, 1);
    expect(goal(t.id)).toEqual({ objective: 'the suite passes CHECKS:2', status: 'complete', checks: 2 });
    // The goal line says "Goal set", so the CLI's own "Goal set: …" is not a reply too.
    expect(r.texts(t.id, 'assistant_text').some((x) => x.startsWith('Goal set:'))).toBe(false);
  });

  it('shows active while a turn works toward it, and a stop leaves it active', async () => {
    const t = await r.start('/goal the file exists TOOL:5000');
    await r.until('goal set', () => r.thread(t.id).goal_status === 'active');
    expect(r.thread(t.id).status).toBe('running');
    await r.runner.interruptThread(t.id);
    await r.untilResults(t.id, 1);
    expect(goal(t.id)).toMatchObject({ objective: 'the file exists TOOL:5000', status: 'active' });
  });

  it('goes away with /goal clear, which adds no reply of its own', async () => {
    const t = await r.start('/goal the docs are current TOOL:5000');
    await r.until('goal set', () => r.thread(t.id).goal_status === 'active');
    await r.runner.interruptThread(t.id);
    await r.untilResults(t.id, 1);
    const replies = r.texts(t.id, 'assistant_text').length;
    await r.runner.postMessage(t.id, '/goal clear');
    await r.untilResults(t.id, 2);
    expect(goal(t.id)).toEqual({ objective: null, status: null, checks: 0 });
    expect(r.texts(t.id, 'assistant_text')).toHaveLength(replies);
  });

  it('drops a met goal when the next message reaches the session', async () => {
    const t = await r.start('/goal the build is green');
    await r.untilResults(t.id, 1);
    expect(r.thread(t.id).goal_status).toBe('complete');
    await r.runner.postMessage(t.id, 'thanks');
    await r.untilResults(t.id, 2);
    expect(goal(t.id)).toEqual({ objective: null, status: null, checks: 0 });
  });

  it('is replaced by a new /goal', async () => {
    const t = await r.start('/goal first TOOL:5000');
    await r.until('goal set', () => r.thread(t.id).goal_status === 'active');
    await r.runner.interruptThread(t.id);
    await r.untilResults(t.id, 1);
    await r.runner.postMessage(t.id, '/goal second');
    await r.untilResults(t.id, 2);
    expect(goal(t.id)).toEqual({ objective: 'second', status: 'complete', checks: 0 });
  });

  it('never steers into a running turn: Clear stops the turn and runs as its own', async () => {
    const t = await r.start('/goal the docs are current TOOL:5000');
    await r.until('goal set', () => r.thread(t.id).goal_status === 'active');
    await r.runner.postMessage(t.id, '/goal clear');
    await r.untilResults(t.id, 2, 4000);
    expect(r.byKind(t.id, 'result')[0].p.stopped).toBe(true);
    expect(goal(t.id)).toEqual({ objective: null, status: null, checks: 0 });
    // It reached the CLI as a message of its own, so the CLI ran it as a command.
    expect(r.claudeTexts(t.id).at(-1)).toBe('/goal clear');
  });

  it('lets a running turn finish before a bare /goal', async () => {
    const t = await r.start('hello TOOL:300');
    await r.untilTool(t.id);
    await r.runner.postMessage(t.id, '/goal');
    await r.untilResults(t.id, 2);
    expect(r.byKind(t.id, 'result')[0].p.stopped).toBeUndefined();
    expect(r.texts(t.id, 'assistant_text').at(-1)).toBe('No goal set. Usage: `/goal <condition>`');
  });

  it('is gone when the thread moves to a new session', async () => {
    const t = await r.start('/goal anything');
    await r.untilResults(t.id, 1);
    r.db.threads.update(t.id, { session_id: '00000000-0000-4000-8000-000000000001' });
    expect(goal(t.id)).toEqual({ objective: null, status: null, checks: 0 });
  });

  it('keeps the goal when the session stays the same', async () => {
    const t = await r.start('/goal anything');
    await r.untilResults(t.id, 1);
    r.db.threads.update(t.id, { session_id: r.thread(t.id).session_id, title: 'Renamed' });
    expect(goal(t.id).objective).toBe('anything');
  });
});
