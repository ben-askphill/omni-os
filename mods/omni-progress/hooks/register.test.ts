import type { On } from 'claude-code';
import { expect, mock, test } from 'claude-code/testing';

/** Records what the mod shows; the test's ui hooks stand for the engine beneath it. */
function screen(on: On) {
  const statuses: (string | undefined)[] = [];
  const toasts: string[] = [];
  const logs: string[] = [];
  on('ui.status', ($, e) => (statuses.push(e.text), { value: undefined }));
  on('ui.toast', ($, e) => (toasts.push(e.text), { value: undefined }));
  on('ui.log', ($, e) => (logs.push(e.text), { value: undefined }));
  // The turn and session events, answered as core echoes them.
  on('turn.start', ($, e) => ({ turnId: e.turnId }));
  on('turn.complete', ($, e) => ({ text: e.answer }));
  on('session.start', ($, e) => ({ cwd: e.cwd }));
  return { statuses, toasts, logs };
}

const complete = { answer: 'ok', isAborted: false, turnId: 't1', reason: 'answer' } as const;

test('status names the running call, counts tools and times the turn, then summarizes', async ($, on) => {
  const clock = mock.clock(on);
  const ui = screen(on);
  let seenWhileRunning: string | undefined;
  on('tool.call', ($, e) => {
    seenWhileRunning = ui.statuses.at(-1);
    return { result: 'fine' };
  });

  await $.turn.start({ text: 'go', turnId: 't1' });
  expect(ui.statuses.at(-1)).toBeUndefined();
  await $.tool.call({ tool: 'Read', file_path: '/repo/src/a.ts' });
  await clock.advance(130_000);
  await $.tool.call({ tool: 'Edit', file_path: '/repo/src/foo.ts', old_string: 'a', new_string: 'b' });

  expect(seenWhileRunning).toBe('Edit: src/foo.ts · 2 tools · 2m 10s');
  expect(ui.statuses.at(-1)).toBe('Working · 2 tools · 2m 10s');

  await $.turn.complete({ ...complete, durationMs: 135_000 });
  expect(ui.statuses.at(-1)).toBe('Done · 2 tools · 2m 15s');
});

test('a call past the slow threshold warns once, by toast and log', async ($, on) => {
  const clock = mock.clock(on);
  const ui = screen(on);
  on('tool.call', async () => {
    await clock.sleep(7 * 60_000);
    return { result: 'late' };
  });

  await $.session.start({ cwd: '/repo', surface: null, isInteractive: false });
  await $.turn.start({ text: 'go', turnId: 't1' });
  const call = $.tool.call({ tool: 'WebFetch', url: 'https://example.com/slow', prompt: 'read it' });

  await clock.advance(4 * 60_000);
  expect(ui.toasts).toEqual([]);
  await clock.advance(90_000);
  expect(ui.toasts).toEqual(['omni-progress: WebFetch: https://example.com/slow has run 5m 0s']);
  expect(ui.logs).toEqual(ui.toasts);

  await clock.advance(90_000);
  await call;
  expect(ui.toasts).toHaveLength(1);
});

test('the slow threshold comes from userConfig', { options: { slowCallMinutes: 1 } }, async ($, on) => {
  const clock = mock.clock(on);
  const ui = screen(on);
  on('tool.call', async () => {
    await clock.sleep(2 * 60_000);
    return { result: 'late' };
  });

  await $.session.start({ cwd: '/repo', surface: null, isInteractive: false });
  const call = $.tool.call({ tool: 'Read', file_path: '/repo/big.log' });
  await clock.advance(75_000);
  expect(ui.toasts).toEqual(['omni-progress: Read: /repo/big.log has run 1m 0s']);
  await clock.advance(60_000);
  await call;
});

test('the same call failing three times in a row warns once', async ($, on) => {
  mock.clock(on);
  const ui = screen(on);
  on('tool.call', () => ({ result: 'String to replace not found', isError: true }));
  const edit = { tool: 'Edit', file_path: '/repo/x.ts', old_string: 'nope', new_string: 'yes' } as const;

  await $.turn.start({ text: 'go', turnId: 't1' });
  await $.tool.call(edit);
  await $.tool.call(edit);
  expect(ui.toasts).toEqual([]);
  await $.tool.call(edit);
  expect(ui.toasts).toEqual(['omni-progress: Edit: /repo/x.ts failed 3 times in a row with the same input']);
  expect(ui.logs).toEqual(ui.toasts);
  expect(ui.statuses.at(-1)).toBe('Working · 3 tools · 3 failed · 0s');

  await $.tool.call(edit);
  expect(ui.toasts).toHaveLength(1);
});

test('a different input or a success breaks the failure streak', async ($, on) => {
  mock.clock(on);
  const ui = screen(on);
  on('tool.call', (_, e) => (e.tool === 'Read' && e.file_path === '/ok' ? { result: 'fine' } : { result: 'missing', isError: true }));

  await $.tool.call({ tool: 'Read', file_path: '/a' });
  await $.tool.call({ tool: 'Read', file_path: '/a' });
  await $.tool.call({ tool: 'Read', file_path: '/b' });
  await $.tool.call({ tool: 'Read', file_path: '/b' });
  await $.tool.call({ tool: 'Read', file_path: '/ok' });
  await $.tool.call({ tool: 'Read', file_path: '/b' });
  expect(ui.toasts).toEqual([]);
});

test('the result passes through unchanged, errors included', async ($, on) => {
  mock.clock(on);
  screen(on);
  on('tool.call', () => ({ result: 'nope', isError: true }));
  const ran = await $.tool.call({ tool: 'Write', file_path: '/repo/y.ts', content: 'x' });
  expect(ran).toEqual({ result: 'nope', isError: true });
});

test('Bash is not observed by default', async ($, on) => {
  mock.clock(on);
  const ui = screen(on);
  on('tool.call', () => ({ result: 'boom', isError: true }));
  for (let i = 0; i < 3; i++) await $.tool.call({ tool: 'Bash', command: 'npm test' });
  expect(ui.statuses).toEqual([]);
  expect(ui.toasts).toEqual([]);
});

test('watchBash turns Bash observation on', { options: { watchBash: true } }, async ($, on) => {
  mock.clock(on);
  const ui = screen(on);
  on('tool.call', () => ({ result: 'boom', isError: true }));
  for (let i = 0; i < 3; i++) await $.tool.call({ tool: 'Bash', command: 'npm test' });
  expect(ui.statuses.at(-1)).toBe('Working · 3 tools · 3 failed · 0s');
  expect(ui.toasts).toEqual(['omni-progress: Bash: npm test failed 3 times in a row with the same input']);
});

test('a subagent finishing does not overwrite the main status', async ($, on) => {
  mock.clock(on);
  const ui = screen(on);
  await $.turn.start({ text: 'go', turnId: 't1' });
  await $.turn.complete({ ...complete, durationMs: 1000, agentId: 'sub-1' });
  expect(ui.statuses).toEqual([undefined]);
});
