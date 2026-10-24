import { describe, expect, it } from 'vitest';
import { OUTPUT_LIMIT, type ActionRun, type ChannelAction, type ThreadActions } from '@omni/shared/channel-actions.ts';
import { actionInput, draftOf, liveRun, outputCut, parseSecrets, runSummary, shouldPoll, withRun } from '../src/channel-actions.ts';

// The thread Actions tab and the channel settings editor (apps/web/src/channel-actions.ts) on GET /threads/:id/actions.

const action = (over: Partial<ChannelAction> = {}): ChannelAction => ({
  id: 'a1',
  channel_id: 'acme',
  name: 'Theme preview',
  command: 'shopify theme dev --port $OMNI_PORT',
  secrets: [],
  port: 0,
  position: 0,
  created_at: '2026-01-05T09:00:00.000Z',
  updated_at: '2026-01-05T09:00:00.000Z',
  ...over,
});

const run = (over: Partial<ActionRun> = {}): ActionRun => ({
  id: 'r1',
  thread_id: 't1',
  action_id: 'a1',
  name: 'Theme preview',
  command: 'shopify theme dev --port $OMNI_PORT',
  cwd: '/tmp/acme',
  port: null,
  state: 'succeeded',
  exit_code: 0,
  error: null,
  output: 'ok\n',
  output_bytes: 3,
  started_at: '2026-01-05T09:00:00.000Z',
  ended_at: '2026-01-05T09:00:12.000Z',
  ...over,
});

const thread = (runs: ActionRun[]): ThreadActions => ({ actions: [action()], runs, blocked: null });

describe('polling', () => {
  it('polls only while a run is running and the tab is visible', () => {
    expect(shouldPoll(undefined, true)).toBe(false);
    expect(shouldPoll(thread([run()]), true)).toBe(false);
    expect(shouldPoll(thread([run({ state: 'running', ended_at: null })]), true)).toBe(true);
    expect(shouldPoll(thread([run({ state: 'running', ended_at: null })]), false)).toBe(false);
  });
});

describe('run rows', () => {
  it('says the port, how long it ran and the exit code', () => {
    expect(runSummary(run({ port: 9301, state: 'failed', exit_code: 1 }))).toBe('Port 9301 · 12s · exit 1');
    expect(runSummary(run())).toBe('12s · exit 0');
    expect(runSummary(run({ state: 'stopped', exit_code: null, ended_at: '2026-01-05T09:01:30.000Z' }))).toBe('1m 30s');
  });

  it('counts a running run up to now', () => {
    const now = Date.parse('2026-01-05T09:00:05.000Z');
    expect(runSummary(run({ state: 'running', exit_code: null, ended_at: null, port: 4799 }), now)).toBe('Port 4799 · 5s');
  });

  it('finds the run of an action still going, newest first', () => {
    const data = thread([run({ id: 'r3', state: 'running', ended_at: null }), run({ id: 'r2', state: 'running', ended_at: null }), run()]);
    expect(liveRun(data, action())?.id).toBe('r3');
    expect(liveRun(thread([run()]), action())).toBeUndefined();
    expect(liveRun(data, action({ id: 'other' }))).toBeUndefined();
  });
});

describe('output', () => {
  it('says the start was cut only when the kept tail is at the limit', () => {
    const full = 'x'.repeat(OUTPUT_LIMIT);
    expect(outputCut(run({ output: full, output_bytes: 200_000 }))).toBe('Showing the last 64 KB of 195 KB');
    expect(outputCut(run({ output: full, output_bytes: OUTPUT_LIMIT }))).toBeNull();
    // Colour codes count in the bytes but are gone from the text: nothing was cut.
    expect(outputCut(run({ output: 'ok\n', output_bytes: 40 }))).toBeNull();
  });
});

describe('answers to Run, Stop and Retry', () => {
  it('puts a new run on top and replaces a known one in place', () => {
    const data = thread([run({ id: 'r1' }), run({ id: 'r0' })]);
    expect(withRun(data, run({ id: 'r2', state: 'running' })).runs.map((r) => r.id)).toEqual(['r2', 'r1', 'r0']);
    const stopped = withRun(data, run({ id: 'r0', state: 'stopped' }));
    expect(stopped.runs.map((r) => [r.id, r.state])).toEqual([
      ['r1', 'succeeded'],
      ['r0', 'stopped'],
    ]);
  });
});

describe('the settings editor', () => {
  it('reads an action into the form and back', () => {
    expect(draftOf()).toEqual({ name: '', command: '', secrets: '', portMode: 'none', port: '' });
    expect(draftOf(action({ port: null }))).toMatchObject({ portMode: 'none', port: '' });
    expect(draftOf(action({ port: 0 }))).toMatchObject({ portMode: 'free', port: '' });
    const fixed = action({ port: 9292, secrets: ['SHOPIFY_CLI_THEME_TOKEN', 'API_KEY'] });
    expect(draftOf(fixed)).toMatchObject({ portMode: 'fixed', port: '9292', secrets: 'SHOPIFY_CLI_THEME_TOKEN, API_KEY' });
    expect(actionInput(draftOf(fixed))).toEqual({
      input: { name: 'Theme preview', command: 'shopify theme dev --port $OMNI_PORT', secrets: ['SHOPIFY_CLI_THEME_TOKEN', 'API_KEY'], port: 9292 },
    });
  });

  it('splits secret names on commas and spaces, upper-cased, each once', () => {
    expect(parseSecrets(' api_key, SHOPIFY_TOKEN  api_key,,\nOTHER ')).toEqual(['API_KEY', 'SHOPIFY_TOKEN', 'OTHER']);
    expect(parseSecrets('')).toEqual([]);
  });

  it('sends the port mode as null, 0 or the number', () => {
    const base = { name: ' Tests ', command: ' npm test ', secrets: '', port: '9292' };
    expect(actionInput({ ...base, portMode: 'none' })).toEqual({ input: { name: 'Tests', command: 'npm test', secrets: [], port: null } });
    expect(actionInput({ ...base, portMode: 'free' })).toMatchObject({ input: { port: 0 } });
    expect(actionInput({ ...base, portMode: 'fixed' })).toMatchObject({ input: { port: 9292 } });
  });

  it('refuses a fixed port with no number rather than sending 0', () => {
    expect(actionInput({ name: 'Preview', command: 'x', secrets: '', portMode: 'fixed', port: '' })).toEqual({ error: 'Give the fixed port a number, like 9292.' });
    expect(actionInput({ name: 'Preview', command: 'x', secrets: '', portMode: 'fixed', port: '0' })).toHaveProperty('error');
  });
});
