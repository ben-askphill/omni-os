// Pure translation of one `codex app-server` item into Omni's records, so a Codex turn
// renders in the same transcript as a Claude turn. Tool names follow Claude Code's, so the
// existing transcript renderer shows them unchanged. Most items count once complete; a few
// that take a while show a status as they start.
import type { Record as StreamRecord } from '../../stream.ts';
import type { CodexItem, PlanUpdate, RateLimitWindow, RateLimits, TurnError } from './protocol.ts';
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

/** A command's call row. The adapter sends it when the command starts, so its row is there while it runs (#225). */
export function commandUse(item: CodexItem): StreamRecord {
  const command = asCommand((item as { command?: string | string[] }).command ?? '');
  return { kind: 'tool_use', payload: { id: item.id, name: 'Bash', input: { command }, parent: null } };
}

/**
 * One completed Codex item to zero or more Omni records. Reasoning items drop out, the same
 * as for Claude. Unknown item kinds pass through as a tool row under their own name.
 * `savedImage` is the artifact file an imageGeneration item's image was written to (saveGeneratedImage).
 */
export function normalizeItem(item: CodexItem, savedImage?: string | null): StreamRecord[] {
  switch (item.type) {
    case 'reasoning':
    case 'userMessage':
      // Reasoning/thinking is dropped as for Claude; the user echo is dropped because Omni already
      // stores Ben's own text without the added context. A review's prompt comes as one too.
      return [];

    case 'enteredReviewMode':
    case 'exitedReviewMode':
      // The review's text comes again as the agentMessage right after, which is the reply. On a
      // stop, that one says the review was interrupted, where this one says the reviewer failed.
      return [];

    case 'contextCompaction':
      // An empty status clears the one it showed on starting, for a compaction mid-turn.
      return [{ kind: 'status', payload: { text: '' } }];

    case 'agentMessage':
    case 'plan': {
      // A plan item is the plan Codex proposes in plan mode, as markdown. The checklist comes
      // from turn/plan/updated instead (normalizePlan).
      const text = String((item as { text?: unknown }).text ?? '');
      return text.trim() ? [{ kind: 'assistant_text', payload: { text } }] : [];
    }

    case 'commandExecution': {
      const out = String((item as { aggregatedOutput?: unknown; output?: unknown }).aggregatedOutput ?? (item as { output?: unknown }).output ?? '');
      const { exitCode, status } = item as { exitCode?: number | null; status?: string };
      const failed = (exitCode ?? 0) !== 0 || status === 'failed' || status === 'declined';
      return [commandUse(item), result(item.id, failed && exitCode ? `Exit code ${exitCode}\n${out}` : out, failed)];
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
          : result(item.id, res ? mcpText(res) : '', status === 'failed' || !!res?.isError),
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

    case 'imageGeneration': {
      // The image itself is base64 in `result`; the adapter saved it as an artifact, so only its name goes in the row.
      const { revisedPrompt, status, failure } = item as { revisedPrompt?: string | null; status?: string; failure?: unknown };
      const failed = status === 'failed' || !!failure;
      const why = typeof failure === 'string' ? failure : (failure as { message?: string } | null)?.message;
      return [
        { kind: 'tool_use', payload: { id: item.id, name: 'ImageGeneration', input: { prompt: revisedPrompt ?? '' }, parent: null } },
        result(
          item.id,
          failed ? why || 'Image generation failed.' : savedImage ? `Saved as ${savedImage} in this thread's artifacts.` : 'Generated an image, but Omni could not save it.',
          failed || !savedImage,
        ),
      ];
    }

    case 'dynamicToolCall': {
      const tool = typeof item.tool === 'string' && item.tool ? item.tool : 'dynamicToolCall';
      return [
        { kind: 'tool_use', payload: { id: item.id, name: tool, input: item.arguments ?? {}, parent: null } },
        result(item.id, item.success === false || item.status === 'failed' ? 'Tool reported failure.' : '', item.success === false || item.status === 'failed'),
      ];
    }

    default: {
      // Anything Omni doesn't recognise still shows, under its own name, with its raw input.
      const failed = item.status === 'failed' || item.status === 'declined' || item.success === false;
      return [
        { kind: 'tool_use', payload: { id: item.id, name: String(item.type), input: rawInput(item), parent: null } },
        ...(failed ? [result(item.id, 'Tool reported failure.', true)] : []),
      ];
    }
  }
}

/** Codex's own names for what a review looks at; anything else is Ben's instructions. */
const REVIEW_HINT = /^(current changes$|changes against '|commit [0-9a-f]{7})/;

/** One started Codex item to records: a status for the ones that take a while, nothing for the rest. */
export function normalizeStarted(item: CodexItem): StreamRecord[] {
  switch (item.type) {
    case 'enteredReviewMode': {
      const hint = String((item as { review?: unknown }).review ?? '').trim();
      const text = REVIEW_HINT.test(hint) ? `Reviewing ${hint}` : hint ? `Reviewing: ${hint}` : 'Reviewing';
      return [{ kind: 'status', payload: { text } }];
    }
    case 'contextCompaction':
      return [{ kind: 'status', payload: { text: 'Compacting the conversation' } }];
    default:
      return [];
  }
}

/** An MCP tool result: its text blocks, or its JSON when it has none. */
interface McpResult {
  isError?: boolean;
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

/** The kind Codex gives a turn the plan's usage limit refused. */
const USAGE_LIMIT = 'usageLimitExceeded';

/**
 * A failed turn's error, when it is the plan's usage limit: the reset time the API's body gives (`resets_at`, or
 * `resets_in_seconds` from now), else the latest reset among the plan's windows that are full. Null when it is some
 * other failure. A full window alone never makes a limit: only an error that says so does.
 */
export function codexLimit(error: TurnError | null | undefined, usage: Usage | null, now = Date.now()): { resets_at: number | null } | null {
  if (!error) return null;
  const info = error.codexErrorInfo;
  let body: any = null;
  try {
    body = JSON.parse(error.message);
  } catch {
    /* plain text */
  }
  const inner = body?.error ?? body;
  const limited = info === USAGE_LIMIT || (!!info && typeof info === 'object' && USAGE_LIMIT in info) || inner?.type === 'usage_limit_reached';
  if (!limited) return null;
  const at = Number(inner?.resets_at);
  if (Number.isFinite(at) && at > 0) return { resets_at: Math.round(at) };
  const inSeconds = Number(inner?.resets_in_seconds);
  if (Number.isFinite(inSeconds) && inSeconds >= 0) return { resets_at: Math.round(now / 1000 + inSeconds) };
  const full = [usage?.five_hour, usage?.seven_day].filter((w) => w && w.utilization >= 1 && w.resetsAt * 1000 > now).map((w) => w!.resetsAt);
  return { resets_at: full.length ? Math.max(...full) : null };
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
