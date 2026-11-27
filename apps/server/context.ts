// Each thread's context window, for the meter in the thread header. A running process reports it on every call
// to the model and at the end of every turn; the last reading is kept in kv, so an idle thread shows its level
// after a restart and on the other machine, and a Claude thread can also read its last call back from the
// session file. Published on the thread's stream so the ring moves live.
import { readFileSync, statSync } from 'node:fs';
import { estimateTokens, usageTokens, type ContextResult, type ContextUsage, type ThreadSpend } from '@omni/shared/context-meter.ts';
import { publishThread } from './bus.ts';
import { kv, threads, type Thread } from './db.ts';
import { sessionFile } from './harness/claude/adapter.ts';
import { profileOf } from './harness/profile.ts';
import { harnessName } from './harness/registry.ts';
import type { ContextHint } from './stream.ts';
import { toolLabel } from './tool-label.ts';

const snapshots = new Map<string, ContextUsage>();


/**
 * The window the CLI last reported for a model, so a thread read back from its session file, or one whose
 * first call is still running, has something to measure against. Written only when it changes.
 */
const windowKey = (model: string) => `context-window:${model}`;
export function knownWindow(model: string | null | undefined): { max: number; modelWindow?: number } | null {
  return model ? kv.get<{ max: number; modelWindow?: number }>(windowKey(model)) ?? null : null;
}
function rememberWindow(c: ContextUsage) {
  if (!c.model || !c.max) return;
  const prev = knownWindow(c.model);
  const next = { max: c.max, ...(c.modelWindow ? { modelWindow: c.modelWindow } : {}) };
  if (prev?.max !== next.max || prev?.modelWindow !== next.modelWindow) kv.set(windowKey(c.model), next);
}

// The last reading of every metered thread is kept (kv syncs it). Cursor's tokens and cost are kept beside it.
const lastKey = (threadId: string) => `context-last:${threadId}`;
const spendKey = (threadId: string) => `cursor-spend:${threadId}`;
const cursorReading = (c: ContextUsage) => c.source === 'cursor' || c.source === 'cursor-estimate' || c.source === 'antigravity' || c.source === 'opencode';

/** Threads whose reading moved during a turn and is not kept yet: written once when the turn ends (settleContext). */
const unsaved = new Set<string>();

function keep(threadId: string, c: ContextUsage) {
  const { spend: _, ...last } = c;
  kv.set(lastKey(threadId), last);
}

function publish(threadId: string, c: ContextUsage) {
  if (cursorReading(c)) c = { ...c, spend: threadSpend(threadId) };
  snapshots.set(threadId, c);
  // A turn reports on every call to the model: one write when it ends, not one per call (kv rows sync).
  const status = threads.get(threadId)?.status;
  if (status === 'running' || status === 'queued') unsaved.add(threadId);
  else {
    unsaved.delete(threadId);
    keep(threadId, c);
  }
  publishThread(threadId, { kind: 'context', context: c });
}

/** The turn ended: keep the last reading it took, so the thread shows it while idle and after a restart. */
export function settleContext(threadId: string) {
  if (!unsaved.delete(threadId)) return;
  const c = snapshots.get(threadId);
  if (c) keep(threadId, c);
}

/** The newer of two readings. */
const newer = (a: ContextUsage | null | undefined, b: ContextUsage | null | undefined) => (!a ? b ?? null : !b ? a : b.updated_at > a.updated_at ? b : a);

/** The last reading: live, or kept from an earlier run here or from the machine that ran the thread. */
export function lastContext(threadId: string): ContextUsage | null {
  return newer(snapshots.get(threadId), kv.get<ContextUsage>(lastKey(threadId)));
}

export function threadSpend(threadId: string): ThreadSpend | null {
  return kv.get<ThreadSpend>(spendKey(threadId)) ?? null;
}

/** New tokens or a new cost for the thread: kept, and pushed with the last reading so the meter shows it live. */
export function recordSpend(threadId: string, s: ThreadSpend) {
  kv.set(spendKey(threadId), s);
  const c = lastContext(threadId);
  if (c) {
    snapshots.set(threadId, { ...c, spend: s });
    publishThread(threadId, { kind: 'context', context: { ...c, spend: s } });
  }
}

/** A full reading replaces the last one. */
export function recordContext(threadId: string, c: ContextUsage) {
  const prev = lastContext(threadId);
  // Codex may not name a window; keep the last one it did.
  const max = c.max ?? prev?.max ?? null;
  // An autocompact window env makes the CLI report it as the model's too; the stream still names the real one.
  const modelWindow = c.modelWindow ?? (prev?.modelWindow && max && prev.modelWindow > max ? prev.modelWindow : undefined);
  const next = { ...c, max, ...(modelWindow ? { modelWindow } : {}) };
  if (c.source === 'claude-cli') rememberWindow(next);
  publish(threadId, next);
}

/**
 * A partial reading from the stream. The tokens on the last call move the total; the split stays from
 * the last full reading until the turn ends and the CLI sends a new one.
 */
export function recordContextHint(threadId: string, h: ContextHint, now = new Date()) {
  const prev = lastContext(threadId);
  if (h.used !== undefined) {
    const model = h.model ?? prev?.model ?? null;
    publish(threadId, {
      ...(prev ?? { max: knownWindow(model)?.max ?? null, source: 'claude-stream' }),
      used: h.used,
      model,
      source: prev?.source === 'claude-cli' ? 'claude-cli' : 'claude-stream',
      updated_at: now.toISOString(),
    });
    return;
  }
  if (!h.windows) return;
  const model = prev?.model;
  const window = (model && h.windows[model]) || Math.max(...Object.values(h.windows));
  // Only a fallback: the CLI's own window (an autocompact window setting) is the one it compacts against.
  if (prev && prev.max === null) publish(threadId, { ...prev, max: window, modelWindow: window });
  else if (prev?.max && window > prev.max && prev.modelWindow !== window) publish(threadId, { ...prev, modelWindow: window });
}

/** The thread starts over in a new session (another harness, fresh context): its last reading no longer applies. */
export function forgetContext(threadId: string) {
  snapshots.delete(threadId);
  unsaved.delete(threadId);
  kv.delete(lastKey(threadId));
}

// ---------- the session file ----------

interface Transcript {
  /** The last top-level call's tokens and model, after the last compaction. */
  used?: number;
  model?: string;
  largest: ContextResult[];
}

const cache = new Map<string, { mtimeMs: number; size: number; data: Transcript }>();

const resultText = (content: unknown): string => {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  // An image counts as its encoded size would mislead; the CLI bills images by pixels. Leave them out.
  return content.flatMap((b: any) => (b?.type === 'text' ? [String(b.text ?? '')] : [])).join('\n');
};

/**
 * A Claude session file, read after its last compaction: the last call's tokens, and the biggest tool
 * results still in the window. Results are estimated from their length.
 */
export function readTranscript(text: string, top = 8): Transcript {
  const lines = text.split('\n');
  let start = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].includes('"compact_boundary"')) {
      start = i + 1;
      break;
    }
  }
  const calls = new Map<string, { name: string; label: string }>();
  const results: ContextResult[] = [];
  let used: number | undefined;
  let model: string | undefined;
  for (let i = start; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    let e: any;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    // A sub-agent's messages live in its own window.
    if (e.isSidechain) continue;
    const content = e.message?.content;
    if (e.type === 'assistant') {
      const t = usageTokens(e.message?.usage);
      if (t && e.message?.model !== '<synthetic>') {
        used = t;
        model = e.message.model;
      }
      if (Array.isArray(content))
        for (const b of content) if (b?.type === 'tool_use' && b.id) calls.set(b.id, { name: String(b.name ?? 'Tool'), label: toolLabel(b.input) });
    } else if (e.type === 'user' && Array.isArray(content)) {
      for (const b of content) {
        if (b?.type !== 'tool_result') continue;
        const call = calls.get(b.tool_use_id);
        results.push({ tool: call?.name ?? 'Tool', label: call?.label ?? '', tokens: estimateTokens(resultText(b.content)) });
      }
    }
  }
  results.sort((a, b) => b.tokens - a.tokens);
  return { used, model, largest: results.slice(0, top).filter((r) => r.tokens > 0) };
}

/** The session file read, cached until it changes, and when it last changed. Null when there is none. */
function transcriptOf(t: Pick<Thread, 'cwd' | 'session_id'>): (Transcript & { at: string }) | null {
  const file = sessionFile(t);
  let st;
  try {
    st = statSync(file);
  } catch {
    return null;
  }
  const hit = cache.get(file);
  const at = st.mtime.toISOString();
  if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return { ...hit.data, at };
  let data: Transcript;
  try {
    data = readTranscript(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
  cache.set(file, { mtimeMs: st.mtimeMs, size: st.size, data });
  return { ...data, at };
}

// ---------- the API's view ----------

export interface ContextView {
  /** Null when the harness reports nothing, or the thread has not run yet. */
  context: ContextUsage | null;
  /** The biggest tool results in the window. Estimated. Claude Code only. */
  largest: ContextResult[];
  compact: { ok: boolean; reason?: string; focus: boolean };
}

/** Why the thread can't compact now, or null when it can. */
export function compactBlocked(t: Thread): string | null {
  if (!profileOf(t.harness).compact) return `${harnessName(t.harness)} has no compact command.`;
  if (t.status === 'running' || t.status === 'queued') return 'Wait for the current turn to finish.';
  if (!t.has_run) return 'Nothing to compact yet.';
  return null;
}

export function contextView(t: Thread): ContextView {
  const blocked = compactBlocked(t);
  const { compact: compacts, meter } = profileOf(t.harness);
  const compact = { ok: !blocked, ...(blocked && { reason: blocked }), focus: !!compacts?.focus };
  if (!meter) return { context: null, largest: [], compact };
  // Live, or kept from the last turn: an idle thread, after a restart too, shows where its window stood.
  const last = lastContext(t.id);
  if (meter === 'estimate') return { context: last ? { ...last, spend: threadSpend(t.id) } : null, largest: [], compact };
  if (meter !== 'transcript') return { context: last, largest: [], compact };
  const file = transcriptOf(t);
  let context = last;
  // Nothing kept (a thread from before Omni kept readings): the session file has the last call's tokens.
  if (!context && file?.used) {
    const model = file.model ?? t.model;
    const known = knownWindow(model);
    context = { used: file.used, max: known?.max ?? null, modelWindow: known?.modelWindow, model, source: 'claude-transcript', updated_at: file.at };
  }
  return { context, largest: file?.largest ?? [], compact };
}
