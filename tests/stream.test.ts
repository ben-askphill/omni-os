import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Guard: stream.ts is pure. If it ever pulls in db.ts, fail loudly instead of touching data/omni.db.
vi.mock('../server/db.ts', () => {
  throw new Error('db.ts must not be imported by stream tests');
});

import { parseEvent, LineSplitter, type Record } from '../server/stream.ts';

const SAMPLE = join(import.meta.dirname, 'fixtures', 'stream-sample.jsonl');
const sampleLines = () =>
  readFileSync(SAMPLE, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));

describe('parseEvent: system', () => {
  it('maps init to model, cwd, tool count and mcp status', () => {
    const out = parseEvent({
      type: 'system',
      subtype: 'init',
      session_id: 'sess-1',
      model: 'claude-opus',
      cwd: '/repo',
      tools: ['Bash', 'Read', 'Edit'],
      mcp_servers: [
        { name: 'omni-browser', status: 'connected' },
        { name: 'omni', status: 'failed' },
      ],
    });
    expect(out.sessionId).toBe('sess-1');
    expect(out.records).toEqual([
      { kind: 'init', payload: { model: 'claude-opus', cwd: '/repo', tools: 3, mcp: ['omni-browser:connected', 'omni:failed'] } },
    ]);
  });

  it('tolerates init without tools or mcp_servers', () => {
    const out = parseEvent({ type: 'system', subtype: 'init' });
    expect(out.records).toEqual([{ kind: 'init', payload: { model: '', cwd: '', tools: 0, mcp: [] } }]);
  });

  it('maps task_summary with detail to a status record', () => {
    const out = parseEvent({ type: 'system', subtype: 'task_summary', detail: 'Running echo hi' });
    expect(out.records).toEqual([{ kind: 'status', payload: { text: 'Running echo hi' } }]);
  });

  it('drops task_summary with null detail', () => {
    expect(parseEvent({ type: 'system', subtype: 'task_summary', detail: null }).records).toEqual([]);
  });

  it('maps the task lifecycle to task records', () => {
    const started = parseEvent({ type: 'system', subtype: 'task_started', task_id: 't1', tool_use_id: 'toolu_1', description: 'Restyle home', subagent_type: 'general-purpose', task_type: 'local_agent', is_backgrounded: true, prompt: 'long' });
    expect(started.records).toEqual([{ kind: 'task', payload: { task_id: 't1', tool_use_id: 'toolu_1', event: 'started', description: 'Restyle home', subagent_type: 'general-purpose', task_type: 'local_agent', background: true } }]);
    const progress = parseEvent({ type: 'system', subtype: 'task_progress', task_id: 't1', tool_use_id: 'toolu_1', description: 'Restyle home', usage: { total_tokens: 900, tool_uses: 4, duration_ms: 5000 }, last_tool_name: 'Edit' });
    expect(progress.records[0].payload).toEqual({ task_id: 't1', tool_use_id: 'toolu_1', event: 'progress', description: 'Restyle home', last_tool: 'Edit', tool_uses: 4, tokens: 900, duration_ms: 5000 });
    const done = parseEvent({ type: 'system', subtype: 'task_notification', task_id: 't1', tool_use_id: 'toolu_1', status: 'completed', output_file: '', summary: 'Restyled' });
    expect(done.records[0].payload).toEqual({ task_id: 't1', tool_use_id: 'toolu_1', event: 'ended', status: 'completed', summary: 'Restyled' });
  });

  it('keeps only the task_updated patches a view shows', () => {
    expect(parseEvent({ type: 'system', subtype: 'task_updated', task_id: 't1', patch: { status: 'failed', error: 'x' } }).records[0].payload).toEqual({ task_id: 't1', event: 'ended', status: 'failed' });
    expect(parseEvent({ type: 'system', subtype: 'task_updated', task_id: 't1', patch: { is_backgrounded: true } }).records[0].payload).toEqual({ task_id: 't1', event: 'progress', background: true });
    expect(parseEvent({ type: 'system', subtype: 'task_updated', task_id: 't1', patch: { total_paused_ms: 5 } }).records).toEqual([]);
    expect(parseEvent({ type: 'system', subtype: 'task_started' }).records).toEqual([]);
  });

  it('ignores hook and other system subtypes', () => {
    expect(parseEvent({ type: 'system', subtype: 'hook_started', hook_id: 'x' }).records).toEqual([]);
    expect(parseEvent({ type: 'system', subtype: 'post_turn_summary', status_detail: 'x' }).records).toEqual([]);
  });
});

describe('parseEvent: assistant', () => {
  it('emits text and tool_use blocks in order, skipping thinking and blank text', () => {
    const out = parseEvent({
      type: 'assistant',
      parent_tool_use_id: null,
      message: {
        content: [
          { type: 'thinking', thinking: 'hmm' },
          { type: 'text', text: 'Looking now.' },
          { type: 'text', text: '   \n ' },
          { type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'ls' } },
        ],
      },
    });
    expect(out.records).toEqual([
      { kind: 'assistant_text', payload: { text: 'Looking now.' } },
      { kind: 'tool_use', payload: { id: 'toolu_1', name: 'Bash', input: { command: 'ls' }, parent: null } },
    ]);
  });

  it('drops sub-agent text (parent_tool_use_id set) but keeps its tool calls with the parent id', () => {
    const out = parseEvent({
      type: 'assistant',
      parent_tool_use_id: 'toolu_task',
      message: {
        content: [
          { type: 'text', text: 'sub-agent chatter' },
          { type: 'tool_use', id: 'toolu_2', name: 'Read', input: { file_path: '/x' } },
        ],
      },
    });
    expect(out.records).toEqual([
      { kind: 'tool_use', payload: { id: 'toolu_2', name: 'Read', input: { file_path: '/x' }, parent: 'toolu_task' } },
    ]);
  });

  it('handles a missing message body', () => {
    expect(parseEvent({ type: 'assistant' }).records).toEqual([]);
  });
});

describe('parseEvent: user tool_result', () => {
  it('reads string content', () => {
    const out = parseEvent({
      type: 'user',
      message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'hi', is_error: false }] },
    });
    expect(out.records).toEqual([
      { kind: 'tool_result', payload: { tool_use_id: 'toolu_1', text: 'hi', is_error: false, truncated: false } },
    ]);
  });

  it('joins array content: text blocks, images as [image], unknown blocks dropped', () => {
    const out = parseEvent({
      type: 'user',
      message: {
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'toolu_3',
            is_error: true,
            content: [
              { type: 'text', text: 'line one' },
              { type: 'image', source: { type: 'base64', data: 'AAAA' } },
              { type: 'tool_reference', tool_name: 'x' },
              { type: 'text', text: 'line two' },
            ],
          },
        ],
      },
    });
    expect(out.records).toEqual([
      { kind: 'tool_result', payload: { tool_use_id: 'toolu_3', text: 'line one\n[image]\nline two', is_error: true, truncated: false } },
    ]);
  });

  it('truncates results over 16000 chars and flags them', () => {
    const big = 'x'.repeat(16_001);
    const out = parseEvent({
      type: 'user',
      message: { content: [{ type: 'tool_result', tool_use_id: 't', content: [{ type: 'text', text: big }] }] },
    });
    const rec = out.records[0] as Extract<Record, { kind: 'tool_result' }>;
    expect(rec.payload.text.length).toBe(16_000);
    expect(rec.payload.truncated).toBe(true);
    expect(rec.payload.is_error).toBe(false);
  });

  it('does not truncate exactly 16000 chars', () => {
    const out = parseEvent({
      type: 'user',
      message: { content: [{ type: 'tool_result', tool_use_id: 't', content: 'y'.repeat(16_000) }] },
    });
    const rec = out.records[0] as Extract<Record, { kind: 'tool_result' }>;
    expect(rec.payload.truncated).toBe(false);
    expect(rec.payload.text.length).toBe(16_000);
  });

  it('JSON-encodes object content and treats null as empty', () => {
    const out = parseEvent({
      type: 'user',
      message: {
        content: [
          { type: 'tool_result', tool_use_id: 'a', content: { ok: 1 } },
          { type: 'tool_result', tool_use_id: 'b', content: null },
        ],
      },
    });
    expect(out.records.map((r) => (r.payload as { text: string }).text)).toEqual(['{"ok":1}', '']);
  });

  it('ignores plain user prompts (string content or text blocks)', () => {
    expect(parseEvent({ type: 'user', message: { content: 'hello' } }).records).toEqual([]);
    expect(parseEvent({ type: 'user', message: { content: [{ type: 'text', text: 'hello' }] } }).records).toEqual([]);
  });
});

describe('parseEvent: rate limits and results', () => {
  it('maps rate_limit_event to usage windows', () => {
    const out = parseEvent({
      type: 'rate_limit_event',
      rate_limit_info: {
        status: 'allowed',
        unifiedWindows: {
          five_hour: { utilization: 0.04, resetsAt: 1790328600 },
          seven_day: { utilization: 0.06, resetsAt: 1790769600 },
        },
      },
    });
    expect(out.records).toEqual([]);
    expect(out.usage).toMatchObject({
      five_hour: { utilization: 0.04, resetsAt: 1790328600 },
      seven_day: { utilization: 0.06, resetsAt: 1790769600 },
      status: 'allowed',
    });
    expect(Number.isNaN(Date.parse(out.usage!.updated_at))).toBe(false);
  });

  it('handles rate_limit_event without unifiedWindows', () => {
    const out = parseEvent({ type: 'rate_limit_event', rate_limit_info: { status: 'rejected' } });
    expect(out.usage).toMatchObject({ status: 'rejected' });
    expect(out.usage!.five_hour).toBeUndefined();
  });

  it('maps a successful result', () => {
    const out = parseEvent({
      type: 'result',
      subtype: 'success',
      is_error: false,
      duration_ms: 4356,
      num_turns: 2,
      total_cost_usd: 0.07,
      result: 'Done',
    });
    expect(out.records).toEqual([
      { kind: 'result', payload: { ok: true, subtype: 'success', duration_ms: 4356, turns: 2, cost_usd: 0.07, text: 'Done' } },
    ]);
  });

  it('marks error subtypes and success-with-is_error as not ok', () => {
    const err = parseEvent({ type: 'result', subtype: 'error_max_turns', is_error: true }).records[0];
    expect(err).toMatchObject({ kind: 'result', payload: { ok: false, subtype: 'error_max_turns' } });
    expect((err.payload as { text?: string }).text).toBeUndefined();

    const apiErr = parseEvent({ type: 'result', subtype: 'success', is_error: true, result: 'API Error' }).records[0];
    expect(apiErr).toMatchObject({ payload: { ok: false, subtype: 'success', text: 'API Error' } });
  });

  it('defaults a missing subtype to unknown', () => {
    expect(parseEvent({ type: 'result' }).records[0]).toMatchObject({ payload: { ok: false, subtype: 'unknown' } });
  });
});

describe('parseEvent: junk input', () => {
  it.each([null, undefined, 42, 'str', {}, { type: 'nope' }])('returns no records for %j', (evt) => {
    expect(parseEvent(evt).records).toEqual([]);
  });
});

describe('parseEvent: captured stream sample', () => {
  it('turns a real `claude -p --output-format stream-json` run into the expected records', () => {
    const records: Record[] = [];
    let usage;
    const sessions = new Set<string>();
    for (const evt of sampleLines()) {
      const p = parseEvent(evt);
      records.push(...p.records);
      if (p.usage) usage = p.usage;
      if (p.sessionId) sessions.add(p.sessionId);
    }
    expect([...sessions]).toEqual(['67e83fae-bf4c-45bd-aad1-9356f2ae6370']);
    expect(records.map((r) => r.kind)).toEqual(['init', 'tool_use', 'status', 'tool_result', 'assistant_text', 'result']);
    expect(records[0]).toMatchObject({ payload: { model: 'claude-haiku-4-5-20251001', tools: 33, mcp: ['omni-browser:connected', 'omni:failed'] } });
    expect(records[1]).toMatchObject({ payload: { name: 'Bash', input: { command: 'echo hi' }, parent: null } });
    expect(records[3]).toMatchObject({ payload: { tool_use_id: (records[1].payload as { id: string }).id, text: 'hi', is_error: false } });
    expect(records[4]).toEqual({ kind: 'assistant_text', payload: { text: 'Done' } });
    expect(records[5]).toMatchObject({ payload: { ok: true, subtype: 'success', turns: 2, text: 'Done' } });
    expect(usage).toMatchObject({ status: 'allowed', five_hour: { utilization: 0.04 } });
  });
});

describe('parseEvent: streaming input (replay, control, interrupt)', () => {
  const replay = (content: unknown, uuid = 'u-1') => ({
    type: 'user', isReplay: true, uuid, session_id: 's', parent_tool_use_id: null, message: { role: 'user', content },
  });

  it('maps a replayed message to a replay record carrying our uuid', () => {
    expect(parseEvent(replay('Change of plan: include PINEAPPLE', 'uuid-42')).records).toEqual([
      { kind: 'replay', payload: { uuid: 'uuid-42', text: 'Change of plan: include PINEAPPLE' } },
    ]);
  });

  it('reads text blocks of a replayed message and skips other blocks', () => {
    expect(parseEvent(replay([{ type: 'text', text: 'steer' }])).records).toEqual([{ kind: 'replay', payload: { uuid: 'u-1', text: 'steer' } }]);
    const two = parseEvent(replay([{ type: 'text', text: 'one' }, { type: 'image', source: {} }, { type: 'text', text: 'two' }])).records;
    expect(two).toHaveLength(1);
    expect(two[0].kind).toBe('replay');
    const text = (two[0].payload as { text: string }).text;
    expect(text).toContain('one');
    expect(text).toContain('two');
    expect(text).not.toContain('image');
  });

  it('maps control_response to a control record with still_queued', () => {
    const out = parseEvent({
      type: 'control_response',
      response: { subtype: 'success', request_id: 'req_int_2', response: { still_queued: ['1111', '2222'] } },
    });
    expect(out.records).toEqual([{ kind: 'control', payload: { request_id: 'req_int_2', subtype: 'success', still_queued: ['1111', '2222'] } }]);
  });

  it('gives an empty still_queued when the CLI lists none, and keeps error subtypes', () => {
    const empty = parseEvent({ type: 'control_response', response: { subtype: 'success', request_id: 'r1', response: {} } });
    expect(empty.records).toEqual([{ kind: 'control', payload: { request_id: 'r1', subtype: 'success', still_queued: [] } }]);
    const err = parseEvent({ type: 'control_response', response: { subtype: 'error', request_id: 'r2', error: 'nope' } });
    expect(err.records).toMatchObject([{ kind: 'control', payload: { request_id: 'r2', subtype: 'error' } }]);
  });

  it.each(['[Request interrupted by user for tool use]', '[Request interrupted by user]'])('drops the interrupt marker %s', (text) => {
    const marker = { type: 'user', session_id: 's', message: { role: 'user', content: [{ type: 'text', text }] } };
    expect(parseEvent(marker).records).toEqual([]);
  });

  it('still parses the rejected tool_result of an interrupted tool', () => {
    const out = parseEvent({
      type: 'user',
      message: {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'toolu_9', is_error: true, content: "The user doesn't want to proceed with this tool use." }],
      },
    });
    expect(out.records).toMatchObject([{ kind: 'tool_result', payload: { tool_use_id: 'toolu_9', is_error: true } }]);
  });

  it.each([
    { type: 'command_lifecycle', phase: 'turn_end' },
    { type: 'system', subtype: 'thinking_tokens', tokens: 12 },
    { type: 'system', subtype: 'post_turn_summary', status_detail: 'x' },
    { type: 'system', subtype: 'hook_started', hook_id: 'h' },
    { type: 'system', subtype: 'hook_response', hook_id: 'h', exit_code: 0 },
  ])('ignores stream noise %j', (evt) => {
    expect(parseEvent(evt).records).toEqual([]);
  });

  // Event sequences from the live probes against claude 2.1.278 (steer contract, section 1).
  const kinds = (evts: unknown[]) => evts.flatMap((e) => parseEvent(e).records.map((r) => r.kind));
  const toolUse = { type: 'assistant', parent_tool_use_id: null, message: { content: [{ type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'sleep 8' } }] } };
  const toolResult = (text: string, is_error = false) => ({
    type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: text, is_error }] },
  });

  it('turns the steer-mid-tool probe into the records the runner consumes', () => {
    expect(
      kinds([
        { type: 'system', subtype: 'init', session_id: 's' },
        replay('Run the loop', 'u1'),
        toolUse,
        toolResult('tick 1..8'),
        replay('Change of plan', 'u2'),
        { type: 'assistant', parent_tool_use_id: null, message: { content: [{ type: 'text', text: 'Done, PINEAPPLE.' }] } },
        { type: 'result', subtype: 'success', is_error: false, num_turns: 2, result: 'Done, PINEAPPLE.' },
        { type: 'command_lifecycle' },
      ]),
    ).toEqual(['init', 'replay', 'tool_use', 'tool_result', 'replay', 'assistant_text', 'result']);
  });

  it('turns the interrupt probe into the records the runner consumes', () => {
    expect(
      kinds([
        toolUse,
        { type: 'control_response', response: { subtype: 'success', request_id: 'req_int_1', response: { still_queued: [] } } },
        toolResult("The user doesn't want to proceed with this tool use.", true),
        { type: 'user', message: { role: 'user', content: [{ type: 'text', text: '[Request interrupted by user for tool use]' }] } },
        { type: 'result', subtype: 'error_during_execution', is_error: true, num_turns: 3 },
      ]),
    ).toEqual(['tool_use', 'control', 'tool_result', 'result']);
  });
});

describe('LineSplitter', () => {
  it('reassembles lines split across chunks', () => {
    const s = new LineSplitter();
    expect(s.push('{"a":')).toEqual([]);
    expect(s.push('1}\n{"b"')).toEqual(['{"a":1}']);
    expect(s.push(':2}\n')).toEqual(['{"b":2}']);
    expect(s.flush()).toEqual([]);
  });

  it('returns several lines from one chunk and skips blank lines', () => {
    const s = new LineSplitter();
    expect(s.push('one\n\n  \ntwo\nthr')).toEqual(['one', 'two']);
    expect(s.push('ee\n')).toEqual(['three']);
  });

  it('trims CRLF endings', () => {
    const s = new LineSplitter();
    expect(s.push('a\r\nb\r\n')).toEqual(['a', 'b']);
  });

  it('flush returns the unterminated tail once', () => {
    const s = new LineSplitter();
    s.push('tail-without-newline');
    expect(s.flush()).toEqual(['tail-without-newline']);
    expect(s.flush()).toEqual([]);
  });

  it('round-trips the captured sample fed one byte-ish chunk at a time', () => {
    const raw = readFileSync(SAMPLE, 'utf8');
    const s = new LineSplitter();
    const got: string[] = [];
    for (let i = 0; i < raw.length; i += 7) got.push(...s.push(raw.slice(i, i + 7)));
    got.push(...s.flush());
    expect(got).toEqual(raw.split('\n').filter(Boolean));
    expect(got.every((l) => typeof JSON.parse(l) === 'object')).toBe(true);
  });
});

describe('parseEvent: mod ui events', () => {
  // As claude 2.1.287 prints them under -p --output-format stream-json, from a plugin's $.ui calls.
  const LOG = '{"type":"system","subtype":"ui_log","plugin":"omni-tool","text":"omni-tool: thread_info served","uuid":"u1","session_id":"s"}';
  const TOAST = '{"type":"system","subtype":"ui_toast","plugin":"omni-tool","text":"thread_info ran","timeout_ms":4000,"uuid":"u2","session_id":"s"}';
  const STATUS = '{"type":"system","subtype":"ui_status","plugin":"omni-tool","text":"omni-tool: ready","uuid":"u3","session_id":"s"}';
  const records = (line: string | object) => parseEvent(typeof line === 'string' ? JSON.parse(line) : line).records;

  it('maps ui_log to a log', () => {
    expect(records(LOG)).toEqual([{ kind: 'mod', payload: { plugin: 'omni-tool', level: 'log', text: 'omni-tool: thread_info served' } }]);
  });

  it('maps ui_toast to a toast with its timeout', () => {
    expect(records(TOAST)).toEqual([{ kind: 'mod', payload: { plugin: 'omni-tool', level: 'toast', text: 'thread_info ran', timeout_ms: 4000 } }]);
  });

  it('maps ui_status to a status', () => {
    expect(records(STATUS)).toEqual([{ kind: 'mod', payload: { plugin: 'omni-tool', level: 'status', text: 'omni-tool: ready' } }]);
  });

  it('reads a status with null, empty or no text as a clear', () => {
    const clear = [{ kind: 'mod', payload: { plugin: 'omni-tool', level: 'status', text: null } }];
    expect(records({ type: 'system', subtype: 'ui_status', plugin: 'omni-tool', text: null })).toEqual(clear);
    expect(records({ type: 'system', subtype: 'ui_status', plugin: 'omni-tool', text: '  ' })).toEqual(clear);
    expect(records({ type: 'system', subtype: 'ui_status', plugin: 'omni-tool' })).toEqual(clear);
  });

  it('reads an unknown ui_* subtype with text as a log', () => {
    expect(records({ type: 'system', subtype: 'ui_foo', plugin: 'omni-tool', text: 'hello' })).toEqual([
      { kind: 'mod', payload: { plugin: 'omni-tool', level: 'log', text: 'hello' } },
    ]);
  });

  it('ignores drawing-protocol messages and toasts or logs without text', () => {
    expect(records({ type: 'system', subtype: 'ui_render', plugin: 'omni-tool', tree: { type: 'box' } })).toEqual([]);
    expect(records({ type: 'system', subtype: 'ui_attach', plugin: 'omni-tool', pane: 'p1' })).toEqual([]);
    expect(records({ type: 'system', subtype: 'ui_toast', plugin: 'omni-tool', text: '' })).toEqual([]);
    expect(records({ type: 'system', subtype: 'ui_log', plugin: 'omni-tool', text: { not: 'text' } })).toEqual([]);
  });

  it('caps text at 2,000 characters and names a missing plugin "mod"', () => {
    const [r] = records({ type: 'system', subtype: 'ui_log', text: 'x'.repeat(5000) });
    expect(r).toEqual({ kind: 'mod', payload: { plugin: 'mod', level: 'log', text: 'x'.repeat(2000) } });
  });

  it('leaves out a toast timeout that is not a positive number', () => {
    expect(records({ type: 'system', subtype: 'ui_toast', plugin: 'p', text: 't', timeout_ms: 'soon' })).toEqual([
      { kind: 'mod', payload: { plugin: 'p', level: 'toast', text: 't' } },
    ]);
  });
});
