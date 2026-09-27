import { describe, it, expect, afterAll } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FAKE_CLAUDE, sleep, waitFor } from './support.ts';

// The fake CLI stands in for claude in the runner tests, so check it against the probed protocol on its own.

const tmp = mkdtempSync(join(tmpdir(), 'omni-fake-claude-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const STREAM_ARGS = [
  '-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--replay-user-messages',
  '--model', 'sonnet', '--permission-mode', 'bypassPermissions', '--add-dir', tmp, '--add-dir', join(tmp, 'brain'),
  '--append-system-prompt', '# Omni OS context\n- Thread: test',
];
const T = { timeout: 15_000 };

type Evt = { [k: string]: any };

function fake(opts: { resume?: boolean; env?: Record<string, string> } = {}) {
  const sid = randomUUID();
  const child = spawn(FAKE_CLAUDE, [...STREAM_ARGS, opts.resume ? '--resume' : '--session-id', sid], {
    cwd: tmp,
    env: { ...process.env, FAKE_CLAUDE_LATENCY_MS: '10', ...opts.env },
    stdio: 'pipe',
  });
  const events: Evt[] = [];
  let stderr = '';
  let buf = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (d: string) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (line) events.push(JSON.parse(line));
    }
  });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (d: string) => (stderr += d));
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((res) =>
    child.on('close', (code, signal) => res({ code, signal })),
  );
  const write = (o: unknown) => child.stdin.write(JSON.stringify(o) + '\n');
  return {
    sid,
    child,
    events,
    exited,
    stderr: () => stderr,
    send(text: string, uuid = randomUUID()) {
      write({ type: 'user', message: { role: 'user', content: text }, parent_tool_use_id: null, session_id: sid, uuid });
      return uuid;
    },
    interrupt(request_id = `req_${randomUUID().slice(0, 8)}`) {
      write({ type: 'control_request', request_id, request: { subtype: 'interrupt' } });
      return request_id;
    },
    raw: (line: string) => child.stdin.write(line + '\n'),
    until: (what: string, pred: (e: Evt) => boolean, n = 1) =>
      waitFor(() => events.filter(pred).length >= n, () => `${what}; got ${JSON.stringify(flow(events))}`),
    end: () => child.stdin.end(),
  };
}

/** Compact labels for order assertions. Noise events map to null. */
function label(e: Evt): string | null {
  if (e.type === 'system' && e.subtype === 'init') return 'init';
  if (e.type === 'user' && e.isReplay) return `replay:${e.message.content}`;
  if (e.type === 'user') {
    const b = e.message.content[0];
    return b.type === 'tool_result' ? `tool_result${b.is_error ? ':rejected' : ''}` : `marker:${b.text}`;
  }
  if (e.type === 'assistant') {
    const b = e.message.content[0];
    return b.type === 'tool_use' ? 'tool_use' : b.type === 'text' ? `text:${b.text}` : null;
  }
  if (e.type === 'result') return `result:${e.subtype}`;
  if (e.type === 'control_response') return `control:${e.response.subtype}`;
  return null;
}
const flow = (events: Evt[]) => events.map(label).filter(Boolean);
const isToolUse = (e: Evt) => label(e) === 'tool_use';
const isResult = (e: Evt) => e.type === 'result';
const isReplay = (e: Evt) => e.type === 'user' && e.isReplay;

describe('fake claude: streaming input', () => {
  it('replays steers sent during a tool right after its tool_result and continues the same turn', T, async () => {
    const f = fake();
    const first = f.send('TOOL:400 run it');
    await f.until('tool_use', isToolUse);
    const s1 = f.send('steer one');
    const s2 = f.send('steer two');
    await f.until('result', isResult);
    f.end();
    expect(await f.exited).toEqual({ code: 0, signal: null });

    expect(flow(f.events)).toEqual([
      'init', 'replay:TOOL:400 run it', 'tool_use', 'tool_result', 'replay:steer one', 'replay:steer two',
      'text:ack: TOOL:400 run it | steer one | steer two', 'result:success',
    ]);
    expect(f.events.filter(isReplay).map((e) => e.uuid)).toEqual([first, s1, s2]);
    expect(f.events.find(isResult)).toMatchObject({ num_turns: 2, is_error: false, result: 'ack: TOOL:400 run it | steer one | steer two' });
    expect(f.events.find((e) => e.subtype === 'init')).toMatchObject({
      session_id: f.sid, fake_pid: f.child.pid, fake_resumed: false, model: 'sonnet', cwd: realpathSync(tmp),
    });
    expect(f.events.every((e) => e.type === 'control_response' || e.session_id === f.sid)).toBe(true);
    // Noise the runner has to ignore.
    const types = new Set(f.events.map((e) => e.type + (e.subtype ? `/${e.subtype}` : '')));
    for (const t of ['command_lifecycle', 'system/thinking_tokens', 'system/hook_started', 'system/hook_response', 'system/post_turn_summary', 'rate_limit_event']) {
      expect(types).toContain(t);
    }
  });

  it('runs a message sent while only text is being written as the next turn', T, async () => {
    const f = fake();
    f.send('THINK:300 write a paragraph');
    await f.until('first replay', isReplay);
    f.send('steer while writing');
    await f.until('two results', isResult, 2);
    f.end();
    await f.exited;
    expect(flow(f.events)).toEqual([
      'init', 'replay:THINK:300 write a paragraph', 'text:ack: THINK:300 write a paragraph', 'result:success',
      'init', 'replay:steer while writing', 'text:ack: steer while writing', 'result:success',
    ]);
    expect(new Set(f.events.filter((e) => e.subtype === 'init').map((e) => e.fake_pid))).toEqual(new Set([f.child.pid]));
  });

  it('answers an interrupt with still_queued, rejects the tool, then runs the queued message', T, async () => {
    const f = fake();
    f.send('TOOL:5000 long job');
    await f.until('tool_use', isToolUse);
    const t0 = Date.now();
    const queued = f.send('after the interrupt');
    const req = f.interrupt();
    await f.until('two results', isResult, 2);
    expect(Date.now() - t0).toBeLessThan(2000);
    f.end();
    expect((await f.exited).code).toBe(0);

    expect(flow(f.events)).toEqual([
      'init', 'replay:TOOL:5000 long job', 'tool_use', 'control:success', 'tool_result:rejected',
      'marker:[Request interrupted by user for tool use]', 'result:error_during_execution',
      'init', 'replay:after the interrupt', 'text:ack: after the interrupt', 'result:success',
    ]);
    expect(f.events.find((e) => e.type === 'control_response')).toEqual({
      type: 'control_response',
      response: { subtype: 'success', request_id: req, response: { still_queued: [queued] } },
    });
    const rejected = f.events.find((e) => label(e) === 'tool_result:rejected')!;
    expect(rejected.message.content[0].content).toContain("doesn't want to proceed");
    expect(f.events.filter(isResult)[0]).toMatchObject({ subtype: 'error_during_execution', num_turns: 1 });
  });

  it('stays alive after an interrupt, answers idle interrupts, and keeps serving the session', T, async () => {
    const f = fake();
    f.send('TOOL:5000 long job');
    await f.until('tool_use', isToolUse);
    f.interrupt();
    await f.until('interrupted result', isResult);
    await sleep(50);
    expect(f.child.exitCode).toBeNull();

    const idleReq = f.interrupt();
    await f.until('idle control response', (e) => e.type === 'control_response', 2);
    expect(f.events.filter((e) => e.type === 'control_response')[1].response).toEqual({
      subtype: 'success', request_id: idleReq, response: { still_queued: [] },
    });

    f.send('what were you doing?');
    await f.until('second result', isResult, 2);
    f.end();
    expect((await f.exited).code).toBe(0);
    expect(flow(f.events).slice(-4)).toEqual(['init', 'replay:what were you doing?', 'text:ack: what were you doing?', 'result:success']);
    expect(f.events.filter(isResult)).toHaveLength(2);
  });

  it('interrupting while the model writes text ends the turn with the plain marker', T, async () => {
    const f = fake();
    f.send('THINK:3000 slow answer');
    await f.until('replay', isReplay);
    f.interrupt();
    await f.until('result', isResult);
    f.end();
    await f.exited;
    expect(flow(f.events)).toEqual([
      'init', 'replay:THINK:3000 slow answer', 'control:success', 'marker:[Request interrupted by user]', 'result:error_during_execution',
    ]);
  });

  it('finishes the current turn when stdin closes, then exits 0', T, async () => {
    const f = fake();
    f.send('TOOL:300 last one');
    f.end();
    expect(await f.exited).toEqual({ code: 0, signal: null });
    expect(flow(f.events).slice(-2)).toEqual(['text:ack: TOOL:300 last one', 'result:success']);
  });

  it('ignores interrupts in an IGNORE_INTERRUPT turn and exits normally on SIGINT', T, async () => {
    const f = fake();
    f.send('TOOL:8000 IGNORE_INTERRUPT');
    await f.until('tool_use', isToolUse);
    f.interrupt();
    await sleep(300);
    expect(f.events.some((e) => e.type === 'control_response' || isResult(e))).toBe(false);
    f.child.kill('SIGINT');
    expect(await f.exited).toEqual({ code: 0, signal: null });
  });

  it('exits 1 with a stderr message when a FAKE_CLAUDE_CRASH_ON message starts', T, async () => {
    const f = fake({ env: { FAKE_CLAUDE_CRASH_ON: 'BOOM' } });
    f.send('TOOL:300 fine');
    await f.until('tool_use', isToolUse);
    f.send('BOOM now');
    f.send('never seen');
    expect((await f.exited).code).toBe(1);
    expect(f.stderr()).toContain('crashed on purpose');
    expect(flow(f.events)).toEqual(['init', 'replay:TOOL:300 fine', 'tool_use', 'tool_result']);
  });

  it('reports a resume in init and can flush a zero-turn result first', T, async () => {
    const f = fake({ resume: true, env: { FAKE_CLAUDE_RESUME_FLUSH: '1' } });
    f.send('hi again');
    await f.until('real result', isResult, 2);
    f.end();
    await f.exited;
    expect(flow(f.events)).toEqual(['result:success', 'init', 'replay:hi again', 'text:ack: hi again', 'result:success']);
    expect(f.events.filter(isResult).map((e) => e.num_turns)).toEqual([0, 1]);
    expect(f.events.find((e) => e.subtype === 'init')).toMatchObject({ session_id: f.sid, fake_resumed: true });
  });

  it('answers initialize with its commands, then lists them again with MCP prompts once its MCP servers connect', T, async () => {
    const f = fake();
    f.raw(JSON.stringify({ type: 'control_request', request_id: 'c1', request: { subtype: 'initialize' } }));
    await f.until('commands_changed', (e) => e.type === 'system' && e.subtype === 'commands_changed');
    f.end();
    await f.exited;
    const answer = f.events.find((e) => e.type === 'control_response')!.response;
    const later: Evt[] = f.events.find((e) => e.subtype === 'commands_changed')!.commands;
    const mcp = (list: Evt[]) => list.filter((c) => c.name.endsWith(' (MCP)')).map((c) => c.name);
    expect(answer).toMatchObject({ subtype: 'success', request_id: 'c1' });
    expect(mcp(answer.response.commands)).toEqual([]);
    // The whole list again, not just what changed.
    expect(later.slice(0, answer.response.commands.length)).toEqual(answer.response.commands);
    expect(mcp(later)).toEqual(['plugin:github:github:AssignCodingAgent (MCP)', 'claude.ai Figma:create_design_system_rules (MCP)']);
  });

  it('skips bad input lines and answers unsupported control requests with an error', T, async () => {
    const f = fake();
    f.raw('{not json');
    f.raw(JSON.stringify({ type: 'control_request', request_id: 'r9', request: { subtype: 'rewind_files' } }));
    f.send('still fine');
    await f.until('result', isResult);
    f.end();
    await f.exited;
    expect(f.stderr()).toContain('bad stream-json input line');
    expect(f.events.find((e) => e.type === 'control_response')!.response).toMatchObject({ subtype: 'error', request_id: 'r9' });
    expect(flow(f.events).slice(-1)).toEqual(['result:success']);
  });
});

describe('fake claude: one-shot and argument handling', () => {
  const run = (args: string[], input: string, env: Record<string, string> = {}) =>
    spawnSync(FAKE_CLAUDE, args, { input, encoding: 'utf8', cwd: tmp, env: { ...process.env, ...env } });
  const TITLE = ['-p', '--model', 'haiku', '--strict-mcp-config', '--no-session-persistence', '--tools', ''];

  it('answers title generation in text and json output', () => {
    const text = run([...TITLE, '--output-format', 'text'], 'Write a title for: fix the header');
    expect(text.status).toBe(0);
    expect(text.stdout).toBe('Fake title\n');
    const json = run([...TITLE, '--output-format', 'json'], 'Write a title for: fix the header');
    expect(json.status).toBe(0);
    expect(JSON.parse(json.stdout)).toMatchObject({ type: 'result', subtype: 'success', is_error: false, result: 'Fake title' });
  });

  it('runs a single stream-json turn from stdin without --input-format', () => {
    const out = run(['-p', '--output-format', 'stream-json', '--verbose', '--session-id', 's-1'], 'TOOL:50 one shot');
    expect(out.status).toBe(0);
    const events = out.stdout.trim().split('\n').map((l) => JSON.parse(l));
    expect(flow(events)).toEqual(['init', 'tool_use', 'tool_result', 'text:ack: TOOL:50 one shot', 'result:success']);
  });

  it('refuses the flag combinations the real CLI refuses', () => {
    expect(run(['-p', '--output-format', 'stream-json', '--input-format', 'stream-json'], '').stderr).toContain('requires --verbose');
    expect(run(['-p', '--input-format', 'stream-json', '--output-format', 'text'], '').status).toBe(1);
    expect(run(['-p', '--replay-user-messages', '--output-format', 'text'], 'x').status).toBe(1);
    expect(run(['-p', '--output-format', 'text'], '').stderr).toContain('Input must be provided');
    expect(run(['--version'], '').stdout).toContain('(Claude Code)');
  });

  it('logs every invocation with FAKE_CLAUDE_LOG, including unknown options', () => {
    const log = join(tmp, 'invocations.jsonl');
    run([...TITLE, '--output-format', 'text', '--made-up-flag'], 'title please', { FAKE_CLAUDE_LOG: log, OMNI_THREAD_ID: 'th-1' });
    run(['-p', '--output-format', 'stream-json', '--verbose', '--resume', 'sess-9'], 'hello', { FAKE_CLAUDE_LOG: log });
    const lines = readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    expect(lines[0]).toMatchObject({ mode: 'text', thread_id: 'th-1', model: 'haiku', unknown: ['--made-up-flag'] });
    expect(lines[1]).toMatchObject({ mode: 'stream-json', session_id: 'sess-9', resume: true, unknown: [] });
    expect(typeof lines[1].pid).toBe('number');
  });
});
