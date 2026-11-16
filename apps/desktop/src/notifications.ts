// Native notifications, raised by the main process so they arrive with every window closed (a Mac keeps the app in
// the Dock). It reads the server's feed (/api/feed) and Needs you with the install's token, and asks the shared
// tracker (packages/shared/attention.ts) what is news: a finished or failed thread, a question waiting for an answer,
// a crew report in the Conductor, a watched PR that needs attention. Clicking one opens its thread in the main window.
// The page posts none of its own while the bridge says `nativeNotifications`.
import { BrowserWindow, Notification } from 'electron';
import { allows, createTracker, type AlertPrefs, type AttentionAlert, type AttentionItem, type FeedAlert } from '@omni/shared/attention.ts';
import type { AppContext } from './context.ts';
import { handle } from './handle.ts';
import { omniWindows } from './windows.ts';

/** A notification on screen, as far as this module cares. */
export interface Shown {
  close(): void;
}

export interface NotifierDeps {
  needsYou(): Promise<{ items: AttentionItem[] }>;
  /** Channel names by id, for the body. */
  channels(): Promise<{ id: string; name: string }[]>;
  prefs(): AlertPrefs;
  /** The thread on screen in the Omni window in front, and whether one is in front. */
  focus(): { viewing: string | null; visible: boolean };
  post(alert: AttentionAlert): Shown;
  now(): number;
  /** Waits before reloading Needs you after thread events, which come in bursts while turns run. */
  later(fn: () => void, ms: number): void;
}

/** A thread event reloads Needs you after this long, once however many came in it. */
export const THREAD_SETTLE_MS = 500;
/** Notifications this module keeps a hold of. An older one stays in Notification Center; it just cannot be withdrawn. */
const KEEP = 50;

export interface DesktopNotifier {
  /** Each event the feed sends, parsed. */
  event(e: { type?: string; alert?: FeedAlert }): void;
  /** The feed connected: the first time primes the tracker, a reconnect catches up on what came while it was down. */
  connected(): void;
  /** Reload Needs you now. Resolves when the alerts it brings are posted. */
  refresh(): Promise<void>;
}

export function createDesktopNotifier(deps: NotifierDeps): DesktopNotifier {
  const tracker = createTracker();
  /** By alert id, oldest first. */
  const open = new Map<string, { threadId: string; shown: Shown }>();
  let names = new Map<string, string>();
  let busy: Promise<void> | null = null;
  let again = false;
  let settling = false;

  const options = () => {
    const f = deps.focus();
    return { now: deps.now(), viewing: f.viewing, visible: f.visible, allows: allows(deps.prefs()), channelName: (id: string) => names.get(id) };
  };

  const withdraw = (id: string) => {
    open.get(id)?.shown.close();
    open.delete(id);
  };

  const show = (alert: AttentionAlert) => {
    // One notification per thread: the newest says where it stands, so an older one for it goes.
    for (const [id, o] of open) if (o.threadId === alert.threadId) withdraw(id);
    let shown: Shown;
    try {
      shown = deps.post(alert);
    } catch (err) {
      console.error('[notify] could not post:', (err as Error).message);
      return;
    }
    open.set(alert.id, { threadId: alert.threadId, shown });
    while (open.size > KEEP) open.delete(open.keys().next().value!);
  };

  const loadNames = () =>
    deps.channels().then(
      (list) => void (names = new Map(list.map((c) => [c.id, c.name]))),
      () => undefined,
    );

  async function load() {
    const list = await deps.needsYou();
    const changes = tracker.observe(list, options());
    changes.withdraw.forEach(withdraw);
    changes.post.forEach(show);
  }

  /** One load at a time; a call while one runs loads once more after it. */
  function refresh(): Promise<void> {
    if (busy) {
      again = true;
      return busy;
    }
    busy = (async () => {
      do {
        again = false;
        try {
          await load();
        } catch {
          // The server is restarting or busy. The next event or reconnect tries again.
        }
      } while (again);
      busy = null;
    })();
    return busy;
  }

  return {
    event(e) {
      if (e.type === 'alert' && e.alert) {
        const alert = tracker.feed(e.alert, options());
        if (alert) show(alert);
      } else if (e.type === 'needs_you') {
        void refresh();
      } else if (e.type === 'thread' || e.type === 'channel') {
        if (e.type === 'channel') void loadNames();
        if (settling) return;
        settling = true;
        deps.later(() => {
          settling = false;
          void refresh();
        }, THREAD_SETTLE_MS);
      }
    },
    connected() {
      void loadNames().then(refresh);
    },
    refresh,
  };
}

/** The thread a Web UI address shows (`#/t/<id>`), if any. */
export function threadInUrl(url: string): string | null {
  const hash = url.slice(url.indexOf('#') + 1 || url.length);
  const m = /^\/t\/([^/?#]+)/.exec(hash);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return null;
  }
}

/**
 * Server-sent events from a byte stream: each `data:` payload, joined across lines, once its blank line comes.
 * `rest` is what has not ended yet; hand it back with the next chunk.
 */
export function parseSSE(buffer: string): { data: string[]; rest: string } {
  const data: string[] = [];
  const blocks = buffer.replace(/\r\n?/g, '\n').split('\n\n');
  const rest = blocks.pop() ?? '';
  for (const block of blocks) {
    const lines = block.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).replace(/^ /, ''));
    if (lines.length && lines.join('').length) data.push(lines.join('\n'));
  }
  return { data, rest };
}

/** Waits after a dropped feed: 1 s, doubling to 30 s. */
export const reconnectMs = (failures: number) => Math.min(1000 * 2 ** failures, 30_000);

export interface FeedDeps {
  url(): string;
  token(): string | null;
  fetch: typeof fetch;
  onOpen(): void;
  onData(data: unknown): void;
  sleep(ms: number): Promise<void>;
}

/** Reads the feed until `signal` aborts, connecting again after each drop. */
export async function followFeed(deps: FeedDeps, signal: AbortSignal): Promise<void> {
  let failures = 0;
  while (!signal.aborted) {
    try {
      const token = deps.token();
      const res = await deps.fetch(deps.url(), {
        headers: { accept: 'text/event-stream', ...(token ? { authorization: `Bearer ${token}` } : {}) },
        signal,
      });
      if (!res.ok || !res.body) throw new Error(`feed answered ${res.status}`);
      failures = 0;
      deps.onOpen();
      const decoder = new TextDecoder();
      let rest = '';
      for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
        const parsed = parseSSE(rest + decoder.decode(chunk, { stream: true }));
        rest = parsed.rest;
        for (const d of parsed.data) {
          try {
            deps.onData(JSON.parse(d));
          } catch {
            // Not JSON: nothing this module reads.
          }
        }
      }
    } catch {
      if (signal.aborted) return;
    }
    if (signal.aborted) return;
    await deps.sleep(reconnectMs(failures++));
  }
}

// ---------- Electron ----------

/** What onboarding's Notifications step posts, so the OS asks for permission then (bridge `testNotification`). */
export const TEST_NOTIFICATION = { title: 'Omni', body: 'Notifications are on. Omni tells you here when a thread needs you.' };

/** Posts the sample notification. False when this system cannot show one. */
export function postTestNotification(ctx: Pick<AppContext, 'paths' | 'showMain'>, notify: { isSupported(): boolean; show(options: Electron.NotificationConstructorOptions, onClick: () => void): void }): boolean {
  if (!notify.isSupported()) return false;
  notify.show({ ...TEST_NOTIFICATION, ...(ctx.paths.icon && process.platform !== 'darwin' ? { icon: ctx.paths.icon } : {}) }, () => ctx.showMain());
  return true;
}

const electronNotify = {
  isSupported: () => Notification.isSupported(),
  show(options: Electron.NotificationConstructorOptions, onClick: () => void) {
    const n = new Notification(options);
    n.on('click', onClick);
    n.show();
  },
};

/** Follows the server while it is up, and posts what the tracker says is news. */
export function installNotifications(ctx: AppContext): void {
  handle('omni:notifications:test', () => postTestNotification(ctx, electronNotify));
  if (!Notification.isSupported()) return;
  const { backend, settings } = ctx;
  const notifier = createDesktopNotifier({
    needsYou: () => backend.api('/api/needs-you'),
    channels: () => backend.api('/api/channels'),
    prefs: () => settings.get().notifications,
    focus() {
      const win = BrowserWindow.getFocusedWindow();
      if (!win || win.isDestroyed() || !omniWindows().includes(win)) return { viewing: null, visible: false };
      return { viewing: threadInUrl(win.webContents.getURL()), visible: true };
    },
    post(alert) {
      const n = new Notification({ title: alert.title, body: alert.body, ...(ctx.paths.icon && process.platform !== 'darwin' ? { icon: ctx.paths.icon } : {}) });
      n.on('click', () => ctx.showMain(`#/t/${encodeURIComponent(alert.threadId)}`));
      n.show();
      return n;
    },
    now: Date.now,
    later: (fn, ms) => void setTimeout(fn, ms).unref(),
  });

  let following: AbortController | null = null;
  const follow = () => {
    if (following) return;
    const controller = new AbortController();
    following = controller;
    void followFeed(
      {
        url: () => `${backend.origin()}/api/feed`,
        token: () => backend.token(),
        fetch,
        onOpen: () => notifier.connected(),
        onData: (d) => notifier.event(d as Parameters<DesktopNotifier['event']>[0]),
        sleep: (ms) => new Promise((done) => setTimeout(done, ms).unref()),
      },
      controller.signal,
    );
  };
  const stop = () => {
    following?.abort();
    following = null;
  };
  backend.onState((state) => (state.kind === 'ready' ? follow() : stop()));
  if (backend.current.kind === 'ready') follow();
}
