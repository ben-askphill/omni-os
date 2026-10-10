// Each thread's context window, for the meter in the thread header. Held in memory: a running process
// reports it on every call to the model and at the end of every turn, and a Claude thread with no process
// reads its last call back from the session file. Published on the thread's stream so the ring moves live.
import { readFileSync, statSync } from 'node:fs';
import { estimateTokens, usageTokens, type ContextResult, type ContextUsage } from '../shared/context-meter.ts';
import { publishThread } from './bus.ts';
import { kv, type Thread } from './db.ts';
import { sessionFile } from './harness/claude/adapter.ts';
import type { ContextHint } from './stream.ts';

const snapshots = new Map<string, ContextUsage>();

/** The harnesses that report a context window. Cursor and Hermes don't. */
export const METERED = new Set(['claude-code', 'codex']);
/** The harnesses Omni can compact: Claude Code's /compact, and Codex's, which takes no instructions. */
export const COMPACTS = new Set(['claude-code', 'codex']);

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

function publish(threadId: string, c: ContextUsage) {
  snapshots.set(threadId, c);
  publishThread(threadId, { kind: 'context', context: c });
}

/** A full reading replaces the last one. */
export function recordContext(threadId: string, c: ContextUsage) {
  const prev = snapshots.get(threadId);
  // Codex may not name a window; keep the last one it did.
  const next = { ...c, max: c.max ?? prev?.max ?? null };
  if (c.source === 'claude-cli') rememberWindow(next);
  publish(threadId, next);
}

/**
 * A partial reading from the stream. The tokens on the last call move the total; the split stays from
 * the last full reading until the turn ends and the CLI sends a new one.
 */
export function recordContextHint(threadId: string, h: ContextHint, now = new Date()) {
  const prev = snapshots.get(threadId);
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
}

export function forgetContext(threadId: string) {
  snapshots.delete(threadId);
}

// ---------- the session file ----------

interface Transcript {
  /** The last top-level call's tokens and model, after the last compaction. */
  used?: number;
  model?: string;
  largest: ContextResult[];
}

const cache = new Map<string, { mtimeMs: number; size: number; data: Transcript }>();

/** What a tool call was about, in a few words: the path, command, pattern or URL it was given. */
export function toolLabel(input: unknown): string {
  if (!input || typeof input !== 'object') return '';
  const o = input as Record<string, unknown>;
  for (const k of ['file_path', 'path', 'command', 'pattern', 'url', 'query', 'notebook_path', 'description', 'prompt', 'skill']) {
    if (typeof o[k] !== 'string' || !o[k]) continue;
    const v = (o[k] as string).replace(/\s+/g, ' ');
    // A path stays whole, so the panel can show it from the thread's folder; a long one keeps its file name.
    if (k.endsWith('path')) return v.length > 1000 ? `…${v.slice(-999)}` : v;
    return v.slice(0, 140);
  }
  const first = Object.values(o).find((v) => typeof v === 'string' && v);
  return typeof first === 'string' ? first.replace(/\s+/g, ' ').slice(0, 140) : '';
}

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

/** The session file read, cached until it changes. Null when there is none. */
function transcriptOf(t: Pick<Thread, 'cwd' | 'session_id'>): Transcript | null {
  const file = sessionFile(t);
  let st;
  try {
    st = statSync(file);
  } catch {
    return null;
  }
  const hit = cache.get(file);
  if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit.data;
  let data: Transcript;
  try {
    data = readTranscript(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
  cache.set(file, { mtimeMs: st.mtimeMs, size: st.size, data });
  return data;
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
  if (!COMPACTS.has(t.harness)) return `${t.harness === 'cursor' ? 'Cursor Agent' : 'Hermes'} has no compact command.`;
  if (t.status === 'running' || t.status === 'queued') return 'Wait for the current turn to finish.';
  if (!t.has_run) return 'Nothing to compact yet.';
  return null;
}

export function contextView(t: Thread): ContextView {
  const blocked = compactBlocked(t);
  const compact = { ok: !blocked, ...(blocked && { reason: blocked }), focus: t.harness === 'claude-code' };
  if (!METERED.has(t.harness)) return { context: null, largest: [], compact };
  const live = snapshots.get(t.id) ?? null;
  if (t.harness !== 'claude-code') return { context: live, largest: [], compact };
  const file = transcriptOf(t);
  let context = live;
  // No process has reported since Omni started: the session file has the last call's tokens.
  if (!context && file?.used) {
    const model = file.model ?? t.model;
    const known = knownWindow(model);
    context = { used: file.used, max: known?.max ?? null, modelWindow: known?.modelWindow, model, source: 'claude-transcript', updated_at: new Date().toISOString() };
  }
  return { context, largest: file?.largest ?? [], compact };
}
