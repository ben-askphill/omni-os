import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { glyphLabel } from '@omni/shared/display.ts';
import { technicalNow } from '../display.ts';
import { api, type Thread } from '../api.ts';
import { href, useRoute } from '../router.ts';
import { useFeed } from '../store.tsx';
import { Icon, IconButton, StatusDot, glyphFor, threadGlyph, type IconName } from './ui.tsx';
import { subscribeModals, topModal } from './ui/use-modal-dialog.ts';

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
  // Held while the pointer is over it or the focus is in it, so a keyboard user who tabs to Open still finds it there.
  const [hover, setHover] = useState(false);
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (hover || focused || t.leaving) return;
    const tm = setTimeout(() => dismiss(t.id), t.timeout ?? 6500);
    return () => clearTimeout(tm);
  }, [hover, focused, t.leaving, t.id, t.timeout, dismiss]);
  return (
    <div
      role={t.status && glyphFor(t.status) === 'failed' ? 'alert' : 'status'}
      className="toast float w-full md:max-w-none"
      data-toast={t.id}
      data-leaving={t.leaving || undefined}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setFocused(true)}
      onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setFocused(false)}
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

/** Where the focus goes when a toast that holds it leaves: back where it came from, else into the page. */
function refocus(from: Element | null, region: HTMLElement) {
  const back = from instanceof HTMLElement && from.isConnected && !from.closest('[inert]') && !region.contains(from) ? from : null;
  (back ?? region.closest('dialog') ?? document.getElementById('main'))?.focus({ preventScroll: true });
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [stack, setStack] = useState<{ items: ToastItem[]; more: number }>({ items: [], more: 0 });
  const seq = useRef(0);
  const region = useRef<HTMLElement>(null);
  // What had the focus before it moved into a toast.
  const cameFrom = useRef<Element | null>(null);

  const dismiss = useCallback((id: number) => {
    const el = region.current?.querySelector(`[data-toast="${id}"]`);
    if (region.current && el?.contains(document.activeElement)) refocus(cameFrom.current, region.current);
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

  // A manual popover in the top layer, so the toasts stay over a modal's backdrop. The page behind a modal is inert
  // however high it sits, so while one is open the toasts render inside the top modal: still in the top layer, and
  // still clickable. A change of modal moves them, which remounts them in their new place.
  const modal = useSyncExternalStore(subscribeModals, topModal, () => null);
  useLayoutEffect(() => {
    const el = region.current;
    if (el && !el.matches(':popover-open')) el.showPopover();
  }, [modal]);

  // A page rendered to a string has no body to portal into, and no toasts to show.
  const place = modal ?? (typeof document === 'undefined' ? null : document.body);
  return (
    <Ctx.Provider value={push}>
      {children}
      {place &&
        createPortal(
          <section
            ref={region}
            popover="manual"
            aria-label="Notifications"
            aria-live="polite"
            onFocus={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget)) cameFrom.current = e.relatedTarget;
            }}
            className="pointer-events-none fixed inset-x-4 top-auto bottom-[calc(88px+env(safe-area-inset-bottom))] m-0 flex w-auto flex-col items-center gap-2 overflow-visible border-0 bg-transparent p-0 text-inherit md:inset-x-auto md:right-5 md:bottom-5 md:w-[360px]"
          >
            {stack.more > 0 && <div className="float self-end rounded-full px-2.5 py-1 text-[12px] font-medium text-fg-3">+{stack.more} more</div>}
            {stack.items.map((t) => (
              <ToastView key={t.id} t={t} dismiss={dismiss} />
            ))}
          </section>,
          place,
        )}
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
    // A quick ask is read where it was asked (packages/shared/quick-ask.ts), so its finish needs no toast.
    if (t.quick) return;
    const glyph = threadGlyph(t);
    const r = routeRef.current;
    if (r.name === 'thread' && r.id === t.id && document.visibilityState === 'visible') return;
    toast({ status: glyph, title: t.title || 'Untitled thread', body: `${glyphLabel(glyph, technicalNow())} in #${t.channel_id}`, href: href.thread(t.id) });
  });

  return null;
}
