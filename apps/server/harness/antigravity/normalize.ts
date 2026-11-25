// What agy sends over ACP, as Omni's records (spec #977, ticket #979). Pure: the adapter feeds it each
// `session/update` and each prompt answer.
//
// - A tool call is a row: a command is `Bash`, a file change `Edit`, a read `Read`. A call with no kind is a command.
//   agy names the command's field in four casings (CommandLine, command_line, commandLine, command).
// - A plan is a TodoWrite row, which drives the thread's checklist. So is a call to agy's own checklist tool
//   (update_steps), which agy's prompt has the agent keep its steps in.
// - Reasoning (agent_thought_chunk) is never kept: the adapter only reads that it arrived, for the thinking line.
// - A turn ends by its stop reason: end_turn is done, cancelled is stopped, refusal is a limit stop, anything else
//   fails the turn. An agent message that names QUOTA_EXHAUSTED is a limit stop with the reset time agy gave.
import { isCommandName, type SlashCommand } from '@omni/shared/slash.ts';
import type { CursorTurnUsage } from '@omni/shared/context-meter.ts';
import type { Record as StreamRecord } from '../../stream.ts';
import { toolResult } from '../tool-result.ts';

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** A tool call or update as agy sends it. */
export interface AcpToolCall {
  toolCallId?: unknown;
  title?: unknown;
  kind?: unknown;
  status?: unknown;
  /** An MCP call's own name, `mcp_<server>_<tool>` (agy 1.5.16), with its input also in `args`. */
  name?: unknown;
  args?: unknown;
  rawInput?: unknown;
  rawOutput?: unknown;
  content?: unknown;
  locations?: unknown;
}

/** The command a call runs, from whichever casing agy used. */
export function commandOf(raw: unknown): string | null {
  const o = obj(raw);
  for (const key of ['CommandLine', 'command_line', 'commandLine', 'command']) {
    const v = o[key];
    if (typeof v === 'string' && v.trim()) return v;
    if (Array.isArray(v) && v.length) return v.map(String).join(' ');
  }
  return null;
}

/** The file a call works on: its first location, else a path field of its input. */
export function pathOf(call: AcpToolCall): string {
  const loc = Array.isArray(call.locations) ? str(obj(call.locations[0]).path) : '';
  if (loc) return loc;
  const o = obj(call.rawInput);
  for (const key of ['TargetFile', 'target_file', 'AbsolutePath', 'file_path', 'filePath', 'path', 'Path']) if (str(o[key])) return str(o[key]);
  return '';
}

/**
 * An MCP call's name the way every harness's transcript has it, `mcp__<server>__<tool>`, from agy's `mcp_<server>_<tool>`
 * (probed on 1.5.16: kind `other`, the same name as the title's last word). Omni's own server names have dashes and
 * their tools underscores, so the split is at the first underscore after the known server names, else after the first.
 * Null when the call is no MCP call.
 */
export function mcpName(raw: unknown, servers: readonly string[] = []): string | null {
  const name = str(raw);
  if (!name.startsWith('mcp_') || name.startsWith('mcp__')) return null;
  const rest = name.slice(4);
  const known = [...servers].sort((a, b) => b.length - a.length).find((s) => rest.startsWith(`${s}_`) && rest.length > s.length + 1);
  if (known) return `mcp__${known}__${rest.slice(known.length + 1)}`;
  const at = rest.indexOf('_');
  return at > 0 && at < rest.length - 1 ? `mcp__${rest.slice(0, at)}__${rest.slice(at + 1)}` : null;
}

/**
 * agy's own checklist tool (1.5.17, probed 2026-11-25): a call named `update_steps` (kind other, title "Run
 * update_steps") whose input is the whole list as `{title, status}` steps. agy asks for no permission to run it. Its
 * own prompt tells the agent to keep its steps there, so an agent on agy often does instead of calling set_steps.
 */
export const STEPS_TOOL = 'update_steps';

/** update_steps statuses as TodoWrite's. A skipped step is settled; a failed one is not done. */
const STEP_STATUS: Record<string, 'pending' | 'in_progress' | 'completed'> = { pending: 'pending', in_progress: 'in_progress', done: 'completed', skipped: 'completed' };

/** An update_steps list as TodoWrite's todos. */
const stepTodos = (steps: unknown) =>
  (Array.isArray(steps) ? steps : []).map((s) => ({ content: str(obj(s).title), status: STEP_STATUS[str(obj(s).status)] ?? 'pending' })).filter((t) => t.content);

/** The row a tool call opens. Null for a call that is only agy thinking out loud. `servers` names the session's MCP servers. */
export function toolUse(call: AcpToolCall, servers: readonly string[] = []): StreamRecord | null {
  const id = str(call.toolCallId);
  if (!id) return null;
  const title = str(call.title).trim();
  const kind = str(call.kind);
  const use = (name: string, input: unknown): StreamRecord => ({ kind: 'tool_use', payload: { id, name, input, parent: null } });
  if (kind === 'think') return null;
  // agy's checklist is the thread's step list, as a plan is: read from agy's own call name only, never the title.
  if (str(call.name) === STEPS_TOOL) return use('TodoWrite', { todos: stepTodos(obj(call.rawInput ?? call.args).steps) });
  const mcp = mcpName(call.name, servers);
  if (mcp) {
    // agy adds a one-line summary of its own to an MCP call's input; the server never saw it.
    const { toolSummary: _summary, ...input } = obj(call.rawInput ?? call.args);
    return use(mcp, input);
  }
  if (!kind || kind === 'execute') return use('Bash', { command: commandOf(call.rawInput) ?? title, ...(title && commandOf(call.rawInput) ? { description: title } : {}) });
  if (kind === 'edit' || kind === 'delete' || kind === 'move') return use('Edit', { file_path: pathOf(call) || title });
  if (kind === 'read') return use('Read', { file_path: pathOf(call) || title });
  if (kind === 'search') return use('Grep', { pattern: title });
  if (kind === 'fetch') return use('WebFetch', { url: str(obj(call.rawInput).url) || str(obj(call.rawInput).Url) || title });
  return use(title || 'Tool', call.rawInput ?? {});
}

/** A call's output: its text content, else its raw output. */
export function outputOf(call: AcpToolCall): string {
  const parts: string[] = [];
  for (const c of Array.isArray(call.content) ? call.content : []) {
    const o = obj(c);
    if (o.type === 'content') {
      const inner = obj(o.content);
      if (inner.type === 'text' && str(inner.text)) parts.push(str(inner.text));
    }
  }
  if (parts.length) return parts.join('\n');
  const raw = call.rawOutput;
  if (typeof raw === 'string') return raw;
  const o = obj(raw);
  for (const key of ['output', 'stdout', 'text', 'result']) if (str(o[key])) return str(o[key]);
  return '';
}

/** The row a finished call ends with. Null while it runs. */
export function toolEnd(call: AcpToolCall): StreamRecord | null {
  const id = str(call.toolCallId);
  const status = str(call.status);
  if (!id || (status !== 'completed' && status !== 'failed')) return null;
  return toolResult(id, outputOf(call), status === 'failed');
}

const PLAN_STATUS: Record<string, 'pending' | 'in_progress' | 'completed'> = { pending: 'pending', in_progress: 'in_progress', completed: 'completed' };

/** agy's plan as a TodoWrite row and its (empty) result. */
export function planRecords(entries: unknown, id: string): StreamRecord[] {
  const todos = (Array.isArray(entries) ? entries : []).map((e) => ({ content: str(obj(e).content), status: PLAN_STATUS[str(obj(e).status)] ?? 'pending' })).filter((t) => t.content);
  return [{ kind: 'tool_use', payload: { id, name: 'TodoWrite', input: { todos }, parent: null } }, toolResult(id, '', false)];
}

/** agy's available_commands_update as the thread's `/` menu. */
export function normalizeCommands(raw: unknown): SlashCommand[] {
  const out: SlashCommand[] = [];
  const seen = new Set<string>();
  for (const c of Array.isArray(raw) ? raw : []) {
    const o = obj(c);
    const name = str(o.name).replace(/^\//, '');
    if (!isCommandName(name) || seen.has(name)) continue;
    seen.add(name);
    const hint = str(obj(o.input).hint);
    out.push({ name, description: str(o.description).replace(/\s+/g, ' ').trim(), ...(hint && { argumentHint: hint }), source: 'builtin', mentionable: false });
  }
  return out;
}

/** A finished turn's tokens: input plus cached reads, output plus thought tokens. Undefined when agy gave no counts. */
export function turnUsage(usage: unknown): CursorTurnUsage | undefined {
  const u = obj(usage);
  const n = (k: string) => (typeof u[k] === 'number' && Number.isFinite(u[k]) ? (u[k] as number) : 0);
  const input = n('inputTokens') + n('cachedReadTokens');
  const output = n('outputTokens') + n('thoughtTokens');
  if (!input && !output) return undefined;
  return { inputTokens: input, outputTokens: output, cacheReadTokens: 0, cacheWriteTokens: 0 };
}

/** agy's usage_update: the tokens in the window and the window, when it says both. */
export function windowOf(update: unknown): { used: number; size: number } | null {
  const o = obj(update);
  const used = Number(o.used);
  const size = Number(o.size);
  return Number.isFinite(used) && used >= 0 && Number.isFinite(size) && size > 0 ? { used, size } : null;
}

const QUOTA = /QUOTA_EXHAUSTED|quota[_ ]exhausted/i;

/**
 * A quota stop in a message agy printed as its reply, with the reset time in epoch seconds when it gave one
 * (quotaResetTimeStamp, else quotaResetDelay from now). Null when the text is no quota error. A 429 or
 * RESOURCE_EXHAUSTED that names no quota reason is a rate limit, not this.
 */
export function quotaLimit(text: string, now = Date.now()): { resets_at: number | null } | null {
  if (!QUOTA.test(text)) return null;
  const stamp = /"?quotaResetTimeStamp"?\s*[:=]\s*"?([0-9T:.\-+Z]+)"?/.exec(text)?.[1];
  const at = stamp ? Date.parse(stamp) : NaN;
  if (Number.isFinite(at)) return { resets_at: Math.round(at / 1000) };
  const delay = /"?quotaResetDelay"?\s*[:=]\s*"?(\d+(?:\.\d+)?)s/.exec(text)?.[1];
  if (delay) return { resets_at: Math.round(now / 1000 + Number(delay)) };
  return { resets_at: null };
}

/** A message that is agy's own error about rate limiting, with no quota reason. */
export const isRateLimit = (text: string) => !QUOTA.test(text) && /\b429\b|RESOURCE_EXHAUSTED/.test(text);

/** The question an `interaction_` permission request asks, with agy's options. Null when it is no such request. */
export function interaction(params: unknown): { title: string; options: { id: string; label: string }[] } | null {
  const p = obj(params);
  const call = obj(p.toolCall);
  if (!str(call.toolCallId).startsWith('interaction_')) return null;
  const options = (Array.isArray(p.options) ? p.options : []).map((o) => ({ id: str(obj(o).optionId), label: str(obj(o).name).trim() })).filter((o) => o.id && o.label);
  const title = str(call.title).trim() || str(obj(call.rawInput).question).trim();
  return title && options.length >= 2 ? { title, options } : null;
}

/** The option of an ordinary permission request that allows the call once, else the first allow. */
export function allowOption(params: unknown): string | null {
  const options = (Array.isArray(obj(params).options) ? (obj(params).options as unknown[]) : []).map(obj);
  return str((options.find((o) => o.kind === 'allow_once') ?? options.find((o) => str(o.kind).startsWith('allow')))?.optionId) || null;
}

/** The option that refuses the call, when agy offers one. */
export function rejectOption(params: unknown): string | null {
  const options = (Array.isArray(obj(params).options) ? (obj(params).options as unknown[]) : []).map(obj);
  return str((options.find((o) => o.kind === 'reject_once') ?? options.find((o) => str(o.kind).startsWith('reject')))?.optionId) || null;
}
