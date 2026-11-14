import { describe, expect, it } from 'vitest';
import { goalCheck, goalOf, goalReply, goalView, nextGoal, parseGoalCommand, runningLabel } from '../goal.ts';

describe('parseGoalCommand', () => {
  it('reads show, clear and a new condition', () => {
    expect(parseGoalCommand('/goal')).toEqual({ type: 'show' });
    expect(parseGoalCommand('  /goal CLEAR ')).toEqual({ type: 'clear' });
    expect(parseGoalCommand('/goal the suite passes\nand lint is clean')).toEqual({ type: 'set', objective: 'the suite passes\nand lint is clean' });
  });

  it('leaves other text alone', () => {
    expect(parseGoalCommand('/goals')).toBeNull();
    expect(parseGoalCommand('set a /goal')).toBeNull();
  });
});

describe('the CLI\'s goal replies (claude 2.1.316)', () => {
  it('reads a set and a clear as acknowledgements the goal line replaces', () => {
    expect(goalReply('Goal set: the suite passes')).toEqual({ signal: { event: 'set', objective: 'the suite passes' }, ack: true });
    expect(goalReply('Goal cleared: the suite passes')).toEqual({ signal: { event: 'cleared' }, ack: true });
    expect(goalReply('No goal set')).toEqual({ signal: { event: 'cleared' }, ack: true });
  });

  it('keeps the answer to a bare /goal as a reply', () => {
    expect(goalReply('No goal set. Usage: `/goal <condition>`')).toEqual({ signal: { event: 'cleared' }, ack: false });
    expect(goalReply('Goal active: ship it (3 turns)')).toEqual({ signal: { event: 'active', objective: 'ship it', checks: 3 }, ack: false });
    expect(goalReply('Goal active: ship it (not yet evaluated)')?.signal).toEqual({ event: 'active', objective: 'ship it', checks: 0 });
  });

  it('is not fooled by ordinary text', () => {
    expect(goalReply('The goal is met.')).toBeNull();
    expect(goalReply('Goal set: ')).toBeNull();
  });

  it('reads the goal check\'s "not yet"', () => {
    expect(goalCheck('Stop hook feedback:\n[tally.txt has three lines]: Only line 1 has been written.')).toEqual({ event: 'check', objective: 'tally.txt has three lines' });
    expect(goalCheck('Stop hook feedback:\nsomething else')).toBeNull();
  });
});

describe('nextGoal', () => {
  const active = { objective: 'ship it', status: 'active' as const, checks: 1 };
  it('sets, counts checks for the same goal, and clears', () => {
    expect(nextGoal(null, { event: 'set', objective: 'ship it' })).toEqual({ objective: 'ship it', status: 'active', checks: 0 });
    expect(nextGoal(active, { event: 'check', objective: 'ship it' })).toEqual({ ...active, checks: 2 });
    expect(nextGoal(active, { event: 'check', objective: 'other' })).toBeUndefined();
    expect(nextGoal(active, { event: 'cleared' })).toBeNull();
    expect(nextGoal(null, { event: 'cleared' })).toBeUndefined();
  });
});

describe('the goal line', () => {
  const goal = goalOf({ goal_objective: 'ship it', goal_status: 'active', goal_checks: 2 })!;
  it('says what Claude is doing with it', () => {
    expect(goalView(goal, true)).toEqual({ title: 'Pursuing goal · 2 checks', objective: 'ship it', canClear: true });
    expect(goalView({ ...goal, checks: 1 }, false).title).toBe('Goal set · 1 check');
    expect(goalView({ ...goal, status: 'complete', checks: 0 }, false)).toEqual({ title: 'Goal complete', objective: 'ship it', canClear: false });
  });

  it('is absent without an objective, and labels a running thread Goal', () => {
    expect(goalOf({ goal_objective: null })).toBeNull();
    expect(runningLabel({ goal_objective: 'ship it', goal_status: 'active' }, 'Running')).toBe('Goal');
    expect(runningLabel({ goal_objective: 'ship it', goal_status: 'complete' }, 'Running')).toBe('Running');
    expect(runningLabel({}, 'Running')).toBe('Running');
  });
});
