// Pure translation of one completed `codex app-server` item into Omni's records,
// so a Codex turn renders in the same transcript as a Claude turn. Tool names follow
// Claude Code's, so the existing transcript renderer shows them unchanged.
import type { Record as StreamRecord } from '../../stream.ts';
import type { CodexItem, RateLimits } from './protocol.ts';
import type { Usage } from '../../stream.ts';

/** Codex plan statuses mapped to the TodoWrite ones the checklist renders. */
const PLAN_STATUS: Record<string, string> = {
  pending: 'pending',
  in_progress: 'in_progress',
  running: 'in_progress',
  completed: 'completed',
  done: 'completed',
};

/** Split a unified diff into one edit per hunk: the removed side and the added side. */
export function diffToEdits(diff: string): { old_string: string; new_string: string }[] {
  const edits: { old_string: string; new_string: string }[] = [];
  let oldLines: string[] | null = null;
  let newLines: string[] | null = null;
  const flush = () => {
    if (oldLines || newLines) edits.push({ old_string: (oldLines ?? []).join('\n'), new_string: (newLines ?? []).join('\n') });
    oldLines = newLines = null;
  };
  for (const line of diff.split('\n')) {
    if (line.startsWith('@@')) {
      flush();
      oldLines = [];
      newLines = [];
      continue;
    }
    if (oldLines === null || newLines === null) continue; // preamble (---/+++) before the first hunk
    if (line.startsWith('-')) oldLines.push(line.slice(1));
    else if (line.startsWith('+')) newLines.push(line.slice(1));
    else {
      const ctx = line.startsWith(' ') ? line.slice(1) : line;
      oldLines.push(ctx);
      newLines.push(ctx);
    }
  }
  flush();
  return edits;
}

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

    case 'fileChange':
      return fileChange(item);

    case 'mcpToolCall': {
      const server = String((item as { server?: unknown }).server ?? '');
      const tool = String((item as { tool?: unknown }).tool ?? '');
      const args = (item as { arguments?: unknown }).arguments ?? {};
      const error = (item as { error?: unknown }).error;
      const result = (item as { result?: unknown }).result;
      const recs: StreamRecord[] = [
        { kind: 'tool_use', payload: { id: item.id, name: `mcp__${server}__${tool}`, input: args, parent: null } },
      ];
      if (error != null || result != null) {
        const text = typeof (error ?? result) === 'string' ? String(error ?? result) : JSON.stringify(error ?? result);
        recs.push({ kind: 'tool_result', payload: { tool_use_id: item.id, text: clip(text), is_error: error != null, truncated: truncated(text) } });
      }
      return recs;
    }

    case 'webSearch': {
      const query = String((item as { query?: unknown }).query ?? '');
      const results = (item as { results?: unknown }).results;
      const recs: StreamRecord[] = [{ kind: 'tool_use', payload: { id: item.id, name: 'WebSearch', input: { query }, parent: null } }];
      if (results != null) {
        const text = typeof results === 'string' ? results : JSON.stringify(results);
        recs.push({ kind: 'tool_result', payload: { tool_use_id: item.id, text: clip(text), is_error: false, truncated: truncated(text) } });
      }
      return recs;
    }

    case 'plan': {
      const steps = (item as { steps?: { step?: string; text?: string; status?: string }[] }).steps ?? [];
      const todos = steps.map((s) => ({ content: String(s.step ?? s.text ?? ''), status: PLAN_STATUS[String(s.status ?? 'pending')] ?? 'pending' }));
      return [{ kind: 'tool_use', payload: { id: item.id, name: 'TodoWrite', input: { todos }, parent: null } }];
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

/** A Codex file change to Claude's Write/Edit/MultiEdit rows, or a visible Delete entry. */
function fileChange(item: CodexItem): StreamRecord[] {
  const path = String((item as { path?: unknown }).path ?? '');
  const kind = String((item as { kind?: unknown }).kind ?? 'update');
  if (kind === 'add' || kind === 'create' || kind === 'added') {
    const content = String((item as { content?: unknown }).content ?? '');
    return [{ kind: 'tool_use', payload: { id: item.id, name: 'Write', input: { file_path: path, content }, parent: null } }];
  }
  if (kind === 'delete' || kind === 'deleted' || kind === 'remove') {
    return [{ kind: 'tool_use', payload: { id: item.id, name: 'Delete', input: { file_path: path }, parent: null } }];
  }
  const diff = String((item as { diff?: unknown }).diff ?? '');
  const edits = diffToEdits(diff);
  if (edits.length <= 1) {
    const e = edits[0] ?? { old_string: '', new_string: '' };
    return [{ kind: 'tool_use', payload: { id: item.id, name: 'Edit', input: { file_path: path, old_string: e.old_string, new_string: e.new_string }, parent: null } }];
  }
  return [{ kind: 'tool_use', payload: { id: item.id, name: 'MultiEdit', input: { file_path: path, edits }, parent: null } }];
}

/** A rate-limit snapshot to an Omni usage record: 300-minute window as 5h, 10,080-minute as the week. */
export function normalizeRateLimits(rl: RateLimits): Usage {
  const usage: Usage = { updated_at: new Date().toISOString() };
  if (rl.primary) usage.five_hour = { utilization: rl.primary.usedPercent / 100, resetsAt: rl.primary.resetsAt };
  if (rl.secondary) usage.seven_day = { utilization: rl.secondary.usedPercent / 100, resetsAt: rl.secondary.resetsAt };
  return usage;
}
