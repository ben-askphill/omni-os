import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { findCount, findPattern, findQuery, matchList, nearestMatch, stepMatch, type FindAnswer, type FindMatch } from '@omni/shared/thread-find.ts';
import { api, errorText } from '../api.ts';
import { keyAtOrBefore } from '../thread-history.ts';
import { topDialog } from '../components/ui/dismiss-stack.ts';
import { clearFind, paintFind, readingEvent, scrollToMatch } from '../thread-find-dom.ts';

/** How long typing settles before the thread is asked again. */
const SETTLE_MS = 150;
/** How long rows a scroll made render stay rendered before they can skip again (useReveal's flash). */
const SHOWN_MS = 2200;

export interface ThreadFindIO {
  threadId: string;
  /** Loads the page holding an event when the client does not hold it. True once it is held. */
  reveal: (eventId: number) => Promise<boolean>;
  /** Stop following the newest rows, so a match above stays where the find put it. */
  release: () => void;
  scrollRef: RefObject<HTMLElement | null>;
  /** The newest event held: a live row may bring new matches. */
  tail: number;
}

/**
 * Find in a thread: the query, the server's matches over the whole thread (GET /api/threads/:id/find), which one is
 * current, and the page work for it: load its page, open the fold it sits in (FindTargetCtx), paint every match drawn,
 * and scroll the current one into the middle. Esc or close takes the highlights off.
 */
export function useThreadFind({ threadId, reveal, release, scrollRef, tail }: ThreadFindIO) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [answer, setAnswer] = useState<{ q: string; a: FindAnswer } | null>(null);
  const [index, setIndex] = useState(-1);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** Bumped on every focus request (Cmd+F again), for the bar to focus and select its field. */
  const [focusSeq, setFocusSeq] = useState(0);
  const q = findQuery(query);
  const matches = useMemo(() => (answer && answer.q === q ? matchList(answer.a.hits) : []), [answer, q]);
  const current: FindMatch | null = open && index >= 0 ? (matches[index] ?? null) : null;
  const target = current?.event ?? null;
  /** A match waiting to be scrolled to once its row is drawn. */
  const pending = useRef<FindMatch | null>(null);
  const undo = useRef<() => void>(() => {});
  const [loadError, setLoadError] = useState<string | null>(null);
  const letGo = useRef(release);
  letGo.current = release;

  // Ask the thread, a moment after typing stops and again as live rows land. A new query starts at the match nearest
  // where Ben reads; the same query asked again keeps the match it is on.
  const held = useRef<{ q: string; match: FindMatch | null }>({ q: '', match: null });
  held.current = { q: answer?.q ?? '', match: current };
  useEffect(() => {
    if (!open || !q) {
      setAnswer(null);
      setIndex(-1);
      setError(null);
      setBusy(false);
      return;
    }
    let stale = false;
    setBusy(true);
    const t = setTimeout(() => {
      api
        .get<FindAnswer>(`/threads/${encodeURIComponent(threadId)}/find?q=${encodeURIComponent(q)}`)
        .then((a) => {
          if (stale) return;
          const list = matchList(a.hits);
          const was = held.current;
          const keep = was.q === q && was.match ? list.findIndex((m) => m.event === was.match!.event && m.n === was.match!.n) : -1;
          const el = scrollRef.current;
          const next = keep >= 0 ? keep : nearestMatch(list, el ? readingEvent(el) : null);
          setAnswer({ q, a });
          setError(null);
          setIndex(next);
          if (keep < 0 && list[next]) {
            letGo.current();
            pending.current = list[next];
          }
        })
        .catch((e: unknown) => !stale && setError(errorText(e)))
        .finally(() => !stale && setBusy(false));
    }, SETTLE_MS);
    return () => {
      stale = true;
      clearTimeout(t);
    };
  }, [open, q, tail, threadId, scrollRef]);

  // The current match's page, when the client does not hold it.
  useEffect(() => {
    if (!current) return;
    let stale = false;
    setLoadError(null);
    const want = current;
    void reveal(current.event).then((ok) => {
      if (stale) return;
      if (!ok) return setLoadError('Could not load that match');
      // Its row has rendered by the second frame. A match the page does not draw (a call no steps card lists) still
      // scrolls to the row that holds its event.
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          const el = scrollRef.current;
          if (stale || !el || pending.current?.event !== want.event || pending.current.n !== want.n) return;
          const rows = [...el.querySelectorAll<HTMLElement>('[data-key]')];
          const key = keyAtOrBefore(
            rows.map((r) => Number(r.dataset.key)),
            want.event,
          );
          const row = rows.find((r) => Number(r.dataset.key) === key);
          if (!row) return;
          pending.current = null;
          undo.current();
          undo.current = scrollToMatch(el, row);
        }),
      );
    });
    return () => {
      stale = true;
    };
  }, [current?.event]); // eslint-disable-line react-hooks/exhaustive-deps

  const go = useCallback(
    (dir: 1 | -1) => {
      const next = stepMatch(index, matches.length, dir);
      if (next < 0) return;
      release();
      pending.current = matches[next];
      setIndex(next);
    },
    [index, matches, release],
  );

  // Paint after every render, and whenever the transcript's DOM changes under the find: a page landing, a fold opening,
  // more output loading. Batched to one paint a frame.
  const re = useMemo(() => (open && answer?.q === q ? findPattern(q) : null), [open, answer, q]);
  const events = useMemo(() => new Set(matches.map((m) => m.event)), [matches]);
  const paint = useRef<() => void>(() => {});
  paint.current = () => {
    const el = scrollRef.current;
    if (!el) return;
    const got = paintFind(el, re, events, current);
    const want = pending.current;
    if (!want || !current || want.event !== current.event || want.n !== current.n) return;
    const at = got.range ?? got.element;
    if (!at) return;
    pending.current = null;
    undo.current();
    undo.current = scrollToMatch(el, at);
    const restore = undo.current;
    setTimeout(() => {
      restore();
      if (undo.current === restore) undo.current = () => {};
    }, SHOWN_MS);
  };
  useLayoutEffect(() => {
    if (!open) return;
    paint.current();
  });
  useEffect(() => {
    const el = scrollRef.current;
    if (!open || !el) return;
    let frame = 0;
    const obs = new MutationObserver(() => {
      frame ||= requestAnimationFrame(() => {
        frame = 0;
        paint.current();
      });
    });
    obs.observe(el, { subtree: true, childList: true, characterData: true });
    return () => {
      obs.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [open, scrollRef]);

  const show = useCallback(() => {
    setOpen(true);
    setFocusSeq((n) => n + 1);
  }, []);
  const close = useCallback(() => {
    setOpen(false);
    pending.current = null;
    undo.current();
    undo.current = () => {};
    clearFind();
  }, []);
  // Cmd+F (Ctrl+F off a Mac) on the thread opens the bar, or focuses it again; the browser's own find would see only
  // the rows on screen. Not over a modal, and Ctrl+F in the terminal stays the shell's.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey || e.key.toLowerCase() !== 'f') return;
      if (e.ctrlKey && !e.metaKey && e.target instanceof Element && e.target.closest('.xterm')) return;
      if (topDialog()) return;
      e.preventDefault();
      show();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [show]);
  // Leaving the thread takes the highlights with it.
  useEffect(() => () => clearFind(), [threadId]);
  useEffect(() => close(), [threadId, close]);

  const total = answer && answer.q === q ? answer.a.total : 0;
  const capped = !!(answer && answer.q === q && answer.a.capped);
  return {
    open,
    show,
    close,
    query,
    setQuery,
    focusSeq,
    next: () => go(1),
    prev: () => go(-1),
    /** The event the current match is in, for the folds to open (FindTargetCtx). */
    target,
    total,
    /** "3 of 12", "No results"; null while there is no query, or the first answer has not come. */
    count: q && answer?.q === q ? findCount(index, total, capped) : null,
    busy,
    error: error ?? loadError,
  };
}

export type ThreadFind = ReturnType<typeof useThreadFind>;
