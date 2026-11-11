import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { api, type Thread } from '../api.ts';
import { href, useRoute } from '../router.ts';
import { useFeed } from '../store.tsx';
import { Icon, IconButton, STATUS, StatusDot, glyphFor, threadGlyph, type IconName } from './ui.tsx';

export interface ToastInput {
  title: ReactNode;
  body?: ReactNode;
  status?: string;
  icon?: IconName;
  href?: string;
  action?: string;
  /** How long it stays, in ms. 6.5s by default. */
  timeout?: number;
}

export interface ToastItem extends ToastInput {
  id: number;
  leaving?: boolean;
}

const Ctx = createContext<(t: ToastInput) => void>(() => {});
export const useToast = () => useContext(Ctx);

function ToastView({ t, dismiss }: { t: ToastItem; dismiss: (id: number) => void }) {
  const [hover, setHover] = useState(false);
  useEffect(() => {
    if (hover || t.leaving) return;
    const tm = setTimeout(() => dismiss(t.id), t.timeout ?? 6500);
    return () => clearTimeout(tm);
  }, [hover, t.leaving, t.id, t.timeout, dismiss]);
  return (
    <div
      role={t.status && glyphFor(t.status) === 'failed' ? 'alert' : 'status'}
      className="toast float w-full md:max-w-none"
      data-leaving={t.leaving || undefined}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      {/* One lead slot for every toast, so the titles line up down the stack. */}
      <span className="grid w-4 shrink-0 place-items-center">{t.status ? <StatusDot status={t.status} /> : t.icon ? <Icon name={t.icon} size={15} className="text-fg-3" /> : null}</span>
      <div className="min-w-0 flex-1 py-1">
        <div className="truncate font-medium text-fg">{t.title}</div>
        {t.body && <div className="truncate text-[12px] text-fg-3">{t.body}</div>}
      </div>
      {t.href && (
        <a href={t.href} onClick={() => dismiss(t.id)} className="press inline-flex h-8 shrink-0 items-center rounded-full bg-fg px-3.5 text-[12.5px] font-medium text-on-ink">
          {t.action ?? 'Open'}
        </a>
      )}
      <IconButton icon="x" label="Dismiss" size={14} onClick={() => dismiss(t.id)} />
    </div>
  );
}

/** Toasts shown at once. Older ones go, and the stack counts them. */
export const VISIBLE_TOASTS = 3;

/** A new toast at the bottom; past VISIBLE_TOASTS the oldest leaves and `more` counts it, until the stack empties. */
export function pushToast(stack: { items: ToastItem[]; more: number }, t: ToastItem): { items: ToastItem[]; more: number } {
  const items = [...stack.items, t];
  const over = Math.max(0, items.length - VISIBLE_TOASTS);
  return { items: items.slice(over), more: stack.more + over };
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [stack, setStack] = useState<{ items: ToastItem[]; more: number }>({ items: [], more: 0 });
  const seq = useRef(0);

  const dismiss = useCallback((id: number) => {
    setStack((s) => ({ ...s, items: s.items.map((t) => (t.id === id ? { ...t, leaving: true } : t)) }));
    setTimeout(
      () =>
        setStack((s) => {
          const items = s.items.filter((t) => t.id !== id);
          return { items, more: items.length ? s.more : 0 };
        }),
      240,
    );
  }, []);

  const push = useCallback((t: ToastInput) => {
    const id = ++seq.current;
    setStack((s) => pushToast(s, { ...t, id }));
  }, []);

  return (
    <Ctx.Provider value={push}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-4 bottom-[calc(88px+env(safe-area-inset-bottom))] z-[60] flex flex-col items-center gap-2 md:inset-x-auto md:right-5 md:bottom-5 md:w-[360px]"
      >
        {stack.more > 0 && <div className="float self-end rounded-full px-2.5 py-1 text-[12px] font-medium text-fg-3">+{stack.more} more</div>}
        {stack.items.map((t) => (
          <ToastView key={t.id} t={t} dismiss={dismiss} />
        ))}
      </div>
    </Ctx.Provider>
  );
}

const FINISHED = new Set(['done', 'failed', 'stopped']);

/** Toasts when a thread that was running or queued finishes, unless you are already looking at it. */
export function ThreadNotifier() {
  const toast = useToast();
  const route = useRoute();
  const routeRef = useRef(route);
  routeRef.current = route;
  const seen = useRef(new Map<string, string>());

  // Seed with what is already in flight, so finishes after page load are caught too.
  useEffect(() => {
    for (const status of ['running', 'queued']) {
      api
        .get<Thread[]>(`/threads?status=${status}&limit=100`)
        .then((list) => list.forEach((t) => !seen.current.has(t.id) && seen.current.set(t.id, t.status)))
        .catch(() => {});
    }
  }, []);

  useFeed((e) => {
    if (e.type !== 'thread') return;
    const t = e.thread;
    const prev = seen.current.get(t.id);
    seen.current.set(t.id, t.status);
    if (prev !== 'running' && prev !== 'queued') return;
    if (!FINISHED.has(t.status)) return;
    const glyph = threadGlyph(t);
    const r = routeRef.current;
    if (r.name === 'thread' && r.id === t.id && document.visibilityState === 'visible') return;
    toast({ status: glyph, title: t.title || 'Untitled thread', body: `${STATUS[glyph].label} in #${t.channel_id}`, href: href.thread(t.id) });
  });

  return null;
}
