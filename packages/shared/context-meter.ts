// A thread's context window: how full it is, what fills it, and the meter's colour. The server builds a
// ContextUsage from the harness (Claude Code's own `get_context_usage` answer, the token counts on its stream,
// or Codex's tokenUsage notification); the Web UI draws it as a ring. Pure, so both sides and the tests share it.

/** Where the numbers came from, so the panel can say which ones are exact. */
export type ContextSource =
  /** Claude Code's `get_context_usage` answer: the CLI's own category split. */
  | 'claude-cli'
  /** The token counts on Claude Code's last API call: the total is exact, there is no split. */
  | 'claude-stream'
  /** The same counts read back from the session file, while no process runs. */
  | 'claude-transcript'
  /** Codex's thread/tokenUsage/updated notification. */
  | 'codex';

export interface ContextCategory {
  name: string;
  tokens: number;
  /** used: in the window now. free: room left. buffer: kept free for autocompact. */
  kind: 'used' | 'free' | 'buffer';
}

/** One tool's calls and results in the conversation, by tool name. */
export interface ContextTool {
  name: string;
  callTokens: number;
  resultTokens: number;
}

/** One tool result, estimated from its length in the session file. */
export interface ContextResult {
  tool: string;
  /** What it read or ran: a path, a command, a query. */
  label: string;
  tokens: number;
}

export interface ContextUsage {
  /** Tokens in the window on the last call to the model. */
  used: number;
  /** The window the harness compacts against, or null when it has not said. */
  max: number | null;
  /** The model's own window, when it differs from `max` (an autocompact window setting). */
  modelWindow?: number | null;
  /** Where autocompact starts, when it is on. */
  autoCompactAt?: number | null;
  model?: string | null;
  source: ContextSource;
  /** The CLI's split of `used`, plus free space and the autocompact buffer. Estimated by the CLI. */
  categories?: ContextCategory[];
  /** Tokens per tool among the conversation's messages. Estimated by the CLI. */
  tools?: ContextTool[];
  /** CLAUDE.md, rules and memory files, by path. */
  memoryFiles?: { path: string; tokens: number }[];
  updated_at: string;
}

/** Ring colour: normal, warning from 70%, critical from 90%. */
export type ContextLevel = 'ok' | 'warn' | 'critical';

export const WARN_AT = 70;
export const CRITICAL_AT = 90;

/** Percent of the window in use, 0 to 100, or null with no window to measure against. */
export function contextPercent(used: number, max: number | null | undefined): number | null {
  if (!max || max <= 0 || !Number.isFinite(used)) return null;
  return Math.min(100, Math.max(0, (used / max) * 100));
}

export function contextLevel(percent: number | null): ContextLevel {
  if (percent === null) return 'ok';
  if (percent >= CRITICAL_AT) return 'critical';
  if (percent >= WARN_AT) return 'warn';
  return 'ok';
}

/** 950, 12.4K, 200K, 1M, 1.25M. */
export function formatTokens(n: number): string {
  const abs = Math.abs(n);
  const trim = (v: number, digits: number) => v.toFixed(digits).replace(/\.0+$|(\.\d*[1-9])0+$/, '$1');
  if (abs >= 1_000_000) return `${trim(n / 1_000_000, 2)}M`;
  if (abs >= 1_000) return `${trim(n / 1_000, abs >= 100_000 ? 0 : 1)}K`;
  return String(Math.round(n));
}

/** "62.4K / 270K tokens (23%)", or "62.4K tokens" with no window. */
export function contextSummary(c: Pick<ContextUsage, 'used' | 'max'>): string {
  const pct = contextPercent(c.used, c.max);
  if (pct === null) return `${formatTokens(c.used)} tokens`;
  return `${formatTokens(c.used)} / ${formatTokens(c.max!)} tokens (${Math.round(pct)}%)`;
}

/** Rough tokens for a run of text: about four characters each. Only for estimates the UI labels as such. */
export const estimateTokens = (text: string) => Math.ceil(text.length / 4);

// ---------- parsing ----------

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/** Input, cache read and cache write tokens of one API call: what the model saw, so what fills the window. */
export function usageTokens(usage: unknown): number | undefined {
  if (!usage || typeof usage !== 'object') return undefined;
  const u = usage as Record<string, unknown>;
  const input = num(u.input_tokens);
  if (input === undefined) return undefined;
  return input + (num(u.cache_read_input_tokens) ?? 0) + (num(u.cache_creation_input_tokens) ?? 0);
}

/**
 * Claude Code's answer to a `get_context_usage` control request, as a ContextUsage. Deferred tool schemas
 * (loaded only when searched for) are not in the window, so they drop out.
 */
export function fromClaudeContext(r: unknown, now = new Date()): ContextUsage | null {
  if (!r || typeof r !== 'object') return null;
  const o = r as Record<string, any>;
  const used = num(o.totalTokens);
  if (used === undefined) return null;
  const max = num(o.maxTokens) ?? null;
  const raw = num(o.rawMaxTokens) ?? null;
  const categories: ContextCategory[] = [];
  for (const c of Array.isArray(o.categories) ? o.categories : []) {
    const tokens = num(c?.tokens);
    if (!c?.name || tokens === undefined || c.isDeferred || c.kind === 'deferred') continue;
    const kind: ContextCategory['kind'] = c.kind === 'free' ? 'free' : c.kind === 'buffer' ? 'buffer' : 'used';
    categories.push({ name: String(c.name), tokens, kind });
  }
  const tools: ContextTool[] = (Array.isArray(o.messageBreakdown?.toolCallsByType) ? o.messageBreakdown.toolCallsByType : [])
    .map((t: any) => ({ name: String(t?.name ?? ''), callTokens: num(t?.callTokens) ?? 0, resultTokens: num(t?.resultTokens) ?? 0 }))
    .filter((t: ContextTool) => t.name);
  const memoryFiles = (Array.isArray(o.memoryFiles) ? o.memoryFiles : [])
    .map((m: any) => ({ path: String(m?.path ?? ''), tokens: num(m?.tokens) ?? 0 }))
    .filter((m: { path: string }) => m.path);
  return {
    used,
    max,
    modelWindow: raw !== null && raw !== max ? raw : undefined,
    autoCompactAt: o.isAutoCompactEnabled ? num(o.autoCompactThreshold) ?? null : null,
    model: typeof o.model === 'string' ? o.model : null,
    source: 'claude-cli',
    categories,
    tools,
    memoryFiles,
    updated_at: now.toISOString(),
  };
}

/** Codex's `thread/tokenUsage/updated` params. Its last turn's total is the context in use. */
export function fromCodexTokenUsage(params: unknown, model: string | null, now = new Date()): ContextUsage | null {
  const t = (params as any)?.tokenUsage;
  const last = t?.last;
  const used = num(last?.totalTokens) ?? num(last?.total_tokens);
  if (used === undefined) return null;
  return {
    used,
    max: num(t?.modelContextWindow) ?? num(t?.model_context_window) ?? null,
    model,
    source: 'codex',
    updated_at: now.toISOString(),
  };
}
