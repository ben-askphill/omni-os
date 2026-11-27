// What OpenCode sends over ACP, as Omni's records (spec docs/plans/2026-11-27-opencode-harness.md section 10). Mostly
// Antigravity's reading (antigravity/normalize.ts) of the same protocol, with OpenCode's own spots:
// - An MCP call is named `<server>_<tool>` with kind `other` (probed on 2.3.0), where agy says `mcp_<server>_<tool>`. `adapt`
//   gives the call agy's name for it, so Antigravity's tool rows and permission mapping read it unchanged.
// - A call opens as `pending` with no input yet (a shell call's title is just "shell"): its row waits for the first update that
//   has one, or for its end.
// - Reasoning (agent_thought_chunk) becomes the thinking line, a status record with the latest line of it.
// - The free tier's refusal (`provider.free-limit`, with `retryAfterMs`) is a limit stop with the reset time.
import type { Record as StreamRecord } from '../../stream.ts';
import type { AcpToolCall } from '../antigravity/normalize.ts';

export { allowOption, commandOf, normalizeCommands, outputOf, pathOf, rejectOption, toolEnd, turnUsage, windowOf } from '../antigravity/normalize.ts';

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/**
 * A call as Antigravity's readers expect it: an OpenCode MCP call (`<server>_<tool>`, kind other, a name that starts with
 * one of the session's servers) gets the name `mcp_<server>_<tool>`. Any other call is returned as it came.
 */
export function adapt(call: AcpToolCall, servers: readonly string[]): AcpToolCall {
  const name = str(call.name);
  const kind = str(call.kind);
  if (!name || name.startsWith('mcp_') || (kind && kind !== 'other')) return call;
  const known = servers.some((s) => name.startsWith(`${s}_`) && name.length > s.length + 1);
  return known ? { ...call, name: `mcp_${name}` } : call;
}

/** Whether a call has what its row shows: a shell call its command, an MCP call its arguments, any other call its status past pending. */
export function hasInput(call: AcpToolCall): boolean {
  if (str(call.status) !== 'pending') return true;
  const raw = obj(call.rawInput);
  return str(call.kind) === 'execute' ? typeof raw.command === 'string' : Object.keys(raw).length > 0 && !(Object.keys(raw).length === 1 && 'cwd' in raw);
}

/** The thinking line for a stretch of reasoning: its latest non-empty line, short. Empty when it has none. */
export function thinkingLabel(text: string): string {
  const line = text.split('\n').map((l) => l.trim()).filter(Boolean).at(-1) ?? '';
  const clean = line.replace(/^[*_#>\-\s]+|[*_\s]+$/g, '');
  return clean.length > 140 ? `${clean.slice(0, 137)}...` : clean;
}

/** A status record for the thinking line. An empty text clears it. */
export const status = (text: string): StreamRecord => ({ kind: 'status', payload: { text } });

const FREE_LIMIT = /provider\.free-limit|free usage limit/i;

/**
 * The free tier's limit stop in an error's text or data, with the reset time in epoch seconds when it said how long
 * (`retryAfterMs`). Null when the text is no such refusal.
 */
export function freeLimit(text: string, now = Date.now()): { resets_at: number | null } | null {
  if (!FREE_LIMIT.test(text)) return null;
  const ms = Number(/"?retryAfterMs"?\s*[:=]\s*(\d+)/.exec(text)?.[1]);
  return { resets_at: Number.isFinite(ms) && ms > 0 ? Math.round((now + ms) / 1000) : null };
}

/** A model the account no longer has: OpenCode's `provider.no-route`, or its own "model not found". */
export const noRoute = (text: string) => /provider\.no-route|model not found|unknown model/i.test(text);
