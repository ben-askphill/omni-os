import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  contextLevel,
  contextPercent,
  contextSummary,
  formatTokens,
  type ContextLevel,
  type ContextUsage,
} from '../../../../shared/context-meter.ts';
import { api, errorText, type ContextView, type Thread } from '../../api.ts';
import { relTime } from '../../format.ts';
import { Button, ErrorNote, Icon } from '../ui.tsx';
import { useDismissable } from '../ui/use-dismissable.ts';

const STROKE: Record<ContextLevel, string> = { ok: 'var(--fg-3)', warn: 'var(--warn)', critical: 'var(--needs)' };
const TEXT: Record<ContextLevel, string> = { ok: 'text-fg-3', warn: 'text-warn', critical: 'text-needs' };

/** The harnesses that report their window. The meter stays out of Cursor and Hermes threads. */
const METERED = new Set(['claude-code', 'codex']);

/** The newer of two readings. The stream's push wins a tie: it is the live one. */
function newest(a: ContextUsage | null | undefined, b: ContextUsage | null | undefined) {
  if (!a) return b ?? null;
  if (!b) return a;
  return b.updated_at >= a.updated_at ? b : a;
}

/** A donut that fills with the thread's context. `percent` null draws a dashed, unknown ring. */
/** A path inside the thread's folder relative to it, and one in a home folder from ~. */
function shortPath(path: string, cwd: string | null | undefined): string {
  if (cwd && path.startsWith(`${cwd.replace(/\/$/, '')}/`)) return path.slice(cwd.replace(/\/$/, '').length + 1);
  return path.replace(/^\/(?:Users|home)\/[^/]+\//, '~/');
}

/** One line that clips to fit. A path loses its start, not its end: its file name is the useful part. */
function Tail({ text, title, className }: { text: string; title: string; className: string }) {
  const path = /^[/~…]/.test(title);
  return (
    <span dir={path ? 'rtl' : undefined} className={`min-w-0 flex-1 truncate text-left font-mono text-[11px] ${className}`} title={title}>
      <bdi dir="ltr">{text}</bdi>
    </span>
  );
}

export function ContextRing({ percent, size = 18 }: { percent: number | null; size?: number }) {
  const stroke = 2.5;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const level = contextLevel(percent);
  // A sliver always shows once anything is in use, so a fresh thread still reads as a meter.
  const shown = percent === null ? 0 : Math.max(percent, 2);
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden className="shrink-0 -rotate-90">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--line-strong)" strokeWidth={stroke} strokeDasharray={percent === null ? '2 2.5' : undefined} />
      {percent !== null && (
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={STROKE[level]}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${(shown / 100) * c} ${c}`}
          className="transition-[stroke-dasharray,stroke] duration-500 ease-[var(--ease-out)]"
        />
      )}
    </svg>
  );
}

const SOURCE_NOTE: Record<ContextUsage['source'], string> = {
  'claude-cli': 'From Claude Code at the end of the last turn.',
  'claude-stream': 'Total from the last model call. The split updates when the turn ends.',
  'claude-transcript': 'Read from the session file. Open a turn for the full split.',
  codex: 'From Codex. Codex reports a total only.',
};

/**
 * The context meter next to the send button: a ring that fills as the thread's window does, with used,
 * window and percent on hover. Clicking it opens what fills the window and a Compact action.
 */
export function ContextMeter({ thread, pushed, onCompacted }: { thread: Thread; pushed: ContextUsage | null; onCompacted?: (t: Thread) => void }) {
  const [view, setView] = useState<ContextView | null>(null);
  const [open, setOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const metered = METERED.has(thread.harness);
  const busy = thread.status === 'running' || thread.status === 'queued';

  const load = useCallback(
    async (refresh = false) => {
      if (!metered) return;
      if (refresh) setRefreshing(true);
      try {
        setView(await api.get<ContextView>(`/threads/${encodeURIComponent(thread.id)}/context${refresh ? '?refresh=1' : ''}`));
      } catch {
        // The ring keeps its last reading; the stream will bring the next one.
      } finally {
        if (refresh) setRefreshing(false);
      }
    },
    [thread.id, metered],
  );

  // On open, and whenever a turn ends: the compact button's state and the biggest results move with it.
  useEffect(() => {
    if (!busy) void load();
  }, [load, busy]);
  useDismissable(open, () => setOpen(false), { root: wrap });

  if (!metered) return null;
  const context = newest(view?.context, pushed);
  const percent = context ? contextPercent(context.used, context.max) : null;
  const level = contextLevel(percent);
  const tip = context ? `Context: ${contextSummary(context)}. Click for details.` : 'Context: no reading yet. Click for details.';

  return (
    <div ref={wrap} className="relative">
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={tip}
        title={tip}
        onClick={() => {
          setOpen((v) => !v);
          if (!open) void load(true);
        }}
        className="hov press inline-flex h-7 items-center gap-1.5 rounded-full px-1.5 text-fg-3 hover:text-fg"
      >
        <span role="meter" aria-label="Context used" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent === null ? undefined : Math.round(percent)} className="inline-flex">
          <ContextRing percent={percent} />
        </span>
        {percent !== null && <span className={`font-num text-[11.5px] tabular-nums ${level === 'ok' ? '' : TEXT[level]}`}>{Math.round(percent)}%</span>}
      </button>
      {open && (
        <ContextPanel
          thread={thread}
          context={context}
          view={view}
          refreshing={refreshing}
          onRefresh={() => void load(true)}
          onCompacted={(t) => {
            onCompacted?.(t);
            void load();
          }}
        />
      )}
    </div>
  );
}

function ContextPanel({
  thread,
  context,
  view,
  refreshing,
  onRefresh,
  onCompacted,
}: {
  thread: Thread;
  context: ContextUsage | null;
  view: ContextView | null;
  refreshing: boolean;
  onRefresh: () => void;
  onCompacted: (t: Thread) => void;
}) {
  const percent = context ? contextPercent(context.used, context.max) : null;
  const level = contextLevel(percent);
  const used = (context?.categories ?? []).filter((c) => c.kind === 'used' && c.tokens > 0);
  const room = (context?.categories ?? []).filter((c) => c.kind !== 'used' && c.tokens > 0);
  const tools = [...(context?.tools ?? [])].sort((a, b) => b.callTokens + b.resultTokens - (a.callTokens + a.resultTokens)).slice(0, 6);
  const largest = view?.largest ?? [];
  const scale = context?.max || context?.used || 1;

  return (
    <div role="dialog" aria-label="Context window" style={{ transformOrigin: '100% 0' }} className="pik-card top-[calc(100%+8px)] right-0 w-[min(380px,calc(100vw-32px))] p-0">
      <div className="scroll-thin max-h-[min(560px,70vh)] overflow-y-auto px-3.5 pt-3 pb-2">
        {/* headline */}
        <div className="flex items-start gap-3">
          <ContextRing percent={percent} size={40} />
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2">
              <span className={`font-num text-[20px] leading-none tabular-nums ${level === 'ok' ? 'text-fg' : TEXT[level]}`}>
                {percent === null ? '?' : `${Math.round(percent)}%`}
              </span>
              <span className="text-[12px] text-fg-3">of the context window</span>
            </div>
            <div className="mt-1 font-num text-[12px] text-fg-3 tabular-nums">
              {context ? (context.max ? `${formatTokens(context.used)} of ${formatTokens(context.max)} tokens` : `${formatTokens(context.used)} tokens, window unknown`) : 'No reading yet'}
            </div>
            {context?.model && <div className="mt-0.5 truncate text-[11.5px] text-fg-4">{context.model}</div>}
          </div>
          <button
            type="button"
            onClick={onRefresh}
            disabled={refreshing}
            title="Refresh"
            aria-label="Refresh"
            className="hov press grid h-7 w-7 shrink-0 place-items-center rounded-full text-fg-3 hover:text-fg disabled:opacity-40"
          >
            <Icon name="refresh" size={14} className={refreshing ? 'animate-spin' : ''} />
          </button>
        </div>

        {context?.autoCompactAt && context.max ? (
          <p className="mt-2 text-[11.5px] text-fg-3">
            Autocompact starts at {formatTokens(context.autoCompactAt)} ({Math.round((context.autoCompactAt / context.max) * 100)}%).
            {context.modelWindow ? ` The model allows ${formatTokens(context.modelWindow)}.` : ''}
          </p>
        ) : null}

        {!context && (
          <p className="mt-3 text-[12.5px] text-fg-3">
            The meter fills once the agent has run a turn in this thread.
          </p>
        )}

        {used.length > 0 && (
          <Section title="What fills it" note="approximate">
            {used.map((c) => (
              <Bar key={c.name} label={c.name} tokens={c.tokens} of={scale} />
            ))}
            {room.map((c) => (
              <Bar key={c.name} label={c.name} tokens={c.tokens} of={scale} faint />
            ))}
          </Section>
        )}

        {tools.length > 0 && (
          <Section title="Tool calls and results, by tool" note="approximate">
            {tools.map((t) => (
              <Bar key={t.name} label={shortTool(t.name)} title={t.name} tokens={t.callTokens + t.resultTokens} of={scale} />
            ))}
          </Section>
        )}

        {largest.length > 0 && (
          <Section title="Largest tool results" note="approximate">
            {largest.map((r, i) => (
              <div key={i} className="flex items-baseline gap-2 py-[3px] text-[12px]">
                <span className="shrink-0 text-fg-2">{shortTool(r.tool)}</span>
                <Tail text={shortPath(r.label, thread.cwd)} title={r.label} className="text-fg-4" />
                <span className="shrink-0 font-num text-fg-3 tabular-nums">{formatTokens(r.tokens)}</span>
              </div>
            ))}
          </Section>
        )}

        {(context?.memoryFiles?.length ?? 0) > 0 && (
          <Section title="Memory files">
            {context!.memoryFiles!.map((m) => (
              <div key={m.path} className="flex items-baseline gap-2 py-[3px] text-[12px]">
                <Tail text={shortPath(m.path, thread.cwd)} title={m.path} className="text-fg-3" />
                <span className="shrink-0 font-num text-fg-3 tabular-nums">{formatTokens(m.tokens)}</span>
              </div>
            ))}
          </Section>
        )}

        {context && (
          <p className="mt-3 text-[11px] text-fg-4">
            {SOURCE_NOTE[context.source]} Updated {relTime(context.updated_at)}.
          </p>
        )}
      </div>
      <CompactAction thread={thread} view={view} onCompacted={onCompacted} />
    </div>
  );
}

function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <div className="mt-3.5">
      <div className="mb-1 flex items-baseline gap-1.5">
        <span className="caption">{title}</span>
        {note && <span className="text-[10.5px] text-fg-4">{note}</span>}
      </div>
      {children}
    </div>
  );
}

function Bar({ label, title, tokens, of, faint }: { label: string; title?: string; tokens: number; of: number; faint?: boolean }) {
  const pct = Math.min(100, (tokens / of) * 100);
  return (
    <div className="py-[3px]" title={title ?? label}>
      <div className="flex items-baseline gap-2 text-[12px]">
        <span className={`min-w-0 flex-1 truncate ${faint ? 'text-fg-4' : 'text-fg-2'}`}>{label}</span>
        <span className="shrink-0 font-num text-fg-3 tabular-nums">{formatTokens(tokens)}</span>
      </div>
      <div className="mt-[3px] h-[3px] overflow-hidden rounded-full bg-[var(--wash)]">
        <div className="h-full rounded-full" style={{ width: `${Math.max(pct, 0.6)}%`, background: faint ? 'var(--line-strong)' : 'var(--fg-3)' }} />
      </div>
    </div>
  );
}

/** mcp__server__tool reads as "server: tool". */
function shortTool(name: string) {
  const m = /^mcp__(.+?)__(.+)$/.exec(name);
  return m ? `${m[1].replace(/^claude_ai_/, '').replace(/_/g, ' ')}: ${m[2]}` : name;
}

/** Compact, with an optional focus line for Claude Code. Asks first; off with a reason while it can't run. */
function CompactAction({ thread, view, onCompacted }: { thread: Thread; view: ContextView | null; onCompacted: (t: Thread) => void }) {
  const [asking, setAsking] = useState(false);
  const [focus, setFocus] = useState('');
  const [sending, setSending] = useState(false);
  // Sent, until the thread's turn (the compaction) ends.
  const [started, setStarted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = thread.status === 'running' || thread.status === 'queued';

  useEffect(() => {
    if (started && !busy && !sending) setStarted(false);
  }, [started, busy, sending]);

  const compact = view?.compact;
  const blocked = busy ? 'Wait for the current turn to finish.' : compact && !compact.ok ? compact.reason : null;

  const run = async () => {
    setSending(true);
    setError(null);
    try {
      const t = await api.post<Thread>(`/threads/${encodeURIComponent(thread.id)}/compact`, compact?.focus && focus.trim() ? { focus: focus.trim() } : {});
      setStarted(true);
      setAsking(false);
      setFocus('');
      onCompacted(t);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="px-3.5 pt-2.5 pb-3 shadow-[inset_0_1px_0_var(--line)]">
      {started && busy ? (
        <div className="flex items-center gap-2 text-[12.5px] text-fg-2">
          <span className="pulse h-1.5 w-1.5 rounded-full bg-live" /> Compacting. The meter refreshes when it finishes.
        </div>
      ) : asking ? (
        <div>
          <p className="text-[12.5px] text-fg-2">
            Compact this thread? The agent replaces the conversation so far with a summary. Files and the transcript here stay as they are.
          </p>
          {compact?.focus && (
            <input
              autoFocus
              value={focus}
              onChange={(e) => setFocus(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void run();
              }}
              maxLength={2000}
              placeholder="Optional: what the summary should keep"
              className="mt-2 h-8 w-full rounded-lg bg-surface-2 px-2.5 text-[12.5px] outline-none placeholder:text-fg-4"
            />
          )}
          <div className="mt-2 flex items-center justify-end gap-1.5">
            <Button size="sm" variant="ghost" onClick={() => setAsking(false)} disabled={sending}>
              Cancel
            </Button>
            <Button size="sm" variant="primary" onClick={() => void run()} busy={sending}>
              Compact now
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1 text-[11.5px] text-fg-4">{blocked ?? 'Summarize the conversation to free up room.'}</span>
          <Button size="sm" variant="secondary" icon="layers" disabled={!!blocked || !view} onClick={() => setAsking(true)} title={blocked ?? undefined}>
            Compact
          </Button>
        </div>
      )}
      {error && <ErrorNote className="mt-2">{error}</ErrorNote>}
    </div>
  );
}
