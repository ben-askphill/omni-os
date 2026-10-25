// Pure translation of `cursor-agent -p --output-format stream-json` events into Omni's
// records, so a Cursor turn renders in the same transcript as a Claude turn. Cursor's echo
// of the user message and its thinking are dropped (Omni already stores Ben's own text).
// Tool names follow Claude Code's so the transcript renders them unchanged.
import { cursorTurnUsage, type CursorTurnUsage } from '@omni/shared/context-meter.ts';
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
  /** The terminal result's token counts, summed over every model call in the turn. */
  usage?: CursorTurnUsage;
  /** The model call an assistant or tool event belongs to. The call that writes the final answer carries none. */
  modelCallId?: string;
  /** An assistant event with no model call id: the turn's last, tool-free call. */
  untaggedReply?: boolean;
}

/**
 * Counts the model calls in one turn, so the meter knows whether the result's summed usage is one prompt or
 * several. Each call that ran tools tags its events with a model_call_id; the call that writes the final reply
 * tags none, and a turn with no tools tags nothing at all.
 */
export class CursorCallCounter {
  private ids = new Set<string>();
  private untagged = false;

  note(p: CursorParsed) {
    if (p.modelCallId) this.ids.add(p.modelCallId);
    if (p.untaggedReply) this.untagged = true;
  }

  get calls(): number {
    return this.ids.size + (this.untagged || this.ids.size === 0 ? 1 : 0);
  }
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
  if (typeof evt.model_call_id === 'string' && evt.model_call_id) out.modelCallId = evt.model_call_id;
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
      if (!out.modelCallId) out.untaggedReply = true;
      break;
    }
    case 'tool_call':
      if (evt.tool_call && typeof evt.tool_call === 'object') {
        out.records.push(...nestedToolCall(evt));
        break;
      }
      if (evt.subtype === 'completed' || evt.subtype === 'failed') {
        out.records.push(...toolCall(evt));
        const result = evt.result;
        const failed = evt.subtype === 'failed' || !!evt.error || result?.isError === true || result?.is_error === true ||
          !!result?.error || result?.success === false || result?.status === 'failed' || result?.result?.isError === true;
        if (failed) {
          const existing = out.records.find((r) => r.kind === 'tool_result');
          if (existing?.kind === 'tool_result') existing.payload.is_error = true;
          else out.records.push(toolResult(String(evt.toolCallId ?? evt.callId ?? ''), 'Tool reported failure.', true));
        }
      }
      break;
    case 'result':
      out.sessionId = evt.session_id ?? out.sessionId;
      out.result = { ok: evt.subtype === 'success' && !evt.is_error, text: typeof evt.result === 'string' ? evt.result : '' };
      out.usage = cursorTurnUsage(evt.usage);
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
      const failed = (result.exitCode ?? 0) !== 0;
      return [toolUse(id, 'Bash', { command: String(input.command ?? '') }), toolResult(id, failed ? `Exit code ${result.exitCode}\n${output}` : output, failed)];
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
      const err = result.error || undefined;
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

/** Cursor's live protobuf JSON envelope. Legacy flat events above remain completion-only. */
function nestedToolCall(evt: any): StreamRecord[] {
  const entry = Object.entries(evt.tool_call).find(([key]) => key.endsWith('ToolCall'));
  if (!entry) return [];
  const [key, value] = entry as [string, any];
  // Cursor joins its call id and function-call id with a newline. The first is shared by both events.
  const id = String(evt.call_id ?? evt.toolCallId ?? evt.callId ?? '').split('\n')[0];
  const input = value?.args ?? {};
  if (evt.subtype === 'started') {
    const kind = key.slice(0, -'ToolCall'.length);
    const aliases: Record<string, string> = { updateTodos: 'todos' };
    const tool = aliases[kind] ?? kind;
    // Reuse the flat adapter's Claude names without emitting any of its completion records.
    const mapped = {
      ...input,
      command: input.command ?? input.path,
      pattern: input.pattern ?? input.globPattern ?? input.path,
      content: input.content ?? input.fileText,
      server: input.server ?? input.providerIdentifier,
      tool: input.tool ?? input.toolName ?? input.name,
    };
    const use = toolCall({ toolCallId: id, tool, input: mapped })[0];
    if (use.kind === 'tool_use' && use.payload.name === tool) {
      // New Cursor kinds keep their raw args and a readable name, never an anonymous "tool" row.
      return [toolUse(id, kind.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase()), input)];
    }
    if (use.kind === 'tool_use' && ['Grep', 'Glob'].includes(use.payload.name)) {
      use.payload.input = { ...input, pattern: mapped.pattern ?? '' };
    }
    return [use];
  }
  if (evt.subtype !== 'completed' && evt.subtype !== 'failed') return [];
  // Documented at docs.cursor.com/en/cli/reference/output-format. The installed CLI also emits
  // shell result.failure/timeout/rejected/spawnError/permissionDenied alongside result.success.
  const result = value?.result ?? evt.result;
  const failure = result?.error || result?.failure || result?.timeout || result?.rejected || result?.spawnError || result?.permissionDenied;
  const body = failure || result?.success || result;
  const failed = evt.subtype === 'failed' || !!evt.error || !!failure || body?.isError === true || body?.is_error === true ||
    !!body?.error || result?.success === false || body?.status === 'failed' || (body?.exitCode != null && body.exitCode !== 0);
  let text = resultText(evt.error || body);
  if (body?.exitCode != null && body.exitCode !== 0) text = `Exit code ${body.exitCode}\n${text}`;
  return [toolResult(id, text || (failed ? 'Tool reported failure.' : ''), failed)];
}

function resultText(result: any): string {
  if (result == null) return '';
  if (typeof result === 'string') return result;
  if (result.stdout != null || result.stderr != null) return [result.stdout, result.stderr].filter(Boolean).join('\n');
  if (result.error) return resultText(result.error);
  if (result.content != null) return typeof result.content === 'string' ? result.content : textOf(result.content) || JSON.stringify(result.content);
  if (result.output != null) return resultText(result.output);
  if (result.errorMessage != null) return String(result.errorMessage);
  if (result.reason != null) return String(result.reason);
  if (result.result != null) return resultText(result.result);
  return JSON.stringify(result);
}
