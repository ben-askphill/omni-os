import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { api, type Thread } from '../api.ts';
import { href, useRoute } from '../router.ts';
import { useFeed } from '../store.tsx';
import { Icon, IconButton, StatusDot, type IconName } from './ui.tsx';

export interface ToastInput {
  title: ReactNode;
  body?: ReactNode;
  status?: string;
  icon?: IconName;
  href?: string;
  action?: string;
}

interface ToastItem extends ToastInput {
  id: number;
  leaving?: boolean;
}

const Ctx = createContext<(t: ToastInput) => void>(() => {});
export const useToast = () => useContext(Ctx);

function ToastView({ t, dismiss }: { t: ToastItem; dismiss: (id: number) => void }) {
  const [hover, setHover] = useState(false);
  useEffect(() => {
    if (hover || t.leaving) return;
    const tm = setTimeout(() => dismiss(t.id), 6500);
    return () => clearTimeout(tm);
  }, [hover, t.leaving, t.id, dismiss]);
  return (
    <div role="status" className="toast glass" data-leaving={t.leaving || undefined} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      {t.status ? <StatusDot status={t.status} /> : t.icon ? <Icon name={t.icon} size={15} className="text-fg-3" /> : null}
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

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);

  const dismiss = useCallback((id: number) => {
    setItems((l) => l.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
    setTimeout(() => setItems((l) => l.filter((t) => t.id !== id)), 240);
  }, []);

  const push = useCallback((t: ToastInput) => {
    const id = ++seq.current;
    setItems((l) => [...l.slice(-3), { ...t, id }]);
  }, []);

  return (
    <Ctx.Provider value={push}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-4 bottom-[calc(88px+env(safe-area-inset-bottom))] z-[60] flex flex-col items-center gap-2 md:inset-x-auto md:right-5 md:bottom-5 md:items-end"
      >
        {items.map((t) => (
          <ToastView key={t.id} t={t} dismiss={dismiss} />
        ))}
      </div>
    </Ctx.Provider>
  );
}

const FINISHED: Record<string, string> = { done: 'Finished', failed: 'Failed', stopped: 'Stopped' };

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
    const verb = FINISHED[t.status];
    if (!verb) return;
    const r = routeRef.current;
    if (r.name === 'thread' && r.id === t.id && document.visibilityState === 'visible') return;
    toast({ status: t.status, title: t.title || 'Untitled thread', body: `${verb} in #${t.channel_id}`, href: href.thread(t.id) });
  });

  return null;
}
