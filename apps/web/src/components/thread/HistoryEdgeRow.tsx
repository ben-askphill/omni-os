import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react';
import { earlierCursor, historyQuery, laterCursor, type Clipped, type HistoryCursor, type HistoryEdge } from '@omni/shared/history.ts';
import { bytes } from '../../format.ts';
import type { ThreadHistory } from '../../pages/useThreadHistory.ts';
import { Button, Loader } from '../ui.tsx';

/** The thread's history and its loads, for the controls deep in the transcript. Null where a whole thread shows. */
export const HistoryCtx = createContext<ThreadHistory | null>(null);

/** The nearest ancestor that scrolls, the root the earlier control watches. */
function scrollParent(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const y = getComputedStyle(p).overflowY;
    if (y === 'auto' || y === 'scroll') return p;
  }
  return null;
}

function Divider({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-3 py-1">
      <div className="h-px flex-1 bg-line" />
      <div className="flex shrink-0 flex-wrap items-center justify-center gap-1.5">{children}</div>
      <div className="h-px flex-1 bg-line" />
    </div>
  );
}

function Failed({ error, retry }: { error: string; retry: () => void }) {
  return (
    <span className="flex items-center gap-2 text-[12px] text-fg-3" role="alert">
      <span className="min-w-0 break-words">{error}</span>
      <button type="button" onClick={retry} className="shrink-0 font-medium text-fg underline underline-offset-2">
        Retry
      </button>
    </span>
  );
}

/** "Earlier messages": loads by itself once it is within a screen of the top, and again while it stays there. */
function Earlier({ history, cursor, size }: { history: ThreadHistory; cursor: HistoryCursor; size: 'sm' | 'md' }) {
  const ref = useRef<HTMLDivElement>(null);
  const busy = history.busy(cursor);
  const error = history.error(cursor);
  const { load } = history;
  const latest = useRef(cursor);
  latest.current = cursor;
  const query = historyQuery(cursor);
  // A new observer for each cursor and after each load reports where the control is now, so a page that left it
  // within reach loads the next one.
  useEffect(() => {
    const el = ref.current;
    if (!el || busy || error || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && void load(latest.current), {
      root: scrollParent(el),
      rootMargin: '100% 0px 0px 0px',
    });
    io.observe(el);
    return () => io.disconnect();
  }, [busy, error, load, query]);
  return (
    <div ref={ref}>
      <Divider>
        {error ? (
          <Failed error={error} retry={() => void load(cursor)} />
        ) : (
          <Button size={size} variant="ghost" icon="arrowUp" busy={busy} onClick={() => void load(cursor)}>
            Earlier messages
          </Button>
        )}
      </Divider>
    </div>
  );
}

/** Between two held stretches of the thread: load on from either side. Never by itself. */
function Gap({ history, later, earlier, size }: { history: ThreadHistory; later: HistoryCursor | null; earlier: HistoryCursor | null; size: 'sm' | 'md' }) {
  const error = history.error(later) ?? history.error(earlier);
  const busy = history.busy(later) || history.busy(earlier);
  return (
    <Divider>
      {later && (
        <Button size={size} variant="ghost" icon="arrowDown" busy={history.busy(later)} disabled={busy} onClick={() => void history.load(later)}>
          Show later
        </Button>
      )}
      {earlier && (
        <Button size={size} variant="ghost" icon="arrowUp" busy={history.busy(earlier)} disabled={busy} onClick={() => void history.load(earlier)}>
          Show earlier
        </Button>
      )}
      {error && !busy && <Failed error={error} retry={() => void history.load(history.error(later) ? later : earlier)} />}
    </Divider>
  );
}

/**
 * A loading control where the held history has an edge: older history above it, or a gap under an island. `touch`:
 * the phone's bigger buttons.
 */
export function HistoryEdgeRow({ edge, history, touch = false }: { edge: HistoryEdge; history: ThreadHistory; touch?: boolean }) {
  const h = history.history;
  const size = touch ? 'md' : 'sm';
  if (edge.type === 'earlier') {
    const c = earlierCursor(h);
    return c ? <Earlier history={history} cursor={c} size={size} /> : null;
  }
  return <Gap history={history} later={laterCursor(h, edge.after)} earlier={earlierCursor(h, edge.after + 1)} size={size} />;
}

/** Under a row that came clipped: what it is, and its whole copy on request. */
export function ClippedNote({ event, clipped, className = '' }: { event: number; clipped?: Clipped; className?: string }) {
  const history = useContext(HistoryCtx);
  if (!clipped) return null;
  const busy = history?.rowBusy(event);
  const error = history?.rowError(event);
  return (
    <div className={`flex flex-wrap items-center gap-x-1.5 text-[11.5px] text-fg-4 ${className}`}>
      <span>Trimmed for loading</span>
      {history && (
        <>
          <span>·</span>
          <button type="button" disabled={busy} onClick={() => void history.showAll(event)} className="inline-flex items-center gap-1 font-medium text-fg-3 underline underline-offset-2 hover:text-fg disabled:no-underline">
            {busy && <Loader size={11} />}
            Show all ({bytes(clipped.bytes)})
          </button>
          {error && <span className="text-fg-3">· {error}</span>}
        </>
      )}
    </div>
  );
}
