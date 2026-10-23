// The phone layout: three tab roots under a floating tab bar, screens pushed over them, sheets and a toast.
// Which screens show is derived from the hash (screens.ts); only the open sheet and the toast are local state.
import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { BrowserNotifier } from '../components/BrowserNotifier.tsx';
import { ContextMenuHost } from '../components/ContextMenu.tsx';
import { Onboarding } from '../components/Onboarding.tsx';
import { ThreadNotifier } from '../components/Toaster.tsx';
import { FolderDeleteDialog } from '../folders.tsx';
import { navigate, parseHash, useHash, type Route } from '../router.ts';
import { usePageTitle, useSyncOnReturn } from '../store.tsx';
import { MoToast } from './parts.tsx';
import { MoTabBar } from './MoTabBar.tsx';
import { RENDER, SheetView } from './registry.tsx';
import { placeEntry, rootTabOf, screenOf, specOf, stackOf, type NavDirection, type Tab } from './screens.ts';
import { ShellCtx, ThreadScope, type MobileShellApi, type ShellSheet } from './shell.tsx';

const TAB_PATH: Record<Tab, string> = { activity: '/', channels: '/channels', library: '/artifacts' };
const PUSH_MS = 420;

/** This entry's place in history, numbered the first time the app sees it, and which way the last move went. */
function useHistoryPlace(hash: string) {
  const last = useRef<number | null>(null);
  const [place, setPlace] = useState<{ hash: string; index: number; dir: NavDirection }>({ hash, index: 0, dir: 'none' });
  useLayoutEffect(() => {
    const p = placeEntry(last.current, history.state);
    if (p.fresh) history.replaceState({ ...(history.state && typeof history.state === 'object' ? history.state : {}), omni: p.index }, '');
    last.current = p.index;
    setPlace({ hash, index: p.index, dir: p.dir });
  }, [hash]);
  return place;
}

/**
 * iOS keeps the layout viewport under the keyboard, so a fixed shell would hide the composer behind it. The shell
 * follows the visual viewport's height instead.
 */
function useViewportHeight() {
  const [h, setH] = useState<number | null>(null);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const on = () => {
      setH(vv.height);
      if (window.scrollY) window.scrollTo(0, 0);
    };
    on();
    vv.addEventListener('resize', on);
    vv.addEventListener('scroll', on);
    return () => {
      vv.removeEventListener('resize', on);
      vv.removeEventListener('scroll', on);
    };
  }, []);
  return h;
}

interface Layer {
  route: Route;
  key: string;
}

/** Consecutive layers of one thread share its session. */
function groupByThread(layers: Layer[]): { thread: string | null; layers: Layer[] }[] {
  const out: { thread: string | null; layers: Layer[] }[] = [];
  for (const l of layers) {
    const thread = specOf(l.route).thread && l.route.name === 'thread' ? l.route.id : null;
    const prev = out[out.length - 1];
    if (thread && prev?.thread === thread) prev.layers.push(l);
    else out.push({ thread, layers: [l] });
  }
  return out;
}

// `isolate`: a layer's own z-indexes (its header, a segmented thumb) must not reach over the layer pushed above it.
const layerCls = 'absolute inset-0 isolate flex flex-col overflow-hidden bg-bg';

export function MobileShell() {
  const hash = useHash();
  const route = useMemo(() => parseHash(hash), [hash]);
  const place = useHistoryPlace(hash);
  const spec = specOf(route);
  const [sheet, setSheet] = useState<ShellSheet | null>(null);
  const [toast, setToast] = useState<{ text: string; key: number } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const height = useViewportHeight();

  // The tab under a pushed screen is the one it was opened from; a cold link uses the root its parents lead to.
  const [lastTab, setLastTab] = useState<Tab | null>(null);
  const tab: Tab = spec.root ?? spec.tab ?? lastTab ?? rootTabOf(route);
  useEffect(() => setLastTab(tab), [tab]);
  const [visited, setVisited] = useState<Tab[]>([tab]);
  useEffect(() => setVisited((v) => (v.includes(tab) ? v : [...v, tab])), [tab]);

  const stack = useMemo(() => stackOf(route, hash), [route, hash]);
  const top = stack[stack.length - 1];

  // Pushing a screen that is not the old top's child keeps the old top under it while the new one slides in.
  const prevTop = useRef<Layer | undefined>(undefined);
  const [underlay, setUnderlay] = useState<Layer | null>(null);
  useLayoutEffect(() => {
    const old = prevTop.current;
    prevTop.current = top;
    if (place.hash !== hash || place.dir !== 'forward' || !old || !top || stack.some((l) => l.key === old.key)) return;
    setUnderlay(old);
    const t = setTimeout(() => setUnderlay(null), PUSH_MS + 40);
    return () => clearTimeout(t);
  }, [top?.key, place]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => setSheet(null), [hash]);
  useSyncOnReturn();
  usePageTitle(route);

  const back = useCallback(() => {
    if (place.index > 0) history.back();
    else navigate(specOf(route).parent(route) ?? '/', { replace: true });
  }, [place.index, route]);

  const showToast = useCallback((text: string) => {
    clearTimeout(toastTimer.current);
    setToast({ text, key: Date.now() });
    toastTimer.current = setTimeout(() => setToast(null), 2200);
  }, []);
  useEffect(() => () => clearTimeout(toastTimer.current), []);

  const api = useMemo<MobileShellApi>(() => ({ back, open: (to) => navigate(to), sheet: setSheet, toast: showToast }), [back, showToast]);

  const pushedIn = place.hash === hash && place.dir === 'forward';
  const layers: Layer[] = underlay && !stack.some((l) => l.key === underlay.key) ? [underlay, ...stack] : stack;
  const renderLayer = (l: Layer): ReactNode => {
    const isTop = l === top;
    const style: CSSProperties = isTop && pushedIn ? { animation: `mo-push ${PUSH_MS}ms var(--ease-spring)` } : {};
    return (
      <div key={l.key} className={layerCls} style={style} inert={!isTop || undefined} aria-hidden={!isTop || undefined}>
        {RENDER[screenOf(l.route)](l.route)}
      </div>
    );
  };

  return (
    <ShellCtx.Provider value={api}>
      <div className="mo-app fixed inset-x-0 top-0 overflow-hidden bg-bg text-fg" style={{ height: height ?? '100%' }}>
        {visited.map((t) => {
          const shown = t === tab;
          const covered = !!top;
          return (
            <div
              key={t}
              className={layerCls}
              style={{ visibility: shown ? 'visible' : 'hidden', animation: shown && !covered && place.dir !== 'none' ? 'mo-fade 220ms var(--ease-out)' : 'none' }}
              inert={!shown || covered || undefined}
              aria-hidden={!shown || covered || undefined}
            >
              {RENDER[t](parseHash(`#${TAB_PATH[t]}`))}
            </div>
          );
        })}
        {groupByThread(layers).map((g) =>
          g.thread ? (
            <ThreadScope key={`thread:${g.thread}`} id={g.thread}>
              {g.layers.map(renderLayer)}
            </ThreadScope>
          ) : (
            <Fragment key={`solo:${g.layers[0].key}`}>{g.layers.map(renderLayer)}</Fragment>
          ),
        )}
        {!top && <MoTabBar tab={tab} onTab={(t) => t !== tab && navigate(TAB_PATH[t])} onNew={() => setSheet({ name: 'new' })} />}
        {sheet && <SheetView sheet={sheet} />}
        {toast && <MoToast key={toast.key} text={toast.text} />}
      </div>
      <Onboarding />
      <ThreadNotifier />
      <BrowserNotifier />
      <ContextMenuHost />
      <FolderDeleteDialog />
    </ShellCtx.Provider>
  );
}
