// What agy's permission requests mean to Omni's gate (spec #977, ticket #980). Pure: the adapter hands each
// `session/request_permission` to `callOf` and asks the gate about the answer.
//
// What the real agy 1.5.16 asks about (live check 2026-11-24, every request answered reject_once, then the disk compared):
// execute asks; the file-edit tool does NOT ask (inside or outside the workspace); sub-agents do NOT ask; delete, move,
// fetch and MCP calls were not shown either way; `_meta.antigravity.disabledTools` did not remove the built-in edit
// tools (in this binary it is an MCP server field). So a Read only level is not a promise on agy: the gate judges what
// agy asks about, and the tripwire below stops a turn whose changing call ran unasked.
//
// - read, search, think and fetch only look: they run. edit, delete and move are file edits of their paths. execute is a
//   shell command. An MCP call is `mcp__<server>__<tool>`, so connector levels apply. A sub-agent launch runs only at
//   Full access, since agy does not ask about their own calls. Anything else is an unknown tool, which the
//   gate treats as one that may change things.
// - The tripwire: a changing call that finishes with no request before it ran on agy's own say-so.
import { commandOf, pathOf, type AcpToolCall } from './normalize.ts';
import { readOnlyCommand } from '../../access.ts';

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const first = (o: Record<string, unknown>, keys: string[]) => keys.map((k) => str(o[k])).find(Boolean) ?? '';

/** The tool call a request names. */
export function requestedCall(params: unknown): AcpToolCall {
  return obj(obj(params).toolCall) as AcpToolCall;
}

export type Asked =
  | { type: 'call'; tool: string; input: Record<string, unknown>; edits: boolean }
  | { type: 'subagent'; summary: string };

/** A request as the gate's call, or a sub-agent launch. */
export function callOf(call: AcpToolCall): Asked {
  const kind = str(call.kind);
  const title = str(call.title).trim();
  const raw = obj(call.rawInput);
  if (/\b(start|invoke)_subagent\b/.test(title) || 'subagents' in raw) return { type: 'subagent', summary: title || 'a sub-agent' };
  // A changing kind is never an MCP call, whatever fields its input carries.
  const changing = kind === 'edit' || kind === 'delete' || kind === 'move' || kind === 'execute';
  const server = first(raw, ['server', 'ServerName', 'server_name', 'serverName']);
  const tool = first(raw, ['tool', 'ToolName', 'tool_name', 'toolName']);
  if (!changing && server && tool) return { type: 'call', tool: `mcp__${server}__${tool}`, input: raw, edits: false };
  if (!changing && /^mcp__[^_]+/.test(title)) return { type: 'call', tool: title, input: raw, edits: false };
  if (kind === 'read' || kind === 'search' || kind === 'think') return { type: 'call', tool: 'Read', input: { file_path: pathOf(call) }, edits: false };
  if (kind === 'fetch') return { type: 'call', tool: 'WebFetch', input: raw, edits: false };
  if (kind === 'edit' || kind === 'delete' || kind === 'move') return { type: 'call', tool: 'Edit', input: { file_path: pathOf(call) || title }, edits: true };
  if (!kind || kind === 'execute') return { type: 'call', tool: 'Bash', input: { command: commandOf(raw) ?? title }, edits: false };
  return { type: 'call', tool: title || 'Tool', input: raw, edits: false };
}

/** The tool a finished call should have asked about, or null when running it unasked is no concern. */
export function needsAsk(call: AcpToolCall): string | null {
  const kind = str(call.kind);
  if (kind === 'edit' || kind === 'delete' || kind === 'move') return 'Edit';
  if (!kind || kind === 'execute') {
    // agy may run a command it knows only reads without asking: that changes nothing.
    const command = commandOf(call.rawInput) ?? str(call.title);
    return readOnlyCommand(command) ? null : 'Bash';
  }
  return null;
}
