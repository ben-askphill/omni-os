import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import { api, errorText, openSSE } from '../api.ts';
import { Button, Icon, IconButton } from './ui.tsx';

export interface BrowserTabInfo {
  id: string;
  url: string;
  title: string;
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
}

interface Frame {
  src: string;
  width: number;
  height: number;
}

/** CDP modifier bits: Alt 1, Ctrl 2, Meta 4, Shift 8. */
const modifiers = (e: { altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) =>
  (e.altKey ? 1 : 0) | (e.ctrlKey ? 2 : 0) | (e.metaKey ? 4 : 0) | (e.shiftKey ? 8 : 0);

const BUTTONS = ['left', 'middle', 'right'] as const;

/** The text a key types into the page: printable characters, and Enter, which submits forms. */
function keyText(e: KeyboardEvent) {
  if (e.metaKey || e.ctrlKey) return undefined;
  if (e.key === 'Enter') return '\r';
  return e.key.length === 1 ? e.key : undefined;
}

/**
 * One live view of the channel browser: the page as a stream of frames, with clicks, scrolling
 * and typing sent back, so Ben can drive the same Chrome the agent drives.
 */
export function useChannelBrowser(channelId: string) {
  const [state, setState] = useState<BrowserState | null>(null);
  const [frame, setFrame] = useState<Frame | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [epoch, setEpoch] = useState(0);
  const base = `/channels/${encodeURIComponent(channelId)}/browser`;

  useEffect(() => {
    setError(null);
    const h = openSSE(
      () => `/api${base}/stream`,
      (d) => {
        const m = d as { type: string; state?: BrowserState; data?: string; width?: number; height?: number; error?: string };
        if (m.type === 'state' && m.state) {
          setState(m.state);
          if (!m.state.running) setFrame(null);
        } else if (m.type === 'frame' && m.data) setFrame({ src: `data:image/jpeg;base64,${m.data}`, width: m.width!, height: m.height! });
        else if (m.type === 'error') setError(m.error ?? 'The browser could not start');
      },
      { onOpen: () => setError(null) },
    );
    return () => h.close();
  }, [base, epoch]);

  // Input goes out in order: a key up must never overtake its key down.
  const chain = useRef(Promise.resolve());
  const input = useCallback(
    (body: Record<string, unknown>) => {
      chain.current = chain.current.then(() => api.post(`${base}/input`, body).then(() => {}, () => {}));
    },
    [base],
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

  return { state, frame, error, input, action, restart };
}

type Browser = ReturnType<typeof useChannelBrowser>;

function Toolbar({ b, extra }: { b: Browser; extra?: ReactNode }) {
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
    (document.activeElement as HTMLElement | null)?.blur();
  };
  return (
    <div className="flex items-center gap-0.5 px-2 pb-2">
      <IconButton icon="chevronLeft" label="Back" disabled={!s?.canBack} onClick={() => void b.action({ action: 'back' })} />
      <IconButton icon="chevronRight" label="Forward" disabled={!s?.canForward} onClick={() => void b.action({ action: 'forward' })} />
      {s?.loading ? (
        <IconButton icon="x" label="Stop loading" onClick={() => void b.action({ action: 'stop' })} />
      ) : (
        <IconButton icon="refresh" label="Reload" size={15} disabled={!s?.running} onClick={() => void b.action({ action: 'reload' })} />
      )}
      <form onSubmit={go} className="relative min-w-0 flex-1">
        <Icon name={s?.url.startsWith('https://') ? 'lock' : 'globe'} size={12} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-fg-4" />
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onFocus={(e) => {
            setEditing(true);
            e.target.select();
          }}
          onBlur={() => setEditing(false)}
          onKeyDown={(e) => e.key === 'Escape' && (e.currentTarget.blur(), e.stopPropagation())}
          placeholder="Search or enter address"
          aria-label="Address"
          spellCheck={false}
          className="h-8 w-full min-w-0 rounded-full bg-bg pr-3 pl-7 font-num text-[12px] text-fg outline-none placeholder:text-fg-4 focus:shadow-[inset_0_0_0_1px_var(--line-strong)]"
        />
      </form>
      {extra}
    </div>
  );
}

function TabStrip({ b }: { b: Browser }) {
  const s = b.state;
  if (!s || s.tabs.length < 2) return null;
  return (
    <div className="scroll-thin flex gap-1 overflow-x-auto px-2.5 pb-2">
      {s.tabs.map((t) => (
        <div
          key={t.id}
          data-on={t.id === s.active || undefined}
          className="group flex h-7 max-w-44 shrink-0 items-center rounded-full bg-bg pr-1 pl-3 text-[11.5px] text-fg-3 data-[on=true]:bg-surface-3 data-[on=true]:text-fg"
        >
          <button type="button" className="min-w-0 truncate text-left" title={t.url} onClick={() => void b.action({ action: 'tab', id: t.id })}>
            {t.title || t.url || 'New tab'}
          </button>
          <button type="button" aria-label="Close tab" className="ml-1 grid h-5 w-5 place-items-center rounded-full text-fg-4 opacity-0 group-hover:opacity-100 hover:text-fg" onClick={() => void b.action({ action: 'closeTab', id: t.id })}>
            <Icon name="x" size={11} />
          </button>
        </div>
      ))}
      <IconButton icon="plus" label="New tab" size={14} className="h-7 w-7" onClick={() => void b.action({ action: 'newTab' })} />
    </div>
  );
}

/** The page itself. Focus it (click) and keys go to the page; paste types the clipboard. */
function Viewport({ b, fill }: { b: Browser; fill?: boolean }) {
  const img = useRef<HTMLImageElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const down = useRef(0);
  const lastMove = useRef(0);
  const frame = b.frame;

  const point = (e: { clientX: number; clientY: number }) => {
    const r = img.current!.getBoundingClientRect();
    const f = frame!;
    return { x: Math.round(((e.clientX - r.left) / r.width) * f.width), y: Math.round(((e.clientY - r.top) / r.height) * f.height) };
  };

  const mouse = (event: 'mousePressed' | 'mouseReleased' | 'mouseMoved') => (e: MouseEvent) => {
    if (!frame) return;
    if (event === 'mouseMoved') {
      const now = performance.now();
      if (now - lastMove.current < 33) return;
      lastMove.current = now;
    }
    if (event === 'mousePressed') {
      box.current?.focus();
      down.current = 1 << e.button;
    }
    if (event === 'mouseReleased') down.current = 0;
    e.preventDefault();
    b.input({ type: 'mouse', event, ...point(e), button: event === 'mouseMoved' ? (down.current ? 'left' : 'none') : BUTTONS[e.button] ?? 'left', buttons: down.current, clickCount: event === 'mouseMoved' ? 0 : e.detail || 1, modifiers: modifiers(e) });
  };

  // React's onWheel is passive, and the panel must not scroll while the page does.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!img.current || !frame) return;
      e.preventDefault();
      const scale = frame.width / img.current.getBoundingClientRect().width;
      b.input({ type: 'wheel', ...point(e), deltaX: Math.round(e.deltaX * scale), deltaY: Math.round(e.deltaY * scale), modifiers: modifiers(e) });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  });

  const key = (event: 'keyDown' | 'keyUp') => (e: KeyboardEvent) => {
    // Cmd+V arrives as a paste event with the text.
    if (e.metaKey && e.key.toLowerCase() === 'v') return;
    e.preventDefault();
    e.stopPropagation();
    b.input({ type: 'key', event, key: e.key, code: e.code, text: event === 'keyDown' ? keyText(e) : undefined, keyCode: e.keyCode, modifiers: modifiers(e) });
  };

  return (
    <div
      ref={box}
      tabIndex={0}
      onKeyDown={key('keyDown')}
      onKeyUp={key('keyUp')}
      onPaste={(e) => {
        const text = e.clipboardData.getData('text/plain');
        if (text) b.input({ type: 'text', text });
        e.preventDefault();
      }}
      onContextMenu={(e) => e.preventDefault()}
      className={`scroll-thin relative min-h-0 flex-1 overflow-auto bg-bg outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--line-strong)] ${fill ? '' : 'rounded-b-[18px]'}`}
      aria-label="Live browser. Click to interact, then type."
    >
      {frame ? (
        <img
          ref={img}
          src={frame.src}
          alt={b.state?.title || 'Browser page'}
          draggable={false}
          onMouseDown={mouse('mousePressed')}
          onMouseUp={mouse('mouseReleased')}
          onMouseMove={mouse('mouseMoved')}
          className={`block w-full cursor-default select-none ${fill ? 'max-h-full object-contain object-top' : ''}`}
        />
      ) : (
        <div className="grid h-full place-items-center p-6 text-center text-[12.5px] text-fg-3">
          {b.error ? null : (
            <span className="flex items-center gap-2">
              <span className="pulse h-1.5 w-1.5 rounded-full bg-fg-4" /> {b.state?.running ? 'Waiting for the page' : 'Starting the browser'}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * The thread panel's browser: the channel's own Chrome, live. The agent drives it through its
 * browser MCP; Ben can take over at any point (a login, a captcha) and hand it back.
 */
export function LiveBrowser({ channelId, extra, fill }: { channelId: string; extra?: ReactNode; fill?: boolean }) {
  const b = useChannelBrowser(channelId);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <Toolbar b={b} extra={extra} />
      <TabStrip b={b} />
      {b.error && (
        <div className="mx-2.5 mb-2 flex items-center gap-2 rounded-2xl bg-bg px-3 py-2 text-[12px] text-fg-2">
          <Icon name="alert" size={13} className="shrink-0 text-fg-3" />
          <span className="min-w-0 flex-1">{b.error}</span>
          <Button size="sm" onClick={() => void b.restart()}>
            Restart
          </Button>
        </div>
      )}
      <Viewport b={b} fill={fill} />
    </div>
  );
}
