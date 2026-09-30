import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode, type RefObject } from 'react';
import { api, errorText, openSSE } from '../api.ts';
import { Button, Icon, IconButton } from './ui.tsx';

export interface BrowserTabInfo {
  id: string;
  url: string;
  title: string;
  favicon?: string;
}

export interface BrowserState {
  running: boolean;
  url: string;
  title: string;
  loading: boolean;
  canBack: boolean;
  canForward: boolean;
  tabs: BrowserTabInfo[];
  active: string | null;
  viewport?: { width: number; height: number };
}

/** A decoded page frame, and the page viewport in CSS pixels it shows. */
interface Frame {
  bitmap: ImageBitmap;
  width: number;
  height: number;
}

type Input = Record<string, unknown> & { type: string };

/** CDP modifier bits: Alt 1, Ctrl 2, Meta 4, Shift 8. */
const modifiers = (e: { altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) =>
  (e.altKey ? 1 : 0) | (e.ctrlKey ? 2 : 0) | (e.metaKey ? 4 : 0) | (e.shiftKey ? 8 : 0);

const BUTTONS = ['left', 'middle', 'right'] as const;
/** CDP's `buttons` bits, by DOM button: left 1, right 2, middle 4. */
const BUTTON_BITS = [1, 4, 2];

/** The text a key types into the page: printable characters, and Enter, which submits forms. */
function keyText(e: KeyboardEvent) {
  if (e.metaKey || e.ctrlKey) return undefined;
  if (e.key === 'Enter') return '\r';
  return e.key.length === 1 ? e.key : undefined;
}

/** The address as Chrome shows it at rest: no scheme, no trailing slash on a bare host. */
export function displayUrl(url: string) {
  if (!url || url === 'about:blank') return '';
  return url.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/^([^/?#]+)\/$/, '$1');
}

/**
 * Adds an input event to the queue, merging it into the last one where that loses nothing:
 * consecutive moves keep only the newest, consecutive scrolls add up.
 */
export function enqueueInput(q: Input[], e: Input) {
  const last = q.at(-1);
  if (e.type === 'mouse' && e.event === 'mouseMoved' && last?.type === 'mouse' && last.event === 'mouseMoved') q[q.length - 1] = e;
  else if (e.type === 'wheel' && last?.type === 'wheel' && last.modifiers === e.modifiers)
    q[q.length - 1] = { ...e, deltaX: (last.deltaX as number) + (e.deltaX as number), deltaY: (last.deltaY as number) + (e.deltaY as number) };
  else q.push(e);
}

/**
 * One live view of the channel browser: the page as a stream of frames, with clicks, scrolling
 * and typing sent back, so Ben can drive the same Chrome the agent drives.
 */
export function useChannelBrowser(channelId: string) {
  const [state, setState] = useState<BrowserState | null>(null);
  const [hasFrame, setHasFrame] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [epoch, setEpoch] = useState(0);
  const [opened, setOpened] = useState(0);
  const base = `/channels/${encodeURIComponent(channelId)}/browser`;

  // Frames skip React: they are decoded off the main thread and drawn straight to the canvas.
  const frame = useRef<Frame | null>(null);
  const draw = useRef<(() => void) | null>(null);

  useEffect(() => {
    setError(null);
    let pending: { data: string; width: number; height: number } | null = null;
    let decoding = false;
    let alive = true;
    const decode = async () => {
      if (decoding || !pending) return;
      decoding = true;
      const f = pending;
      pending = null;
      try {
        const blob = await (await fetch(`data:image/jpeg;base64,${f.data}`)).blob();
        const bitmap = await createImageBitmap(blob);
        if (!alive) bitmap.close();
        else {
          frame.current?.bitmap.close();
          frame.current = { bitmap, width: f.width, height: f.height };
          draw.current?.();
          setHasFrame(true);
        }
      } catch {
        // A bad frame: the next one replaces it.
      }
      decoding = false;
      void decode();
    };
    const h = openSSE(
      () => `/api${base}/stream`,
      (d) => {
        const m = d as { type: string; state?: BrowserState; data?: string; width?: number; height?: number; error?: string };
        if (m.type === 'state' && m.state) {
          setState(m.state);
          if (!m.state.running) {
            frame.current = null;
            setHasFrame(false);
          }
        } else if (m.type === 'frame' && m.data) {
          // Only the newest frame waiting to decode counts.
          pending = { data: m.data, width: m.width!, height: m.height! };
          void decode();
        } else if (m.type === 'error') setError(m.error ?? 'The browser could not start');
      },
      {
        onOpen: () => {
          setError(null);
          setOpened((n) => n + 1);
        },
      },
    );
    return () => {
      alive = false;
      h.close();
    };
  }, [base, epoch]);

  // Input goes out in order, a batch at a time: while one is on its way, the next queues and merges.
  const queue = useRef<Input[]>([]);
  const sending = useRef(false);
  const flush = useCallback(async () => {
    if (sending.current || !queue.current.length) return;
    sending.current = true;
    const events = queue.current.splice(0);
    await api.post(`${base}/input`, { events }).catch(() => {});
    sending.current = false;
    void flush();
  }, [base]);
  const input = useCallback(
    (e: Input) => {
      enqueueInput(queue.current, e);
      void flush();
    },
    [flush],
  );

  const action = useCallback(
    async (body: Record<string, unknown>) => {
      try {
        const s = await api.post<BrowserState>(`${base}/action`, body);
        setState(s);
        setError(null);
      } catch (e) {
        setError(errorText(e));
      }
    },
    [base],
  );
  const restart = useCallback(async () => {
    await action({ action: 'restart' });
    setEpoch((n) => n + 1);
  }, [action]);
  const copy = useCallback(async () => {
    const { text } = await api.post<{ text: string }>(`${base}/copy`).catch(() => ({ text: '' }));
    if (text) await navigator.clipboard.writeText(text).catch(() => {});
    return text;
  }, [base]);

  return { state, hasFrame, frame, draw, error, input, action, restart, copy, opened };
}

type Browser = ReturnType<typeof useChannelBrowser>;

function Favicon({ tab, loading }: { tab: BrowserTabInfo; loading?: boolean }) {
  const [failed, setFailed] = useState<string | null>(null);
  if (loading) return <span className="spin h-3 w-3 shrink-0 rounded-full border-[1.5px] border-fg-4 border-t-transparent" />;
  if (!tab.favicon || failed === tab.favicon) return <Icon name="globe" size={13} className="shrink-0 text-fg-4" />;
  return <img src={tab.favicon} alt="" draggable={false} referrerPolicy="no-referrer" onError={() => setFailed(tab.favicon!)} className="h-4 w-4 shrink-0 rounded-[3px] object-contain" />;
}

/** Chrome's tab strip: every tab, the active one joined to the toolbar under it, and new tab. */
function TabStrip({ b }: { b: Browser }) {
  const s = b.state;
  const tabs = s?.tabs.length ? s.tabs : [{ id: 'blank', url: '', title: s?.running ? 'New Tab' : 'Starting' }];
  return (
    <div
      className="scroll-thin flex min-w-0 items-end gap-0.5 overflow-x-auto px-2 pt-0.5"
      onDoubleClick={(e) => e.target === e.currentTarget && void b.action({ action: 'newTab' })}
      role="tablist"
      aria-label="Browser tabs"
    >
      {tabs.map((t) => {
        const on = t.id === s?.active || tabs.length === 1;
        return (
          <div
            key={t.id}
            role="tab"
            aria-selected={on}
            data-on={on || undefined}
            title={t.title || t.url}
            onMouseDown={(e) => {
              if (e.button === 1) {
                e.preventDefault();
                void b.action({ action: 'closeTab', id: t.id });
              }
            }}
            onClick={() => !on && s?.running && void b.action({ action: 'tab', id: t.id })}
            className="group relative flex h-8 min-w-12 max-w-52 flex-1 cursor-default items-center gap-2 rounded-t-[12px] pr-1 pl-3 text-[12px] text-fg-3 hover:bg-surface-3/60 data-[on=true]:bg-bg data-[on=true]:text-fg"
          >
            <Favicon tab={t} loading={on && s?.loading} />
            <span className="min-w-0 flex-1 truncate">{t.title || displayUrl(t.url) || 'New Tab'}</span>
            {s?.running && t.id !== 'blank' && (
              <button
                type="button"
                aria-label={`Close ${t.title || 'tab'}`}
                onClick={(e) => {
                  e.stopPropagation();
                  void b.action({ action: 'closeTab', id: t.id });
                }}
                className="grid h-5 w-5 shrink-0 place-items-center rounded-full text-fg-4 opacity-0 group-hover:opacity-100 group-data-[on=true]:opacity-100 hover:bg-surface-3 hover:text-fg"
              >
                <Icon name="x" size={11} />
              </button>
            )}
          </div>
        );
      })}
      <IconButton icon="plus" label="New tab" size={14} className="mb-0.5 h-7 w-7" disabled={!s?.running} onClick={() => void b.action({ action: 'newTab' })} />
    </div>
  );
}

function Toolbar({ b, extra, address }: { b: Browser; extra?: ReactNode; address: RefObject<HTMLInputElement | null> }) {
  const s = b.state;
  const [url, setUrl] = useState('');
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (!editing) setUrl(s?.url === 'about:blank' ? '' : (s?.url ?? ''));
  }, [s?.url, editing]);
  const go = (e: FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;
    void b.action({ action: 'navigate', url });
    address.current?.blur();
  };
  const secure = s?.url.startsWith('https://');
  return (
    <div className="flex items-center gap-0.5 px-1.5 py-1.5">
      <IconButton icon="chevronLeft" label="Back (⌘[)" disabled={!s?.canBack} onClick={() => void b.action({ action: 'back' })} />
      <IconButton icon="chevronRight" label="Forward (⌘])" disabled={!s?.canForward} onClick={() => void b.action({ action: 'forward' })} />
      {s?.loading ? (
        <IconButton icon="x" label="Stop loading" onClick={() => void b.action({ action: 'stop' })} />
      ) : (
        <IconButton icon="refresh" label="Reload (⌘R)" size={15} disabled={!s?.running} onClick={() => void b.action({ action: 'reload' })} />
      )}
      <form onSubmit={go} className="relative ml-1 min-w-0 flex-1">
        <Icon name={secure ? 'lock' : s?.url && s.url !== 'about:blank' ? 'info' : 'search'} size={12} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-fg-3" />
        <input
          ref={address}
          value={editing ? url : displayUrl(url)}
          onChange={(e) => setUrl(e.target.value)}
          onFocus={(e) => {
            setEditing(true);
            const el = e.target;
            requestAnimationFrame(() => el.select());
          }}
          onBlur={() => setEditing(false)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setUrl(s?.url === 'about:blank' ? '' : (s?.url ?? ''));
              e.currentTarget.blur();
              e.stopPropagation();
            }
          }}
          placeholder="Search Google or type a URL"
          aria-label="Address and search bar"
          spellCheck={false}
          autoComplete="off"
          className="h-8 w-full min-w-0 rounded-full bg-surface-2 pr-3 pl-8 text-[13px] text-fg outline-none placeholder:text-fg-4 hover:bg-surface-3 focus:bg-bg focus:shadow-[inset_0_0_0_2px_var(--line-strong)]"
        />
      </form>
      {extra}
    </div>
  );
}

/**
 * The page itself, drawn on a canvas at the panel's size. The page lays out at that size too (the
 * viewer reports it), so it reads like a normal browser window rather than a shrunk desktop.
 * Focus it (click) and keys go to the page, with Chrome's shortcuts on top.
 */
function Viewport({ b, address }: { b: Browser; address: RefObject<HTMLInputElement | null> }) {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const down = useRef(0);
  /** Where the frame is drawn: CSS pixels per page pixel. */
  const scale = useRef(1);
  const { input, action, frame, copy } = b;
  const running = !!b.state?.running;

  const paint = useCallback(() => {
    const c = canvas.current;
    const el = box.current;
    const f = frame.current;
    if (!c || !el) return;
    const w = el.clientWidth;
    const h = el.clientHeight;
    const dpr = window.devicePixelRatio || 1;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
    }
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (!f) return;
    // Full width, top aligned. Once the page follows the panel size, this is 1:1.
    const s = w / f.width;
    scale.current = s;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(f.bitmap, 0, 0, f.width * s, f.height * s);
  }, [frame]);

  useEffect(() => {
    b.draw.current = paint;
    paint();
    return () => {
      b.draw.current = null;
    };
  }, [b.draw, paint]);

  // The page follows the panel: report its size (debounced) whenever it changes, when the stream
  // (re)opens, and when this view is used, so with two viewers the one in use wins.
  const size = useRef({ w: 0, h: 0 });
  const report = useCallback(() => {
    const { w, h } = size.current;
    if (w && h) void action({ action: 'resize', width: w, height: h, scale: window.devicePixelRatio || 1 });
  }, [action]);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    let t: ReturnType<typeof setTimeout> | undefined;
    const ro = new ResizeObserver(() => {
      size.current = { w: el.clientWidth, h: el.clientHeight };
      paint();
      clearTimeout(t);
      t = setTimeout(report, 120);
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      clearTimeout(t);
    };
  }, [paint, report]);
  useEffect(() => {
    if (running) report();
  }, [running, b.opened, report]);
  const vp = b.state?.viewport;
  const claim = () => {
    const { w, h } = size.current;
    if (running && vp && (Math.abs(vp.width - w) > 1 || Math.abs(vp.height - h) > 1)) report();
  };

  const point = (e: { clientX: number; clientY: number }) => {
    const r = canvas.current!.getBoundingClientRect();
    return { x: Math.round((e.clientX - r.left) / scale.current), y: Math.round((e.clientY - r.top) / scale.current) };
  };

  const mouse = (event: 'mousePressed' | 'mouseReleased' | 'mouseMoved') => (e: ReactMouseEvent) => {
    if (!frame.current) return;
    if (event === 'mousePressed') {
      box.current?.focus();
      down.current |= BUTTON_BITS[e.button] ?? 0;
      claim();
    }
    if (event === 'mouseReleased') down.current &= ~(BUTTON_BITS[e.button] ?? 0);
    e.preventDefault();
    const button = event === 'mouseMoved' ? (down.current & 1 ? 'left' : down.current & 2 ? 'right' : down.current & 4 ? 'middle' : 'none') : (BUTTONS[e.button] ?? 'left');
    input({ type: 'mouse', event, ...point(e), button, buttons: down.current, clickCount: event === 'mouseMoved' ? 0 : e.detail || 1, modifiers: modifiers(e) });
  };

  // React's onWheel is passive, and the panel must not scroll while the page does.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!frame.current) return;
      e.preventDefault();
      const line = e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? el.clientHeight : 1;
      input({ type: 'wheel', ...point(e), deltaX: Math.round((e.deltaX * line) / scale.current), deltaY: Math.round((e.deltaY * line) / scale.current), modifiers: modifiers(e) });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [frame, input]);

  /** Chrome's own shortcuts. True when handled here rather than sent to the page. */
  const shortcut = (e: KeyboardEvent) => {
    if (!e.metaKey || e.ctrlKey || e.altKey) return false;
    const k = e.key.toLowerCase();
    const s = b.state;
    const run = (body: Record<string, unknown>) => void action(body);
    if (k === 'l') address.current?.focus();
    else if (k === 't') run({ action: 'newTab' });
    else if (k === 'w' && s?.active) run({ action: 'closeTab', id: s.active });
    else if (k === 'r') run({ action: 'reload' });
    else if (k === '[') run({ action: 'back' });
    else if (k === ']') run({ action: 'forward' });
    else if (k === 'c') void copy();
    else if (k === 'x') void copy().then((t) => t && input({ type: 'key', event: 'keyDown', key: 'Backspace', code: 'Backspace', keyCode: 8 }));
    else return false;
    return true;
  };

  const key = (event: 'keyDown' | 'keyUp') => (e: KeyboardEvent) => {
    // Cmd-V arrives as a paste event with the text.
    if (e.metaKey && e.key.toLowerCase() === 'v') return;
    e.preventDefault();
    e.stopPropagation();
    if (event === 'keyDown' && shortcut(e)) return;
    if (event === 'keyUp' && e.metaKey && /^[ltwr[\]cx]$/i.test(e.key)) return;
    input({ type: 'key', event, key: e.key, code: e.code, text: event === 'keyDown' ? keyText(e) : undefined, keyCode: e.keyCode, modifiers: modifiers(e) });
  };

  return (
    <div
      ref={box}
      tabIndex={0}
      onKeyDown={key('keyDown')}
      onKeyUp={key('keyUp')}
      onPaste={(e) => {
        const text = e.clipboardData.getData('text/plain');
        if (text) input({ type: 'text', text });
        e.preventDefault();
      }}
      onFocus={claim}
      onContextMenu={(e) => e.preventDefault()}
      className="relative min-h-0 flex-1 overflow-hidden bg-bg outline-none"
      aria-label="Live browser. Click to interact, then type."
    >
      <canvas
        ref={canvas}
        onMouseDown={mouse('mousePressed')}
        onMouseUp={mouse('mouseReleased')}
        onMouseMove={mouse('mouseMoved')}
        className="absolute inset-0 block h-full w-full cursor-default select-none"
        role="img"
        aria-label={b.state?.title || 'Browser page'}
      />
      {!b.hasFrame && !b.error && (
        <div className="absolute inset-0 grid place-items-center p-6 text-center text-[12.5px] text-fg-3">
          <span className="flex items-center gap-2">
            <span className="pulse h-1.5 w-1.5 rounded-full bg-fg-4" /> {running ? 'Waiting for the page' : 'Starting the browser'}
          </span>
        </div>
      )}
    </div>
  );
}

/**
 * The thread panel's browser: the channel's own Chrome, live, in a Chrome-like frame (tabs on top,
 * then the toolbar). The agent drives it through its browser MCP; Ben can take over at any point
 * (a login, a captcha) and hand it back.
 */
export function LiveBrowser({ channelId, extra }: { channelId: string; extra?: ReactNode }) {
  const b = useChannelBrowser(channelId);
  const address = useRef<HTMLInputElement>(null);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <TabStrip b={b} />
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[14px] bg-bg">
        <Toolbar b={b} extra={extra} address={address} />
        <div className="relative h-px shrink-0 overflow-hidden bg-line">
          {b.state?.loading && <div className="load-bar absolute inset-y-0 left-0 w-full bg-fg-3" />}
        </div>
        {b.error && (
          <div className="flex items-center gap-2 border-b border-line px-3 py-2 text-[12px] text-fg-2">
            <Icon name="alert" size={13} className="shrink-0 text-fg-3" />
            <span className="min-w-0 flex-1">{b.error}</span>
            <Button size="sm" onClick={() => void b.restart()}>
              Restart
            </Button>
          </div>
        )}
        <Viewport b={b} address={address} />
      </div>
    </div>
  );
}
