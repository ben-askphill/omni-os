// Pure translation of one completed `codex app-server` item into Omni's records,
// so a Codex turn renders in the same transcript as a Claude turn. Tool names follow
// Claude Code's, so the existing transcript renderer shows them unchanged.
//
// This slice (#8) covers agent messages and command executions. File edits, MCP calls,
// web searches and plan updates arrive with the transcript slice (#9).
import type { Record as StreamRecord } from '../../stream.ts';
import type { CodexItem, RateLimits } from './protocol.ts';
import type { Usage } from '../../stream.ts';

const MAX_RESULT = 16_000;
const clip = (s: string) => (s.length > MAX_RESULT ? s.slice(0, MAX_RESULT) : s);
const truncated = (s: string) => s.length > MAX_RESULT;

const asCommand = (c: string | string[]) => (Array.isArray(c) ? c.join(' ') : c);

/**
 * One completed Codex item to zero or more Omni records. Reasoning items drop out, the same
 * as for Claude. Unknown item kinds pass through as a tool row under their own name.
 */
export function normalizeItem(item: CodexItem): StreamRecord[] {
  switch (item.type) {
    case 'reasoning':
    case 'userMessage':
    case 'contextCompaction':
      // Reasoning/thinking is dropped as for Claude; the user echo is dropped because Omni already
      // stores Ben's own text without the added context.
      return [];

    case 'agentMessage': {
      const text = String((item as { text?: unknown }).text ?? '');
      return text.trim() ? [{ kind: 'assistant_text', payload: { text } }] : [];
    }

    case 'commandExecution': {
      const command = asCommand((item as { command?: string | string[] }).command ?? '');
      const out = String((item as { aggregatedOutput?: unknown; output?: unknown }).aggregatedOutput ?? (item as { output?: unknown }).output ?? '');
      const exitCode = (item as { exitCode?: number }).exitCode ?? 0;
      return [
        { kind: 'tool_use', payload: { id: item.id, name: 'Bash', input: { command }, parent: null } },
        { kind: 'tool_result', payload: { tool_use_id: item.id, text: clip(out), is_error: exitCode !== 0, truncated: truncated(out) } },
      ];
    }

    default:
      // Anything Omni doesn't recognise still shows, under its own name, with its raw input.
      return [
        { kind: 'tool_use', payload: { id: item.id, name: String(item.type), input: rawInput(item), parent: null } },
      ];
  }
}

function rawInput(item: CodexItem): Record<string, unknown> {
  const { id: _id, type: _type, ...rest } = item;
  return rest;
}

/** A rate-limit snapshot to an Omni usage record: 300-minute window as 5h, 10,080-minute as the week. */
export function normalizeRateLimits(rl: RateLimits): Usage {
  const usage: Usage = { updated_at: new Date().toISOString() };
  if (rl.primary) usage.five_hour = { utilization: rl.primary.usedPercent / 100, resetsAt: rl.primary.resetsAt };
  if (rl.secondary) usage.seven_day = { utilization: rl.secondary.usedPercent / 100, resetsAt: rl.secondary.resetsAt };
  return usage;
}
