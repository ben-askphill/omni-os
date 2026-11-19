// The phone layout: four tab roots under a floating tab bar, screens pushed over them, sheets and a toast.
// Which screens show is derived from the hash (screens.ts); only the open sheet and the toast are local state.
import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { BrowserNotifier } from '../components/BrowserNotifier.tsx';
import { useDesktopLayoutActions } from '../components/DesktopHooks.tsx';
import { ContextMenuHost } from '../components/ContextMenu.tsx';
import { Onboarding } from '../lazy.tsx';
import { ThreadNotifier } from '../components/Toaster.tsx';
import { FolderDeleteDialog } from '../folders.tsx';
import { useInboxKey } from '../inbox-key.ts';
import { navigate, parseHash, useHash, type Route } from '../router.ts';
import { usePageTitle, useSyncOnReturn } from '../store.tsx';
import { MoToastRegion, type MoToastNote } from './parts.tsx';
import { MoTabBar } from './MoTabBar.tsx';
import { RENDER, SheetView } from './registry.tsx';
import { placeEntry, rootTabOf, screenOf, specOf, stackOf, type NavDirection, type Tab } from './screens.ts';
import { LayerShownCtx, SheetHostCtx, SheetStack } from './sheet-stack.ts';
import { ShellCtx, TabShownCtx, ThreadScope, type MobileShellApi, type ShellSheet } from './shell.tsx';
import { useStackTransitions } from './stack-transition.ts';

const TAB_PATH: Record<Tab, string> = { activity: '/', channels: '/channels', library: '/artifacts', prs: '/prs' };
// The push keyframe's length, where the browser has no view transition types.
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

/** The event the top thread screen was opened at (a search hit). */
const atOf = (layers: Layer[]) => {
  const r = layers[layers.length - 1]?.route;
  return r?.name === 'thread' ? r.at : undefined;
};

// `isolate`: a layer's own z-indexes (its header, a segmented thumb) must not reach over the layer pushed above it.
const layerCls = 'absolute inset-0 isolate flex flex-col overflow-hidden bg-bg';
/**
 * A layer no one can see: a tab in the background, or a screen under the top one once its push has played. Its
 * content skips style, layout and paint and keeps its rendering state, scroll positions included, for when it shows
 * again. Browsers without content-visibility draw it, under the opaque layers above it, as before.
 */
const SKIPPED: CSSProperties = { contentVisibility: 'hidden' };

export function MobileShell() {
  const hash = useHash();
  const route = useMemo(() => parseHash(hash), [hash]);
  const place = useHistoryPlace(hash);
  const spec = specOf(route);
  const [sheet, setSheet] = useState<ShellSheet | null>(null);
  const [toast, setToast] = useState<MoToastNote | null>(null);
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
  // A move a view transition played: the browser animates both screens, so none of the timed keyframes below run.
  const played = useStackTransitions(place.index);
  const viaTransition = played.current === hash;

  // Pushing a screen that is not the old top's child keeps the old top under it while the new one slides in.
  const prevTop = useRef<Layer | undefined>(undefined);
  const [underlay, setUnderlay] = useState<Layer | null>(null);
  useLayoutEffect(() => {
    // The new hash renders once before its place in history is known: keep the old top until it is.
    if (place.hash !== hash) return;
    const old = prevTop.current;
    prevTop.current = top;
    if (viaTransition || place.dir !== 'forward' || !old || !top || stack.some((l) => l.key === old.key)) return;
    setUnderlay(old);
    const t = setTimeout(() => setUnderlay(null), PUSH_MS + 40);
    return () => clearTimeout(t);
  }, [top?.key, place]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => setSheet(null), [hash]);
  useSyncOnReturn();
  useInboxKey(() => navigate(TAB_PATH.activity));
  useDesktopLayoutActions({
    newThread: () => setSheet({ name: 'new', channel: route.name === 'channel' ? route.id : undefined }),
    goTo: () => setSheet((s) => (s?.name === 'search' ? null : { name: 'search' })),
  });
  usePageTitle(route);

  const back = useCallback(() => {
    if (place.index > 0) history.back();
    else navigate(specOf(route).parent(route) ?? '/', { replace: true });
  }, [place.index, route]);

  // A note goes after a moment. An error stays until it is dismissed or another toast takes its place.
  const showToast = useCallback((text: string, tone?: 'error') => {
    clearTimeout(toastTimer.current);
    setToast({ text, key: Date.now(), error: tone === 'error' });
    if (tone !== 'error') toastTimer.current = setTimeout(() => setToast(null), 2200);
  }, []);
  const dismissToast = useCallback(() => {
    clearTimeout(toastTimer.current);
    setToast(null);
  }, []);

  // Every sheet renders into one host over the screens and the tab bar, and makes what is behind it inert.
  const [sheets] = useState(() => new SheetStack());
  const [sheetEl, setSheetEl] = useState<HTMLElement | null>(null);
  const sheetHost = useMemo(() => (sheetEl ? { el: sheetEl, stack: sheets } : null), [sheetEl, sheets]);
  const onScreens = useCallback((el: HTMLElement | null) => sheets.base('screens', el), [sheets]);
  const onTabBar = useCallback((el: HTMLElement | null) => sheets.base('tabs', el), [sheets]);
  useEffect(() => () => clearTimeout(toastTimer.current), []);

  const api = useMemo<MobileShellApi>(() => ({ back, open: (to) => navigate(to), sheet: setSheet, toast: showToast }), [back, showToast]);

  const pushedIn = !viaTransition && place.hash === hash && place.dir === 'forward';
  // The top screen whose push is still playing: what it covers stays drawn under it until it lands.
  const [pushing, setPushing] = useState<string | null>(null);
  useLayoutEffect(() => {
    if (!pushedIn || !top) return;
    setPushing(top.key);
    const t = setTimeout(() => setPushing(null), PUSH_MS + 40);
    return () => clearTimeout(t);
  }, [top?.key, pushedIn]); // eslint-disable-line react-hooks/exhaustive-deps
  const landed = !top || pushing !== top.key;
  const layers: Layer[] = underlay && !stack.some((l) => l.key === underlay.key) ? [underlay, ...stack] : stack;
  const renderLayer = (l: Layer): ReactNode => {
    const isTop = l === top;
    const style: CSSProperties = isTop && pushedIn ? { animation: `mo-push ${PUSH_MS}ms var(--ease-spring)` } : !isTop && landed ? SKIPPED : {};
    return (
      <div key={l.key} className={layerCls} style={style} inert={!isTop || undefined} aria-hidden={!isTop || undefined}>
        <LayerShownCtx.Provider value={isTop}>{RENDER[screenOf(l.route)](l.route)}</LayerShownCtx.Provider>
      </div>
    );
  };

  return (
    <ShellCtx.Provider value={api}>
      <SheetHostCtx.Provider value={sheetHost}>
        <div className="mo-app fixed inset-x-0 top-0 overflow-hidden bg-bg text-fg" style={{ height: height ?? '100%' }}>
          {/* The screens. An open sheet makes them inert (SheetStack), on this element. */}
          <main ref={onScreens} id="main" tabIndex={-1} className="absolute inset-0 outline-none">
            {visited.map((t) => {
              const shown = t === tab;
              const covered = !!top;
              return (
                <div
                  key={t}
                  className={layerCls}
                  style={{
                    visibility: shown ? 'visible' : 'hidden',
                    animation: shown && !covered && place.dir !== 'none' && !viaTransition ? 'mo-fade 220ms var(--ease-out)' : 'none',
                    // A tab in the background, or one a pushed screen has covered, skips layout and paint.
                    ...(!shown || (covered && landed) ? SKIPPED : {}),
                  }}
                  inert={!shown || covered || undefined}
                  aria-hidden={!shown || covered || undefined}
                >
                  <TabShownCtx.Provider value={shown && !covered}>
                    <LayerShownCtx.Provider value={shown && !covered}>{RENDER[t](parseHash(`#${TAB_PATH[t]}`))}</LayerShownCtx.Provider>
                  </TabShownCtx.Provider>
                </div>
              );
            })}
            {groupByThread(layers).map((g) =>
              g.thread ? (
                <ThreadScope key={`thread:${g.thread}`} id={g.thread} at={atOf(g.layers)}>
                  {g.layers.map(renderLayer)}
                </ThreadScope>
              ) : (
                <Fragment key={`solo:${g.layers[0].key}`}>{g.layers.map(renderLayer)}</Fragment>
              ),
            )}
          </main>
          <div ref={onTabBar}>{!top && <MoTabBar tab={tab} onTab={(t) => t !== tab && navigate(TAB_PATH[t])} onNew={() => setSheet({ name: 'new' })} />}</div>
          {/* Every sheet shows here, the shell's own and a screen's (MoSheet portals into it). */}
          <div ref={setSheetEl}>{sheet && <SheetView sheet={sheet} />}</div>
          <MoToastRegion note={toast} onDismiss={dismissToast} />
        </div>
        <Onboarding />
        <ThreadNotifier />
        <BrowserNotifier />
        <ContextMenuHost />
        <FolderDeleteDialog />
      </SheetHostCtx.Provider>
    </ShellCtx.Provider>
  );
}
