// The desktop app's Web tab: Ben's own browser for the channel, a real <webview> in the app, as the Mac app's Web tab
// was a WKWebView. Its session is the app's persistent Web tab partition, so logins stay on this computer and last
// across launches; the agent drives the channel's server-side Chrome in the Browser tab and cannot see this one. The
// desktop app forces the partition, the pick preload, no Node and a sandbox on every <webview> (apps/desktop/src/
// native-browser.ts). Only rendered when the desktop bridge is there (ThreadPanel.tsx).
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { inspectReply, pickReply } from '@omni/shared/browser-pick-read.ts';
import type { RawInspect, RawPick } from '@omni/shared/browser-pick-script.ts';
import type { NativePageLook } from '@omni/shared/desktop-bridge.ts';
import type { BrowserCapture, ElementPick, LiveFrame } from '@omni/shared/message-context-browser.ts';
import { ApiError, api } from '../api.ts';
import { desktop } from '../desktop.ts';
import { AnnotateButton, AnnotateLayer, useAfterAdd, type AnnotateFrom } from './BrowserAnnotate.tsx';
import { LiveAnnotateCard } from './BrowserAnnotationOverlay.tsx';
import { displayUrl, splitAddress } from './LiveBrowser.tsx';
import { NativeAnnotateOverlay, useNativeLiveAnnotate, type NativePage } from './NativeBrowserAnnotate.tsx';
import { GuestLink, NativeCaptureError, captureProblem, inputPoint, inputScale, isWebPage, nativeCaptureQuery, pageMatches, resolveAddress, saveAddress, savedAddress } from './native-browser.ts';
import { Icon, IconButton } from './ui.tsx';

/** The part of Electron's <webview> element the Web tab uses. */
interface WebviewTag extends HTMLElement {
  loadURL(url: string): Promise<void>;
  getURL(): string;
  getTitle(): string;
  isLoading(): boolean;
  canGoBack(): boolean;
  canGoForward(): boolean;
  goBack(): void;
  goForward(): void;
  reload(): void;
  stop(): void;
  focus(): void;
  send(channel: string, ...args: unknown[]): void;
  sendInputEvent(event: Record<string, unknown>): void;
  getWebContentsId(): number;
  getZoomFactor(): number;
}

interface NavState {
  url: string;
  title: string;
  loading: boolean;
  canBack: boolean;
  canForward: boolean;
}

const BLANK: NavState = { url: '', title: '', loading: false, canBack: false, canForward: false };

const SAD = 'The page scrolled or changed after the screenshot. The screenshot and the area you mark still go with your message.';

/**
 * One channel's <webview>: what it shows, the page's own size and scroll for live Annotate, and the calls Annotate
 * makes of it. The element is made here and not by React. The main process gives it the Web tab's session and the
 * pick preload as it attaches, whatever its attributes say (apps/desktop/src/native-browser.ts).
 */
function useNativePage(channelId: string, host: React.RefObject<HTMLDivElement | null>, onKey: (key: string, down: boolean) => void) {
  const bridge = desktop!.nativeBrowser;
  const [view, setView] = useState<WebviewTag | null>(null);
  const [nav, setNav] = useState<NavState>(BLANK);
  const [failure, setFailure] = useState<{ description: string; url: string } | null>(null);
  const [frame, setFrame] = useState<LiveFrame | null>(null);
  const keyRef = useRef(onKey);
  keyRef.current = onKey;
  const ready = useRef(false);
  const link = useMemo(() => (view ? new GuestLink(view) : null), [view]);
  // The page each capture was taken of, which a pick on it is checked against.
  const shots = useRef(new Map<string, NativePageLook>());

  useLayoutEffect(() => {
    const box = host.current;
    if (!box) return;
    const el = document.createElement('webview') as WebviewTag;
    el.setAttribute('src', savedAddress(channelId) ?? 'about:blank');
    el.setAttribute('style', 'position:absolute;inset:0;width:100%;height:100%;');
    box.appendChild(el);
    ready.current = false;
    setNav(BLANK);
    setFailure(null);
    setFrame(null);
    setView(el);
    return () => {
      el.remove();
      setView(null);
    };
  }, [channelId, host]);

  useEffect(() => {
    if (!view || !link) return;
    const refresh = () => {
      if (!ready.current) return;
      try {
        setNav({ url: view.getURL(), title: view.getTitle(), loading: view.isLoading(), canBack: view.canGoBack(), canForward: view.canGoForward() });
      } catch {
        // Not attached any more.
      }
    };
    const relook = async () => {
      const page = await link.look();
      if (page) setFrame({ width: page.width, height: page.height, scroll: { x: page.scrollX, y: page.scrollY } });
    };
    const on: Record<string, (e: Event & Record<string, unknown>) => void> = {
      'dom-ready': () => {
        ready.current = true;
        refresh();
        void relook();
      },
      'did-start-loading': () => {
        setFailure(null);
        refresh();
      },
      'did-stop-loading': () => {
        refresh();
        void relook();
      },
      'did-navigate': (e) => {
        link.reset();
        saveAddress(channelId, String(e.url));
        refresh();
      },
      'did-navigate-in-page': (e) => {
        if (e.isMainFrame) saveAddress(channelId, String(e.url));
        refresh();
      },
      'page-title-updated': refresh,
      'did-fail-load': (e) => {
        // A navigation replaced by another (-3) is not a failure.
        if (!e.isMainFrame || e.errorCode === -3) return;
        setFailure({ description: String(e.errorDescription || 'The page could not be loaded.'), url: String(e.validatedURL || '') });
        refresh();
      },
      'ipc-message': (e) => {
        const event = link.receive(String(e.channel), (e.args as unknown[]) ?? []);
        if (event?.type === 'scroll') setFrame((f) => (f ? { ...f, scroll: { x: event.x, y: event.y } } : f));
        else if (event?.type === 'key') keyRef.current(event.key, event.down);
      },
    };
    for (const [name, fn] of Object.entries(on)) view.addEventListener(name, fn as EventListener);
    // The page lays out at the panel's size: ask again how big it is once that changes.
    let t: ReturnType<typeof setTimeout> | undefined;
    const ro = new ResizeObserver(() => {
      clearTimeout(t);
      t = setTimeout(() => void relook(), 100);
    });
    ro.observe(view);
    return () => {
      for (const [name, fn] of Object.entries(on)) view.removeEventListener(name, fn as EventListener);
      ro.disconnect();
      clearTimeout(t);
      link.reset();
    };
  }, [view, link, channelId]);

  const go = useCallback(
    (url: string) => {
      if (!view) return;
      setFailure(null);
      view.loadURL(url).catch(() => {
        // did-fail-load says why.
      });
    },
    [view],
  );
  const act = useCallback(
    (what: 'back' | 'forward' | 'reload' | 'stop') => {
      if (!view || !ready.current) return;
      if (what === 'back') view.goBack();
      else if (what === 'forward') view.goForward();
      else if (what === 'reload') view.reload();
      else view.stop();
    },
    [view],
  );

  const page: NativePage = {
    frame,
    url: nav.url,
    async inspect(p) {
      if (!link || !isWebPage(nav.url)) return null;
      const r = inspectReply((await link.ask({ op: 'inspect', x: p.x, y: p.y })) as RawInspect | null);
      return 'element' in r ? r.element : null;
    },
    async capture(threadId) {
      if (!view || !link) throw new NativeCaptureError('There is no page to annotate.', false);
      const before = await link.look();
      const problem = captureProblem(before, view.isLoading());
      if (problem || !before) throw problem ?? new NativeCaptureError('There is no page to annotate.', false);
      let shot;
      try {
        shot = await bridge.capture(view.getWebContentsId());
      } catch {
        throw new NativeCaptureError('The page could not be captured. Try again.', true);
      }
      const after = await link.look();
      if (!after || !pageMatches(before, after)) throw new NativeCaptureError('The page moved while the screenshot was taken. Try again.', true);
      const body = new Blob([shot.data as BlobPart], { type: shot.mime });
      try {
        const { capture } = await api.post<{ capture: BrowserCapture }>(`/channels/${encodeURIComponent(channelId)}/browser/capture/native?${nativeCaptureQuery(threadId, before)}`, body);
        shots.current.set(capture.image.name, before);
        return capture;
      } catch (e) {
        if (e instanceof ApiError && e.status === 409) throw new NativeCaptureError(e.message, true);
        throw e;
      }
    },
    async pick(capture, at): Promise<ElementPick> {
      const was = shots.current.get(capture.image.name);
      const note = ' The screenshot and the area you mark still go with your message.';
      if (!link || !was) return { unavailable: { reason: 'unknown_capture', message: `This screenshot is too old to look elements up in.${note}` } };
      const now = await link.look();
      if (!now || !pageMatches(now, was)) return { unavailable: { reason: 'stale', message: SAD } };
      const raw = (await link.ask({ op: 'pick', x: at.x, y: at.y })) as RawPick | null;
      const after = await link.look();
      if (!after || !pageMatches(after, was)) return { unavailable: { reason: 'stale', message: SAD } };
      return pickReply(raw, at, { width: was.width, height: was.height });
    },
    move(p) {
      try {
        if (view) view.sendInputEvent({ type: 'mouseMove', ...inputPoint(p, view.getZoomFactor()) });
      } catch {
        // Not attached.
      }
    },
    wheel(p, deltaX, deltaY) {
      try {
        if (!view) return;
        const zoom = view.getZoomFactor();
        // A trackpad's small fractions of a pixel add up, so the delta is not rounded.
        const z = inputScale(zoom);
        view.sendInputEvent({ type: 'mouseWheel', ...inputPoint(p, zoom), deltaX: -deltaX * z, deltaY: -deltaY * z, canScroll: true });
      } catch {
        // Not attached.
      }
    },
  };

  return { view, nav, failure, page, go, act };
}

/** True while Alt (Option) is held in the Omni page; the page's own Alt comes from the guest. */
function useAltHeld(guestAlt: boolean) {
  const [alt, setAlt] = useState(false);
  useEffect(() => {
    const on = (e: KeyboardEvent) => e.key === 'Alt' && setAlt(e.type === 'keydown');
    const off = () => setAlt(false);
    window.addEventListener('keydown', on);
    window.addEventListener('keyup', on);
    window.addEventListener('blur', off);
    return () => {
      window.removeEventListener('keydown', on);
      window.removeEventListener('keyup', on);
      window.removeEventListener('blur', off);
    };
  }, []);
  return alt || guestAlt;
}

function Toolbar({ nav, go, act, address, tools }: { nav: NavState; go: (url: string) => void; act: (what: 'back' | 'forward' | 'reload' | 'stop') => void; address: React.RefObject<HTMLInputElement | null>; tools?: React.ReactNode }) {
  const [text, setText] = useState('');
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (!editing) setText(nav.url === 'about:blank' ? '' : nav.url);
  }, [nav.url, editing]);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const url = resolveAddress(text);
    if (!url) return;
    go(url);
    address.current?.blur();
  };
  const [hostPart, path] = splitAddress(displayUrl(text));
  const mac = desktop?.platform === 'darwin';
  return (
    <div className="flex items-center gap-0.5 px-1.5 py-1.5">
      <IconButton icon="chevronLeft" label={mac ? 'Back (⌘[)' : 'Back'} disabled={!nav.canBack} onClick={() => act('back')} />
      <IconButton icon="chevronRight" label={mac ? 'Forward (⌘])' : 'Forward'} disabled={!nav.canForward} onClick={() => act('forward')} />
      {nav.loading ? (
        <IconButton icon="x" label="Stop loading" onClick={() => act('stop')} />
      ) : (
        <IconButton icon="refresh" label={mac ? 'Reload (⌘R)' : 'Reload (Ctrl+R)'} size={15} disabled={!nav.url || nav.url === 'about:blank'} onClick={() => act('reload')} />
      )}
      <form onSubmit={submit} className="relative ml-1 min-w-0 flex-1">
        {!editing && hostPart && (
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center truncate px-4 text-[13px]" aria-hidden>
            <span className="truncate">
              <span className="text-fg">{hostPart}</span>
              <span className="text-fg-4">{path}</span>
            </span>
          </span>
        )}
        <input
          ref={address}
          value={editing ? text : displayUrl(text)}
          onChange={(e) => setText(e.target.value)}
          onFocus={(e) => {
            setEditing(true);
            const el = e.target;
            requestAnimationFrame(() => el.select());
          }}
          onBlur={() => setEditing(false)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setText(nav.url === 'about:blank' ? '' : nav.url);
              e.currentTarget.blur();
              e.stopPropagation();
            }
          }}
          placeholder="Search Google or type a URL"
          aria-label="Address and search bar"
          spellCheck={false}
          autoComplete="off"
          className="h-9 w-full min-w-0 rounded-full border border-line bg-bg px-4 text-center text-[13px] text-fg outline-none placeholder:text-fg-4 hover:bg-surface-2 focus:bg-bg focus:text-left focus:shadow-[inset_0_0_0_2px_var(--line-strong)] [&:not(:focus)]:text-transparent [&:not(:focus)]:caret-transparent [&:not(:focus)]:placeholder:text-fg-4"
        />
      </form>
      {tools}
    </div>
  );
}

/**
 * The Web tab: a Chrome-like toolbar over the page, live Annotate on it as on the Browser tab, and the screenshot
 * editor one click away from a pick.
 */
export function NativeBrowser({ channelId, threadId }: { channelId: string; threadId?: string }) {
  const host = useRef<HTMLDivElement>(null);
  const address = useRef<HTMLInputElement>(null);
  const [annotating, setAnnotating] = useState(false);
  const [drawing, setDrawing] = useState<AnnotateFrom | null>(null);
  const [guestAlt, setGuestAlt] = useState(false);
  const escape = useRef<() => void>(() => {});
  const keys = useRef<(key: string, down: boolean) => void>(() => {});
  const { nav, failure, page, go, act } = useNativePage(channelId, host, (key, down) => keys.current(key, down));
  const alt = useAltHeld(guestAlt);
  const live = useNativeLiveAnnotate(page, channelId, threadId ?? '');
  const drawn = useAfterAdd(useCallback(() => setDrawing(null), []));
  const { clear, inspect } = live;
  const stop = useCallback(() => {
    setAnnotating(false);
    setGuestAlt(false);
    clear();
    void inspect(null);
  }, [clear, inspect]);
  const usable = isWebPage(nav.url) && !failure;
  useEffect(() => {
    if (annotating && !usable) stop();
  }, [annotating, usable, stop]);
  escape.current = () => {
    if (!annotating || drawing) return;
    if (live.state.selection) live.clear();
    else stop();
  };
  keys.current = (key, down) => {
    if (key === 'Alt') return setGuestAlt(down && annotating);
    if (!down) return;
    if (key === 'Escape') escape.current();
    else if (key === 'l') address.current?.focus();
    else if (key === 'r') act('reload');
    else if (key === '[') act('back');
    else if (key === ']') act('forward');
  };

  const on = annotating && !!threadId && !drawing;
  const blank = !nav.url || nav.url === 'about:blank';
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[14px] bg-bg">
        <Toolbar
          nav={nav}
          go={go}
          act={act}
          address={address}
          tools={threadId && <AnnotateButton state={{ running: usable, url: nav.url }} active={annotating} onClick={() => (annotating ? stop() : setAnnotating(true))} />}
        />
        <div className="relative h-px shrink-0 overflow-hidden bg-line">{nav.loading && <div className="load-bar absolute inset-y-0 left-0 w-full bg-fg-3" />}</div>
        <div className="relative flex min-h-0 flex-1 flex-col">
          <div ref={host} data-native-browser className="relative min-h-0 flex-1 overflow-hidden bg-bg" style={drawing ? { visibility: 'hidden' } : undefined} />
          {failure ? (
            <div className="absolute inset-0 grid place-items-center bg-bg p-6">
              <div className="max-w-[420px]">
                <div className="text-[15px] font-medium text-fg">This page can't be opened</div>
                <p className="mt-2 text-[13px] break-all text-fg-3">{failure.description}</p>
                {failure.url && <p className="mt-1 text-[13px] break-all text-fg-3">{failure.url}</p>}
              </div>
            </div>
          ) : (
            blank &&
            !nav.loading && (
              <div className="pointer-events-none absolute inset-0 grid place-items-center p-6 text-center">
                <div>
                  <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-full bg-surface-2 text-fg-3">
                    <Icon name="globe" size={19} />
                  </div>
                  <div className="font-display text-[17px]">Your own browser</div>
                  <div className="mt-1.5 max-w-sm text-[13px] text-fg-3">Pages and logins stay on this computer. The agent uses the Browser tab and can't see this one.</div>
                </div>
              </div>
            )
          )}
          {on && <NativeAnnotateOverlay page={page} box={host} live={live} alt={alt} />}
          {on && threadId && (
            <LiveAnnotateCard
              live={live}
              threadId={threadId}
              onDone={stop}
              onDraw={() => {
                const from = live.handOff();
                if (from) setDrawing(from);
              }}
            />
          )}
          {drawing && threadId && <AnnotateLayer channelId={channelId} threadId={threadId} from={drawing} onClose={() => setDrawing(null)} onAdded={drawn} />}
        </div>
      </div>
    </div>
  );
}
