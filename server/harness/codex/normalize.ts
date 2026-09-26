// Pure translation of one completed `codex app-server` item into Omni's records,
// so a Codex turn renders in the same transcript as a Claude turn. Tool names follow
// Claude Code's, so the existing transcript renderer shows them unchanged.
import type { Record as StreamRecord } from '../../stream.ts';
import type { CodexItem, PlanUpdate, RateLimitWindow, RateLimits } from './protocol.ts';
import type { Usage } from '../../stream.ts';

/** Codex plan statuses mapped to the TodoWrite ones the checklist renders. */
const PLAN_STATUS: Record<string, string> = {
  pending: 'pending',
  inProgress: 'in_progress',
  completed: 'completed',
};

/** The rate-limit bucket that is the ChatGPT plan. Codex also reports others, e.g. a reserve model's. */
export const PLAN_LIMIT_ID = 'codex';

/** Split a unified diff into one edit per hunk: the removed side and the added side. */
export function diffToEdits(diff: string): { old_string: string; new_string: string }[] {
  const edits: { old_string: string; new_string: string }[] = [];
  let oldLines: string[] | null = null;
  let newLines: string[] | null = null;
  const flush = () => {
    if (oldLines || newLines) edits.push({ old_string: (oldLines ?? []).join('\n'), new_string: (newLines ?? []).join('\n') });
    oldLines = newLines = null;
  };
  // Codex ends each diff with a newline; the empty line after it is not a context line.
  for (const line of diff.replace(/\n$/, '').split('\n')) {
    if (line.startsWith('@@')) {
      flush();
      oldLines = [];
      newLines = [];
      continue;
    }
    if (oldLines === null || newLines === null) continue; // preamble (---/+++) before the first hunk
    if (line.startsWith('\\')) continue; // "\ No newline at end of file"
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

const result = (id: string, text: string, isError: boolean): StreamRecord => ({
  kind: 'tool_result',
  payload: { tool_use_id: id, text: clip(text), is_error: isError, truncated: truncated(text) },
});

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

    case 'agentMessage':
    case 'plan': {
      // A plan item is the plan Codex proposes in plan mode, as markdown. The checklist comes
      // from turn/plan/updated instead (normalizePlan).
      const text = String((item as { text?: unknown }).text ?? '');
      return text.trim() ? [{ kind: 'assistant_text', payload: { text } }] : [];
    }

    case 'commandExecution': {
      const command = asCommand((item as { command?: string | string[] }).command ?? '');
      const out = String((item as { aggregatedOutput?: unknown; output?: unknown }).aggregatedOutput ?? (item as { output?: unknown }).output ?? '');
      const { exitCode, status } = item as { exitCode?: number | null; status?: string };
      return [
        { kind: 'tool_use', payload: { id: item.id, name: 'Bash', input: { command }, parent: null } },
        result(item.id, out, (exitCode ?? 0) !== 0 || status === 'failed' || status === 'declined'),
      ];
    }

    case 'fileChange':
      return fileChange(item);

    // The item is complete, so its row ends with a result even when Codex sends no body.
    case 'mcpToolCall': {
      const server = String((item as { server?: unknown }).server ?? '');
      const tool = String((item as { tool?: unknown }).tool ?? '');
      const args = (item as { arguments?: unknown }).arguments ?? {};
      const { error, result: res, status } = item as { error?: { message?: string } | null; result?: McpResult | null; status?: string };
      return [
        { kind: 'tool_use', payload: { id: item.id, name: `mcp__${server}__${tool}`, input: args, parent: null } },
        error
          ? result(item.id, String(error.message ?? JSON.stringify(error)), true)
          : result(item.id, res ? mcpText(res) : '', status === 'failed'),
      ];
    }

    case 'webSearch': {
      // Built-in search sends its results to the model only, so `results` is usually null.
      const { query, action, results } = item as { query?: string; action?: { url?: string | null } | null; results?: unknown };
      return [
        { kind: 'tool_use', payload: { id: item.id, name: 'WebSearch', input: { query: query || action?.url || '' }, parent: null } },
        result(item.id, results == null ? '' : typeof results === 'string' ? results : JSON.stringify(results), false),
      ];
    }

    default:
      // Anything Omni doesn't recognise still shows, under its own name, with its raw input.
      return [
        { kind: 'tool_use', payload: { id: item.id, name: String(item.type), input: rawInput(item), parent: null } },
      ];
  }
}

/** An MCP tool result: its text blocks, or its JSON when it has none. */
interface McpResult {
  content?: { type?: string; text?: string }[];
  structuredContent?: unknown;
}
function mcpText(r: McpResult): string {
  const texts = (r.content ?? []).filter((c) => c?.type === 'text' && typeof c.text === 'string').map((c) => c.text!);
  if (texts.length) return texts.join('\n');
  return JSON.stringify(r.structuredContent ?? r.content ?? r);
}

function rawInput(item: CodexItem): Record<string, unknown> {
  const { id: _id, type: _type, ...rest } = item;
  return rest;
}

interface FileUpdateChange {
  path: string;
  kind: { type: 'add' | 'delete' | 'update'; move_path?: string | null };
  diff: string;
}

/**
 * A Codex file change to Claude's Write/Edit/MultiEdit rows, or a visible Delete entry, one per
 * file. For an added file `diff` is its content; for an update it is a unified diff.
 */
function fileChange(item: CodexItem): StreamRecord[] {
  const changes = ((item as { changes?: FileUpdateChange[] }).changes ?? []).filter((c) => c?.path);
  const status = String((item as { status?: unknown }).status ?? 'completed');
  const failed = status === 'failed' || status === 'declined';
  return changes.flatMap((c, i): StreamRecord[] => {
    const id = changes.length === 1 ? item.id : `${item.id}:${i}`;
    const diff = String(c.diff ?? '');
    let use: StreamRecord;
    if (c.kind?.type === 'add') {
      use = { kind: 'tool_use', payload: { id, name: 'Write', input: { file_path: c.path, content: diff }, parent: null } };
    } else if (c.kind?.type === 'delete') {
      use = { kind: 'tool_use', payload: { id, name: 'Delete', input: { file_path: c.path }, parent: null } };
    } else {
      // A rename shows under the new name.
      const path = c.kind?.move_path || c.path;
      const edits = diffToEdits(diff);
      use =
        edits.length > 1
          ? { kind: 'tool_use', payload: { id, name: 'MultiEdit', input: { file_path: path, edits }, parent: null } }
          : { kind: 'tool_use', payload: { id, name: 'Edit', input: { file_path: path, ...(edits[0] ?? { old_string: '', new_string: '' }) }, parent: null } };
    }
    return [use, result(id, failed ? `Patch ${status}.` : '', failed)];
  });
}

/** The message in a Codex turn error, which is often the API's JSON error body as a string. */
export function turnErrorText(message: string): string {
  try {
    const body = JSON.parse(message);
    const inner = body?.error?.message ?? body?.message;
    if (typeof inner === 'string' && inner.trim()) return inner;
  } catch {
    /* plain text */
  }
  return message;
}

/** A turn/plan/updated checklist to a TodoWrite row, which drives the transcript's live checklist. */
export function normalizePlan(update: PlanUpdate, id: string): StreamRecord[] {
  const todos = (update.plan ?? []).map((s) => ({ content: String(s.step ?? ''), status: PLAN_STATUS[String(s.status)] ?? 'pending' }));
  return [
    { kind: 'tool_use', payload: { id, name: 'TodoWrite', input: { todos }, parent: null } },
    result(id, '', false),
  ];
}

const usageWindow = (w: RateLimitWindow | null | undefined) =>
  w && w.resetsAt != null ? { utilization: w.usedPercent / 100, resetsAt: w.resetsAt } : undefined;

/**
 * The plan's rate-limit bucket to an Omni usage record: the 300-minute primary window as 5h, the
 * 10,080-minute secondary as the week. account/rateLimits/updated is sparse, so a window it
 * leaves out keeps its value from `prev`, the usage recorded last.
 */
export function normalizeRateLimits(rl: RateLimits, prev?: Usage | null): Usage {
  const usage: Usage = { updated_at: new Date().toISOString() };
  const fiveHour = usageWindow(rl.primary) ?? prev?.five_hour;
  const week = usageWindow(rl.secondary) ?? prev?.seven_day;
  if (fiveHour) usage.five_hour = fiveHour;
  if (week) usage.seven_day = week;
  return usage;
}
