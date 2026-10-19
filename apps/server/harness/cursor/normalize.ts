// Pure translation of `cursor-agent -p --output-format stream-json` events into Omni's
// records, so a Cursor turn renders in the same transcript as a Claude turn. Cursor's echo
// of the user message and its thinking are dropped (Omni already stores Ben's own text).
// Tool names follow Claude Code's so the transcript renders them unchanged.
import type { Record as StreamRecord } from '../../stream.ts';

const MAX_RESULT = 16_000;
const clip = (s: string) => (s.length > MAX_RESULT ? s.slice(0, MAX_RESULT) : s);
const truncated = (s: string) => s.length > MAX_RESULT;

const TODO_STATUS: Record<string, string> = {
  pending: 'pending',
  in_progress: 'in_progress',
  running: 'in_progress',
  completed: 'completed',
  done: 'completed',
};

export interface CursorParsed {
  records: StreamRecord[];
  /** Present on the terminal result event: whether the turn completed and its final text. */
  result?: { ok: boolean; text: string };
  /** The Cursor chat/session id, when the event carries one. */
  sessionId?: string;
}

const textOf = (content: unknown): string => {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.filter((b: any) => b?.type === 'text').map((b: any) => b.text ?? '').join('');
  return '';
};

/** One Cursor stream event to Omni records (plus session id and terminal result when present). */
export function normalizeCursor(evt: any): CursorParsed {
  const out: CursorParsed = { records: [] };
  if (!evt || typeof evt !== 'object') return out;
  switch (evt.type) {
    case 'system':
      if (evt.subtype === 'init') {
        out.sessionId = evt.session_id;
        out.records.push({ kind: 'init', payload: { model: evt.model ?? '', cwd: evt.cwd ?? '', tools: 0, mcp: [] } });
      }
      break;
    case 'user':
    case 'thinking':
      // Dropped: Omni already stores Ben's text without the added context, and reasoning is hidden.
      break;
    case 'assistant': {
      const text = textOf(evt.message?.content);
      if (text.trim()) out.records.push({ kind: 'assistant_text', payload: { text } });
      break;
    }
    case 'tool_call':
      if (evt.subtype === 'completed') out.records.push(...toolCall(evt));
      break;
    case 'result':
      out.sessionId = evt.session_id ?? out.sessionId;
      out.result = { ok: evt.subtype === 'success' && !evt.is_error, text: typeof evt.result === 'string' ? evt.result : '' };
      break;
    default:
      break;
  }
  return out;
}

function toolResult(id: string, text: string, isError: boolean): StreamRecord {
  return { kind: 'tool_result', payload: { tool_use_id: id, text: clip(text), is_error: isError, truncated: truncated(text) } };
}
const toolUse = (id: string, name: string, input: unknown): StreamRecord => ({ kind: 'tool_use', payload: { id, name, input, parent: null } });

function toolCall(evt: any): StreamRecord[] {
  const id = String(evt.toolCallId ?? evt.callId ?? '');
  const tool = String(evt.tool ?? '');
  const input = evt.input ?? {};
  const result = evt.result ?? {};
  switch (tool) {
    case 'shell': {
      const output = String(result.output ?? result.stdout ?? '');
      return [toolUse(id, 'Bash', { command: String(input.command ?? '') }), toolResult(id, output, (result.exitCode ?? 0) !== 0)];
    }
    case 'read':
      return [toolUse(id, 'Read', { file_path: String(input.path ?? input.file_path ?? '') })];
    case 'write':
      return [toolUse(id, 'Write', { file_path: String(input.path ?? input.file_path ?? ''), content: String(input.content ?? '') })];
    case 'edit': {
      const file_path = String(input.path ?? input.file_path ?? '');
      const edits = Array.isArray(input.edits) ? input.edits : null;
      if (edits && edits.length > 1) return [toolUse(id, 'MultiEdit', { file_path, edits })];
      const e = edits?.[0] ?? { old_string: input.oldString ?? input.old_string ?? '', new_string: input.newString ?? input.new_string ?? '' };
      return [toolUse(id, 'Edit', { file_path, old_string: e.old_string, new_string: e.new_string })];
    }
    case 'grep':
      return [toolUse(id, 'Grep', { pattern: String(input.pattern ?? '') })];
    case 'glob':
      return [toolUse(id, 'Glob', { pattern: String(input.pattern ?? '') })];
    case 'ls':
      return [toolUse(id, 'LS', { path: String(input.path ?? '') })];
    case 'todo':
    case 'todos':
    case 'todoWrite': {
      const todos = (Array.isArray(input.todos) ? input.todos : []).map((t: any) => ({
        content: String(t.content ?? t.text ?? ''),
        status: TODO_STATUS[String(t.status ?? 'pending')] ?? 'pending',
      }));
      return [toolUse(id, 'TodoWrite', { todos })];
    }
    case 'mcp': {
      const name = `mcp__${String(input.server ?? '')}__${String(input.tool ?? input.name ?? '')}`;
      const recs: StreamRecord[] = [toolUse(id, name, input.arguments ?? input.args ?? {})];
      const err = result.error;
      const res = result.result ?? result.output;
      if (err != null || res != null) {
        const text = typeof (err ?? res) === 'string' ? String(err ?? res) : JSON.stringify(err ?? res);
        recs.push(toolResult(id, text, err != null));
      }
      return recs;
    }
    default:
      return [toolUse(id, tool || 'tool', input)];
  }
}
