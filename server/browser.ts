import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, rmSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { config, paths } from './config.ts';

/**
 * The channel browser: one Chrome per channel, owned by Omni, on the channel's persistent profile.
 * The agent's Playwright MCP attaches to it over CDP, and the thread panel streams it live
 * (a CDP screencast) and sends clicks, keys and navigation back. So Ben and the agent share one
 * browser: he can log in by hand, the agent keeps the session.
 */

export interface BrowserTab {
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
  tabs: BrowserTab[];
  active: string | null;
}

export interface BrowserFrame {
  /** base64 JPEG */
  data: string;
  /** The page viewport in CSS pixels, so clients can map a click on the scaled image back. */
  width: number;
  height: number;
}

export type BrowserEvent = { type: 'state'; state: BrowserState } | ({ type: 'frame' } & BrowserFrame);

type Listener = (e: BrowserEvent) => void;

const VIEWPORT = { width: 1280, height: 800 };
/** With nobody watching and no thread attached, the browser closes after this long. */
const IDLE_MS = 5 * 60_000;

/** Google Chrome if it is installed (the profiles were made with it), else the newest Playwright Chromium. */
export function chromeBinary(): string | null {
  if (process.env.OMNI_CHROME_BIN) return process.env.OMNI_CHROME_BIN;
  const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  if (existsSync(chrome)) return chrome;
  const cache = join(homedir(), 'Library', 'Caches', 'ms-playwright');
  if (!existsSync(cache)) return null;
  const dirs = readdirSync(cache).filter((d) => /^chromium-\d+$/.test(d)).sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]));
  for (const d of dirs) {
    for (const app of ['chrome-mac-arm64/Google Chrome for Testing.app', 'chrome-mac/Google Chrome for Testing.app', 'chrome-mac/Chromium.app']) {
      const name = app.endsWith('Chromium.app') ? 'Chromium' : 'Google Chrome for Testing';
      const bin = join(cache, d, app, 'Contents', 'MacOS', name);
      if (existsSync(bin)) return bin;
    }
  }
  return null;
}

/** Only web pages and blank tabs: nothing internal, no navigating the browser to file:// or chrome://. */
export function normalizeUrl(input: string): string | null {
  const s = input.trim();
  if (!s) return null;
  if (s === 'about:blank') return s;
  const withScheme = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?([/?#]|$)/.test(s)
    ? `http://${s}`
    : /^[a-z][a-z0-9+.-]*:(?!\d)/i.test(s)
      ? s
      : /\s/.test(s) || !/\./.test(s)
        ? `https://www.google.com/search?q=${encodeURIComponent(s)}`
        : `https://${s}`;
  try {
    const u = new URL(withScheme);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null;
  } catch {
    return null;
  }
}

class ChannelBrowser {
  proc: ChildProcess | null = null;
  endpoint: string | null = null;
  private ws: WebSocket | null = null;
  private seq = 0;
  private calls = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  private targets = new Map<string, BrowserTab>();
  private session: string | null = null;
  private active: string | null = null;
  private listeners = new Set<Listener>();
  private lastFrame: BrowserFrame | null = null;
  private casting = false;
  private nav = { loading: false, canBack: false, canForward: false };
  private idle: ReturnType<typeof setTimeout> | undefined;
  private starting: Promise<string> | null = null;
  /** Set while Omni opens a tab itself, so targetCreated does not attach it a second time. */
  private creating = false;
  /** Threads whose MCP is attached. The browser stays up while any is. */
  holders = new Set<string>();

  constructor(
    readonly channelId: string,
    private headless: boolean,
  ) {}

  get running() {
    return !!this.ws && this.ws.readyState === WebSocket.OPEN;
  }

  /** Launches Chrome if it is not up, and resolves to its CDP endpoint. */
  start(): Promise<string> {
    if (this.running && this.endpoint) return Promise.resolve(this.endpoint);
    this.starting ??= this.launch().finally(() => (this.starting = null));
    return this.starting;
  }

  private async launch(): Promise<string> {
    const bin = chromeBinary();
    if (!bin) throw new Error('No Chrome found. Install Google Chrome, or set OMNI_CHROME_BIN.');
    const profile = join(paths.browsers, this.channelId);
    mkdirSync(profile, { recursive: true });
    const portFile = join(profile, 'DevToolsActivePort');
    rmSync(portFile, { force: true });
    const args = [
      '--remote-debugging-port=0',
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-features=Translate,MediaRouter',
      '--password-store=basic',
      '--use-mock-keychain',
      `--window-size=${VIEWPORT.width},${VIEWPORT.height}`,
    ];
    if (this.headless) args.push('--headless=new');
    args.push('about:blank');
    const proc = spawn(bin, args, { stdio: 'ignore' });
    this.proc = proc;
    let exited = false;
    proc.once('exit', () => {
      exited = true;
      if (this.proc === proc) this.stopped();
    });

    // Chrome writes the port it picked, then the browser target's path.
    const deadline = Date.now() + 15_000;
    let port = 0;
    while (Date.now() < deadline && !exited) {
      if (existsSync(portFile)) {
        const [p] = readFileSync(portFile, 'utf8').split('\n');
        port = Number(p);
        if (port) break;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    if (!port) {
      proc.kill();
      throw new Error(exited ? 'Chrome exited on start. Is this channel\'s profile open in another Chrome?' : 'Chrome did not start in time.');
    }
    this.endpoint = `http://127.0.0.1:${port}`;
    const version = (await (await fetch(`${this.endpoint}/json/version`)).json()) as { webSocketDebuggerUrl: string };
    await this.connect(version.webSocketDebuggerUrl);
    this.touch();
    return this.endpoint;
  }

  private connect(url: string) {
    return new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(url);
      this.ws = ws;
      ws.onopen = async () => {
        try {
          await this.send('Target.setDiscoverTargets', { discover: true });
          const { targetInfos } = await this.send('Target.getTargets');
          for (const t of targetInfos) this.onTarget(t);
          const first = [...this.targets.keys()].at(-1);
          if (first) await this.attach(first);
          else await this.newTab();
          resolve();
        } catch (err) {
          reject(err as Error);
        }
      };
      ws.onerror = () => reject(new Error('Could not reach Chrome over CDP'));
      ws.onclose = () => {
        if (this.ws === ws) this.ws = null;
        for (const c of this.calls.values()) c.reject(new Error('Chrome closed'));
        this.calls.clear();
      };
      ws.onmessage = (m) => this.onMessage(JSON.parse(String(m.data)));
    });
  }

  private send(method: string, params: Record<string, unknown> = {}, sessionId?: string | null): Promise<any> {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return Promise.reject(new Error('The browser is not running'));
    const id = ++this.seq;
    ws.send(JSON.stringify({ id, method, params, ...(sessionId && { sessionId }) }));
    return new Promise((resolve, reject) => this.calls.set(id, { resolve, reject }));
  }

  private page(method: string, params: Record<string, unknown> = {}) {
    return this.send(method, params, this.session);
  }

  private onMessage(msg: any) {
    if (msg.id) {
      const call = this.calls.get(msg.id);
      this.calls.delete(msg.id);
      if (msg.error) call?.reject(new Error(msg.error.message));
      else call?.resolve(msg.result);
      return;
    }
    const p = msg.params ?? {};
    switch (msg.method) {
      case 'Target.targetCreated':
        // A tab the agent opens comes to the front, the way it would in a real window.
        if (this.onTarget(p.targetInfo) && !this.creating && this.active) void this.attach(p.targetInfo.targetId).catch(() => {});
        this.emitState();
        break;
      case 'Target.targetInfoChanged':
        this.onTarget(p.targetInfo);
        this.emitState();
        break;
      case 'Target.targetDestroyed':
        this.targets.delete(p.targetId);
        if (p.targetId === this.active) {
          this.active = null;
          this.session = null;
          const next = [...this.targets.keys()].at(-1);
          void (next ? this.attach(next) : this.newTab()).catch(() => {});
        }
        this.emitState();
        break;
      case 'Page.screencastFrame':
        if (msg.sessionId !== this.session) break;
        void this.send('Page.screencastFrameAck', { sessionId: p.sessionId }, msg.sessionId).catch(() => {});
        this.lastFrame = { data: p.data, width: Math.round(p.metadata.deviceWidth), height: Math.round(p.metadata.deviceHeight) };
        this.emit({ type: 'frame', ...this.lastFrame });
        break;
      case 'Page.frameStartedLoading':
      case 'Page.frameStoppedLoading':
        if (msg.sessionId !== this.session) break;
        this.nav.loading = msg.method === 'Page.frameStartedLoading';
        if (!this.nav.loading) void this.refreshHistory();
        this.emitState();
        break;
      case 'Page.frameNavigated':
      case 'Page.navigatedWithinDocument':
        if (msg.sessionId === this.session) void this.refreshHistory();
        break;
    }
  }

  /** Tracks page targets. True for one worth showing. */
  private onTarget(t: { targetId: string; type: string; url: string; title: string }) {
    if (t.type !== 'page' || t.url.startsWith('devtools://') || t.url.startsWith('chrome-extension://')) return false;
    this.targets.set(t.targetId, { id: t.targetId, url: t.url, title: t.title });
    return true;
  }

  async attach(targetId: string) {
    if (!this.targets.has(targetId)) throw new Error('No such tab');
    const old = this.session;
    const { sessionId } = await this.send('Target.attachToTarget', { targetId, flatten: true });
    this.session = sessionId;
    this.active = targetId;
    this.lastFrame = null;
    this.casting = false;
    if (old) void this.send('Target.detachFromTarget', { sessionId: old }).catch(() => {});
    await this.send('Target.activateTarget', { targetId }).catch(() => {});
    await this.page('Page.enable');
    await this.refreshHistory();
    if (this.listeners.size) await this.cast(true);
    this.emitState();
  }

  async newTab(url = 'about:blank') {
    this.creating = true;
    const { targetId } = await this.send('Target.createTarget', { url }).finally(() => (this.creating = false));
    this.onTarget({ targetId, type: 'page', url, title: '' });
    await this.attach(targetId);
  }

  private async refreshHistory() {
    try {
      const { currentIndex, entries } = await this.page('Page.getNavigationHistory');
      this.nav.canBack = currentIndex > 0;
      this.nav.canForward = currentIndex < entries.length - 1;
      const cur = entries[currentIndex];
      const tab = this.active && this.targets.get(this.active);
      if (tab && cur) {
        tab.url = cur.url;
        tab.title = cur.title || tab.title;
      }
      this.emitState();
    } catch {
      // The tab went away mid-call.
    }
  }

  private async cast(on: boolean) {
    if (!this.session || on === this.casting) return;
    this.casting = on;
    if (on) await this.page('Page.startScreencast', { format: 'jpeg', quality: 70, maxWidth: 1600, maxHeight: 1600, everyNthFrame: 1 }).catch(() => (this.casting = false));
    else await this.page('Page.stopScreencast').catch(() => {});
  }

  state(): BrowserState {
    const tab = this.active ? this.targets.get(this.active) : undefined;
    return {
      running: this.running,
      url: tab?.url ?? '',
      title: tab?.title ?? '',
      loading: this.nav.loading,
      canBack: this.nav.canBack,
      canForward: this.nav.canForward,
      tabs: [...this.targets.values()],
      active: this.active,
    };
  }

  private emit(e: BrowserEvent) {
    for (const l of this.listeners) l(e);
  }

  private emitState() {
    this.emit({ type: 'state', state: this.state() });
  }

  /** A client watching. The screencast runs only while someone is. */
  watch(l: Listener) {
    this.listeners.add(l);
    this.touch();
    l({ type: 'state', state: this.state() });
    if (this.lastFrame) l({ type: 'frame', ...this.lastFrame });
    void this.cast(true);
    return () => {
      this.listeners.delete(l);
      if (!this.listeners.size) void this.cast(false);
      this.touch();
    };
  }

  /** Restarts the idle timer. Closes the browser once nobody is watching and no thread holds it. */
  touch() {
    clearTimeout(this.idle);
    this.idle = setTimeout(() => {
      if (!this.listeners.size && !this.holders.size) this.close();
      else this.touch();
    }, IDLE_MS);
    this.idle.unref?.();
  }

  async navigate(url: string) {
    await this.page('Page.navigate', { url });
  }

  async history(delta: -1 | 1) {
    const { currentIndex, entries } = await this.page('Page.getNavigationHistory');
    const entry = entries[currentIndex + delta];
    if (entry) await this.page('Page.navigateToHistoryEntry', { entryId: entry.id });
  }

  reload() {
    return this.page('Page.reload');
  }

  stopLoading() {
    return this.page('Page.stopLoading');
  }

  async closeTab(targetId: string) {
    await this.send('Target.closeTarget', { targetId });
  }

  input(e: BrowserInput) {
    this.touch();
    switch (e.type) {
      case 'mouse':
        return this.page('Input.dispatchMouseEvent', {
          type: e.event, x: e.x, y: e.y, button: e.button ?? 'left', buttons: e.event === 'mouseReleased' ? 0 : e.event === 'mousePressed' ? 1 : (e.buttons ?? 0),
          clickCount: e.clickCount ?? (e.event === 'mouseMoved' ? 0 : 1), modifiers: e.modifiers ?? 0,
        });
      case 'wheel':
        return this.page('Input.dispatchMouseEvent', { type: 'mouseWheel', x: e.x, y: e.y, deltaX: e.deltaX, deltaY: e.deltaY, modifiers: e.modifiers ?? 0 });
      case 'key':
        return this.page('Input.dispatchKeyEvent', {
          type: e.event === 'keyDown' && e.text ? 'keyDown' : e.event === 'keyDown' ? 'rawKeyDown' : 'keyUp',
          key: e.key, code: e.code, text: e.event === 'keyDown' ? e.text : undefined, unmodifiedText: e.event === 'keyDown' ? e.text : undefined,
          windowsVirtualKeyCode: e.keyCode, nativeVirtualKeyCode: e.keyCode, modifiers: e.modifiers ?? 0,
        });
      case 'text':
        return this.page('Input.insertText', { text: e.text });
    }
  }

  close() {
    clearTimeout(this.idle);
    this.proc?.kill();
    this.stopped();
  }

  private stopped() {
    this.ws?.close();
    this.ws = null;
    this.proc = null;
    this.endpoint = null;
    this.session = null;
    this.active = null;
    this.casting = false;
    this.lastFrame = null;
    this.targets.clear();
    this.emitState();
  }

  setHeadless(h: boolean) {
    this.headless = h;
  }
}

export type BrowserInput =
  | { type: 'mouse'; event: 'mousePressed' | 'mouseReleased' | 'mouseMoved'; x: number; y: number; button?: 'left' | 'middle' | 'right' | 'none'; buttons?: number; clickCount?: number; modifiers?: number }
  | { type: 'wheel'; x: number; y: number; deltaX: number; deltaY: number; modifiers?: number }
  | { type: 'key'; event: 'keyDown' | 'keyUp'; key: string; code: string; text?: string; keyCode: number; modifiers?: number }
  | { type: 'text'; text: string };

const browsers = new Map<string, ChannelBrowser>();

export function channelBrowser(channelId: string, headless = true): ChannelBrowser {
  let b = browsers.get(channelId);
  if (!b) {
    b = new ChannelBrowser(channelId, headless);
    browsers.set(channelId, b);
  } else if (!b.running) b.setHeadless(headless);
  return b;
}

export function existingBrowser(channelId: string) {
  return browsers.get(channelId);
}

/** For a thread's MCP: the channel browser's CDP endpoint, launching it if needed. Null when it cannot start. */
export async function attachThread(channelId: string, threadId: string, headless: boolean): Promise<string | null> {
  if (!config.browser || !config.browserLive) return null;
  const b = channelBrowser(channelId, headless);
  try {
    const endpoint = await b.start();
    b.holders.add(threadId);
    return endpoint;
  } catch (err) {
    console.warn(`[browser] ${channelId}: ${(err as Error).message}`);
    return null;
  }
}

export function detachThread(channelId: string, threadId: string) {
  const b = browsers.get(channelId);
  if (!b) return;
  b.holders.delete(threadId);
  b.touch();
}

export function closeAllBrowsers() {
  for (const b of browsers.values()) b.close();
}
