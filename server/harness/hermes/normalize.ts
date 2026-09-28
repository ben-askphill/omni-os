// Pure translation of Hermes run events into Omni records, so a Hermes turn renders
// in the same transcript as a Claude turn. Deltas of one assistant message accumulate
// and flush as a single bubble (one record per token would be one bubble each).
// Reasoning is dropped, the way Cursor's thinking is. Tool names follow Claude Code's
// where the transcript already knows how to render them.
import type { Record as StreamRecord } from '../../stream.ts';
import type { HermesRun, HermesRuntime, HermesUsage } from './client.ts';

const MAX_RESULT = 16_000;
const clip = (s: string) => (s.length > MAX_RESULT ? s.slice(0, MAX_RESULT) : s);
const truncated = (s: string) => s.length > MAX_RESULT;

const DISPLAY: Record<string, string> = {
  terminal: 'Bash',
  shell: 'Bash',
  bash: 'Bash',
  read: 'Read',
  read_file: 'Read',
  write: 'Write',
  write_file: 'Write',
  edit: 'Edit',
  grep: 'Grep',
  search: 'Grep',
  glob: 'Glob',
  web_search: 'WebSearch',
  web_fetch: 'WebFetch',
};

export interface HermesNormState {
  /** Starts not yet matched to a completion, oldest first. `tool` is the server's name. */
  open: { id: string; tool: string }[];
  /** Token deltas of the current assistant message. */
  delta: string;
  /** Assistant text already emitted, so a terminal output does not repeat it. */
  emitted: string;
  seq: number;
}

export const emptyHermesNorm = (): HermesNormState => ({ open: [], delta: '', emitted: '', seq: 0 });

const clone = (s: HermesNormState): HermesNormState => ({ ...s, open: s.open.slice() });

type Raw = Record<string, unknown>;

const asObj = (v: unknown): Raw | null => (v && typeof v === 'object' ? (v as Raw) : null);

const str = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : typeof v === 'number' || typeof v === 'boolean' ? String(v) : '');

/** Pull a human-readable tool result out of Hermes' preview, which may be JSON text. */
export function previewText(preview: unknown): string {
  if (preview == null) return '';
  if (typeof preview === 'string') {
    const t = preview.trim();
    if (t.startsWith('{') || t.startsWith('[')) {
      try {
        return previewText(JSON.parse(t));
      } catch {
        return preview;
      }
    }
    return preview;
  }
  const o = asObj(preview);
  if (!o) return String(preview);
  if (typeof o.output === 'string') return o.output;
  if (o.output != null) return JSON.stringify(o.output);
  return JSON.stringify(preview);
}

function toolId(state: HermesNormState, evt: Raw): string {
  const seq = typeof evt.seq === 'number' ? evt.seq : state.seq++;
  return `hermes-${str(evt.run_id) || 'run'}-${seq}`;
}

function displayName(tool: string): string {
  return DISPLAY[tool] ?? (tool || 'tool');
}

function toolInput(tool: string, preview: unknown): Record<string, unknown> {
  const name = displayName(tool);
  const text = typeof preview === 'string' ? preview : previewText(preview);
  if (name === 'Bash') return { command: text };
  if (name === 'Read' || name === 'Write' || name === 'Edit' || name === 'Glob') return { file_path: text, path: text };
  if (name === 'Grep') return { pattern: text };
  if (name === 'WebSearch') return { query: text };
  if (name === 'WebFetch') return { url: text };
  const parsed = asObj(preview) ?? (typeof preview === 'string' && preview.trim().startsWith('{') ? asObj(safeParse(preview)) : null);
  if (parsed) return parsed;
  return text ? { preview: text } : {};
}

const safeParse = (s: string): unknown => {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
};

const toolUse = (id: string, name: string, input: unknown): StreamRecord => ({ kind: 'tool_use', payload: { id, name, input, parent: null } });

function toolResult(id: string, text: string, isError: boolean): StreamRecord {
  return { kind: 'tool_result', payload: { tool_use_id: id, text: clip(text), is_error: isError, truncated: truncated(text) } };
}

function takeOpen(state: HermesNormState, tool: string): string | null {
  for (let i = state.open.length - 1; i >= 0; i--) {
    if (state.open[i].tool === tool || !tool) {
      const [hit] = state.open.splice(i, 1);
      return hit.id;
    }
  }
  return null;
}

/** Emit buffered deltas once. `prefer` (a completed output or interim text) wins over the buffer. */
function flushText(state: HermesNormState, prefer?: string): StreamRecord[] {
  const buffered = state.delta;
  state.delta = '';
  const text = prefer && prefer.trim() ? prefer : buffered;
  if (!text || !text.trim()) return [];
  if (text === state.emitted || text.trim() === state.emitted.trim()) return [];
  state.emitted = text;
  return [{ kind: 'assistant_text', payload: { text } }];
}

function usageOf(v: unknown): HermesUsage | undefined {
  const o = asObj(v);
  if (!o) return undefined;
  return o as HermesUsage;
}

function runtimeOf(v: unknown): HermesRuntime | undefined {
  const o = asObj(v);
  if (!o) return undefined;
  return o as HermesRuntime;
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function resultRecord(ok: boolean, subtype: string, output: string, evt: Raw): StreamRecord {
  const usage = usageOf(evt.usage);
  const model = str(runtimeOf(evt.runtime)?.model);
  const input = num(usage?.input_tokens);
  const outputTokens = num(usage?.output_tokens);
  const cacheRead = num(usage?.cache_read_tokens);
  const cacheWrite = num(usage?.cache_write_tokens);
  return {
    kind: 'result',
    payload: {
      ok,
      subtype,
      turns: 1,
      ...(output ? { text: output } : {}),
      ...(model ? { model } : {}),
      ...(input != null ? { input_tokens: input } : {}),
      ...(outputTokens != null ? { output_tokens: outputTokens } : {}),
      ...(cacheRead != null ? { cache_read_tokens: cacheRead } : {}),
      ...(cacheWrite != null ? { cache_write_tokens: cacheWrite } : {}),
    },
  };
}

function approvalText(evt: Raw): string {
  const tool = str(evt.tool);
  const extra = str(evt.preview ?? evt.command ?? evt.prompt);
  return `Approval requested${tool ? `: ${tool}` : ''}${extra ? ` — ${extra}` : ''}`;
}

export interface HermesApplied {
  state: HermesNormState;
  records: StreamRecord[];
  /** A terminal run.* event. The stream closes after one of these. */
  done: boolean;
}

/**
 * One Hermes event. Unknown names are ignored: the server adds events without a client release.
 * `state` is not mutated.
 */
export function applyHermesEvent(prev: HermesNormState, raw: unknown): HermesApplied {
  const state = clone(prev);
  const evt = asObj(raw);
  if (!evt) return { state, records: [], done: false };
  const name = str(evt.event);
  const records: StreamRecord[] = [];
  let done = false;

  const boundary = () => {
    records.push(...flushText(state));
  };

  switch (name) {
    case 'message.delta':
      state.delta += str(evt.delta);
      break;
    case 'message.interim': {
      // already_streamed means the deltas were this same text; don't write it twice.
      if (evt.already_streamed) records.push(...flushText(state));
      else {
        state.delta = '';
        records.push(...flushText(state, str(evt.text)));
      }
      break;
    }
    case 'message.started':
    case 'reasoning.available':
    case 'run.steered':
    case 'tool.progress':
      // Reasoning stays out of the transcript. Progress would be a status per tick.
      break;
    case 'run.queued':
      records.push({ kind: 'status', payload: { text: 'Queued on Hermes' } });
      break;
    case 'run.stopping':
      records.push({ kind: 'status', payload: { text: 'Stopping' } });
      break;
    case 'run.started':
      break;
    case 'tool.started': {
      boundary();
      const tool = str(evt.tool);
      const id = toolId(state, evt);
      state.open.push({ id, tool });
      records.push(toolUse(id, displayName(tool), toolInput(tool, evt.preview)));
      break;
    }
    case 'tool.completed':
    case 'tool.failed': {
      boundary();
      const tool = str(evt.tool);
      // A completion with no start (the replay began mid-tool) still needs a row to attach to.
      let id = takeOpen(state, tool);
      if (!id) {
        id = toolId(state, evt);
        records.push(toolUse(id, displayName(tool), toolInput(tool, evt.preview)));
      }
      const isError = name === 'tool.failed' || evt.error === true;
      const errText = typeof evt.error === 'string' ? evt.error : '';
      const text = name === 'tool.failed' ? errText || previewText(evt.preview) : previewText(evt.preview) || errText;
      records.push(toolResult(id, text, isError));
      break;
    }
    case 'subagent.start': {
      boundary();
      const id = toolId(state, evt);
      state.open.push({ id, tool: 'subagent' });
      records.push(
        toolUse(id, 'Agent', {
          description: str(evt.task ?? evt.name ?? evt.description ?? 'subagent'),
          prompt: str(evt.prompt ?? evt.summary ?? ''),
        }),
      );
      break;
    }
    case 'subagent.complete': {
      boundary();
      let id = takeOpen(state, 'subagent');
      const summary = str(evt.summary ?? evt.status);
      const failed = evt.status === 'failed' || evt.status === 'error';
      if (!id) {
        id = toolId(state, evt);
        records.push(toolUse(id, 'Agent', { description: str(evt.name ?? 'subagent'), prompt: '' }));
      }
      records.push(toolResult(id, summary, failed));
      break;
    }
    case 'approval.request':
      // Full approval UI is out of scope; the transcript shows that Hermes is waiting.
      records.push({ kind: 'status', payload: { text: approvalText(evt) } });
      break;
    case 'approval.responded':
      records.push({ kind: 'status', payload: { text: `Approval ${str(evt.decision ?? evt.status ?? 'responded')}` } });
      break;
    case 'run.completed': {
      const output = str(evt.output);
      records.push(...flushText(state, output));
      records.push(resultRecord(true, 'success', output, evt));
      done = true;
      break;
    }
    case 'run.failed': {
      records.push(...flushText(state));
      const error = str(evt.error) || 'Hermes run failed';
      records.push({ kind: 'error', payload: { text: error } });
      records.push(resultRecord(false, 'error', '', evt));
      done = true;
      break;
    }
    case 'run.cancelled':
      records.push(...flushText(state));
      records.push(resultRecord(false, 'cancelled', '', evt));
      done = true;
      break;
    case 'run.interrupted':
      records.push(...flushText(state));
      records.push(resultRecord(false, 'interrupted', '', evt));
      done = true;
      break;
    default:
      break;
  }
  return { state, records, done };
}

/** The GET /v1/runs/{id} body, as the event the stream would have ended with. Null while still running. */
export function eventFromRun(run: HermesRun): Raw | null {
  switch (run.status) {
    case 'completed':
      return { event: 'run.completed', output: run.output ?? '', usage: run.usage, runtime: run.runtime };
    case 'failed':
      return { event: 'run.failed', error: run.error ?? (typeof run.last_event === 'string' ? run.last_event : 'Hermes run failed') };
    case 'cancelled':
      return { event: 'run.cancelled' };
    case 'interrupted':
      return { event: 'run.interrupted' };
    default:
      return null;
  }
}
