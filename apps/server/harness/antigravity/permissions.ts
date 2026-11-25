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
//   shell command. An MCP call is read from agy's own call name (`mcp_<server>_<tool>`) as `mcp__<server>__<tool>`, so
//   connector levels apply. A sub-agent launch runs only at
//   Full access, since agy does not ask about their own calls. Anything else is an unknown tool, which the
//   gate treats as one that may change things.
// - The tripwire: any call but a read, search or think that ends (completed or failed) with no request before it ran on
//   agy's own say-so, a read-only shell command aside.
import { commandOf, mcpName, pathOf, type AcpToolCall } from './normalize.ts';
import { OMNI_SERVERS } from '@omni/shared/access.ts';
import { readOnlyCommand } from '../../access.ts';

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** The tool call a request names. */
export function requestedCall(params: unknown): AcpToolCall {
  return obj(obj(params).toolCall) as AcpToolCall;
}

export type Asked =
  | { type: 'call'; tool: string; input: Record<string, unknown>; edits: boolean }
  | { type: 'subagent'; summary: string };

/** An MCP call's `mcp__<server>__<tool>` name, from agy's own call name (the title's last word when a request has no name). */
const mcpOf = (call: AcpToolCall, servers: readonly string[]): string | null =>
  mcpName(call.name, servers) ?? mcpName(str(call.title).trim().split(/\s+/).at(-1), servers);

/** A request as the gate's call, or a sub-agent launch. `servers` names the session's MCP servers. */
export function callOf(call: AcpToolCall, servers: readonly string[] = []): Asked {
  const kind = str(call.kind);
  const title = str(call.title).trim();
  const raw = obj(call.rawInput);
  if (/\b(start|invoke)_subagent\b/.test(title) || 'subagents' in raw) return { type: 'subagent', summary: title || 'a sub-agent' };
  // A changing kind is never an MCP call, whatever its name or input says. An MCP call is read from its own name:
  // its input is the tool's arguments, which may carry any field.
  const changing = !kind || kind === 'edit' || kind === 'delete' || kind === 'move' || kind === 'execute';
  const mcp = changing ? null : mcpOf(call, servers);
  if (mcp) return { type: 'call', tool: mcp, input: raw, edits: false };
  if (kind === 'read' || kind === 'search' || kind === 'think') return { type: 'call', tool: 'Read', input: { file_path: pathOf(call) }, edits: false };
  if (kind === 'fetch') return { type: 'call', tool: 'WebFetch', input: raw, edits: false };
  if (kind === 'edit' || kind === 'delete' || kind === 'move') return { type: 'call', tool: 'Edit', input: { file_path: pathOf(call) || title }, edits: true };
  if (!kind || kind === 'execute') return { type: 'call', tool: 'Bash', input: { command: commandOf(raw) ?? title }, edits: false };
  return { type: 'call', tool: title || 'Tool', input: raw, edits: false };
}

/**
 * The tool a finished call should have asked about, or null when running it unasked is no concern: file edits, shell
 * commands that may change things, MCP calls, fetches and any other tool. Only reading and thinking run free.
 */
export function needsAsk(call: AcpToolCall, servers: readonly string[] = []): string | null {
  const kind = str(call.kind);
  if (kind === 'edit' || kind === 'delete' || kind === 'move') return 'Edit';
  if (!kind || kind === 'execute') {
    // agy may run a command it knows only reads without asking: that changes nothing.
    const command = commandOf(call.rawInput) ?? str(call.title);
    return readOnlyCommand(command) ? null : 'Bash';
  }
  if (kind === 'read' || kind === 'search' || kind === 'think') return null;
  if (kind === 'fetch') return 'WebFetch';
  const asked = callOf(call, servers);
  if (asked.type === 'subagent') return 'a sub-agent';
  // The gate allows Omni's own tools at every level, so running one unasked changes nothing.
  const own = /^mcp__([^_]+(?:_[^_]+)*?)__/.exec(asked.tool)?.[1];
  return own && OMNI_SERVERS.has(own) ? null : asked.tool;
}
