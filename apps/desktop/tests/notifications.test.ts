import { describe, expect, it, vi } from 'vitest';
import type { AlertPrefs, AttentionAlert, AttentionItem, FeedAlert } from '@omni/shared/attention.ts';
import { DEFAULT_DESKTOP_SETTINGS, applySettingsPatch, parseDesktopSettings } from '@omni/shared/desktop-bridge.ts';

// The desktop app's native notifications (apps/desktop/src/notifications.ts): the feed and Needs you in, what it
// posts and withdraws out. Electron itself is stubbed; which events are news is packages/shared/tests/attention.test.ts.
vi.mock('electron', () => ({ BrowserWindow: class {}, Notification: class {} }));
vi.mock('../src/windows.ts', () => ({ omniWindows: () => [] }));

const N = await import('../src/notifications.ts');

const NOW = Date.parse('2026-01-05T09:00:01.000Z');
const done = (uid: string): AttentionItem => ({
  thread: { id: 't-audit', channel_id: 'acme', title: 'Audit the checkout', status: 'done', last_text: 'Wrote it up.' },
  result: { uid, status: 'done', at: '2026-01-05T09:00:00.000Z' },
  blockers: [],
});
const crew: FeedAlert = { id: 'crew:1', kind: 'crewReport', thread_id: 'cond-1', channel_id: 'conductor', title: 'Ship it', body: 'PR opened.', at: '2026-01-05T09:00:00.000Z' };

function rig(o: { prefs?: AlertPrefs; viewing?: string | null; visible?: boolean } = {}) {
  let items: AttentionItem[] = [];
  const posted: AttentionAlert[] = [];
  const closed: string[] = [];
  const timers: (() => void)[] = [];
  let loads = 0;
  const notifier = N.createDesktopNotifier({
    needsYou: async () => {
      loads++;
      return { items };
    },
    channels: async () => [{ id: 'acme', name: 'Acme' }],
    prefs: () => o.prefs ?? DEFAULT_DESKTOP_SETTINGS.notifications,
    focus: () => ({ viewing: o.viewing ?? null, visible: o.visible ?? false }),
    post: (a) => {
      posted.push(a);
      return { close: () => closed.push(a.id) };
    },
    now: () => NOW,
    later: (fn) => void timers.push(fn),
  });
  return {
    notifier,
    posted,
    closed,
    set: (next: AttentionItem[]) => (items = next),
    loads: () => loads,
    flush: () => timers.splice(0).forEach((fn) => fn()),
  };
}
const settle = () => new Promise((r) => setTimeout(r, 0));

describe('the desktop notifier', () => {
  it('primes on connect, posts a new result with the channel name, and withdraws it once read', async () => {
    const r = rig();
    r.set([done('old')]);
    r.notifier.connected();
    await settle();
    await r.notifier.refresh();
    expect(r.posted).toEqual([]);

    r.set([done('new'), done('old')]);
    r.notifier.event({ type: 'needs_you' });
    await r.notifier.refresh();
    expect(r.posted.map((a) => [a.id, a.body.split(':')[0]])).toEqual([['new', 'Finished in #Acme']]);

    r.set([]);
    await r.notifier.refresh();
    expect(r.closed).toEqual(['new']);
  });

  it('posts one banner for a thread whose result and question arrive in one load, and closes none', async () => {
    const r = rig();
    r.notifier.connected();
    await settle();
    await r.notifier.refresh();
    const asked = { ...done('res'), blockers: [{ kind: 'question', detail: 'Which store first?', count: 1, at: '2026-01-05T09:00:00.500Z' }] };
    r.set([asked]);
    await r.notifier.refresh();
    expect(r.posted.map((a) => a.kind)).toEqual(['question']);
    expect(r.closed).toEqual([]);
  });

  it('reloads Needs you once for a burst of thread events', async () => {
    const r = rig();
    r.notifier.connected();
    await settle();
    const before = r.loads();
    for (let i = 0; i < 5; i++) r.notifier.event({ type: 'thread' });
    r.flush();
    await r.notifier.refresh();
    expect(r.loads() - before).toBeLessThanOrEqual(2);
  });

  it('posts a feed alert once, and replaces an older notification for the same thread', async () => {
    const r = rig();
    r.notifier.event({ type: 'alert', alert: crew });
    r.notifier.event({ type: 'alert', alert: crew });
    r.notifier.event({ type: 'alert', alert: { ...crew, id: 'crew:2', body: 'Second.' } });
    expect(r.posted.map((a) => a.id)).toEqual(['crew:1', 'crew:2']);
    expect(r.closed).toEqual(['crew:1']);
  });

  it('posts nothing with notifications off, a kind off, or the thread on screen in front', () => {
    const off = rig({ prefs: { ...DEFAULT_DESKTOP_SETTINGS.notifications, enabled: false } });
    off.notifier.event({ type: 'alert', alert: crew });
    const kindOff = rig({ prefs: applySettingsPatch(DEFAULT_DESKTOP_SETTINGS, { notifications: { kinds: { crewReport: false } } }).notifications });
    kindOff.notifier.event({ type: 'alert', alert: crew });
    const watched = rig({ viewing: 'cond-1', visible: true });
    watched.notifier.event({ type: 'alert', alert: crew });
    expect([off, kindOff, watched].flatMap((r) => r.posted)).toEqual([]);
  });

  it('survives a post that throws', () => {
    const notifier = N.createDesktopNotifier({
      needsYou: async () => ({ items: [] }),
      channels: async () => [],
      prefs: () => DEFAULT_DESKTOP_SETTINGS.notifications,
      focus: () => ({ viewing: null, visible: false }),
      post: () => {
        throw new Error('no notification center');
      },
      now: () => NOW,
      later: () => {},
    });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => notifier.event({ type: 'alert', alert: crew })).not.toThrow();
    spy.mockRestore();
  });
});

describe('reading the feed', () => {
  it('splits server-sent events, keeps a partial one for the next chunk, and skips pings', () => {
    const one = N.parseSSE('data: {"type":"needs_you"}\n\nevent: ping\ndata: \n\ndata: {"type":');
    expect(one).toEqual({ data: ['{"type":"needs_you"}'], rest: 'data: {"type":' });
    expect(N.parseSSE(`${one.rest}"thread"}\r\n\r\n`).data).toEqual(['{"type":"thread"}']);
  });

  it('follows the feed with the token, and connects again after a drop', async () => {
    const seen: unknown[] = [];
    const calls: RequestInit[] = [];
    const waits: number[] = [];
    const controller = new AbortController();
    let n = 0;
    const body = (text: string) =>
      (async function* () {
        yield new TextEncoder().encode(text);
      })();
    const fetchFake = (async (_url: string, init: RequestInit) => {
      calls.push(init);
      if (++n === 1) return { ok: false, status: 503, body: null };
      if (n === 3) controller.abort();
      return { ok: true, status: 200, body: body('data: {"type":"needs_you"}\n\n') };
    }) as unknown as typeof fetch;
    let opened = 0;
    await N.followFeed(
      { url: () => 'http://127.0.0.1:1/api/feed', token: async () => 'tok', fetch: fetchFake, onOpen: () => opened++, onData: (d) => seen.push(d), sleep: async (ms) => void waits.push(ms) },
      controller.signal,
    );
    expect((calls[0].headers as Record<string, string>).authorization).toBe('Bearer tok');
    expect(opened).toBe(2);
    expect(seen).toEqual([{ type: 'needs_you' }, { type: 'needs_you' }]);
    expect(waits[0]).toBe(1000);
  });

  it('sends nothing while the server on the port does not prove it is this install, and backs off', async () => {
    const calls: RequestInit[] = [];
    const waits: number[] = [];
    const controller = new AbortController();
    const proven = [null, null, 'tok'];
    const fetchFake = (async (_url: string, init: RequestInit) => {
      calls.push(init);
      controller.abort();
      return { ok: false, status: 503, body: null };
    }) as unknown as typeof fetch;
    await N.followFeed(
      { url: () => 'http://127.0.0.1:1/api/feed', token: async () => proven.shift() ?? null, fetch: fetchFake, onOpen: () => undefined, onData: () => undefined, sleep: async (ms) => void waits.push(ms) },
      controller.signal,
    );
    expect(waits).toEqual([1000, 2000]);
    expect(calls.map((c) => (c.headers as Record<string, string>).authorization)).toEqual(['Bearer tok']);
  });

  it('finds the thread a window shows', () => {
    expect(N.threadInUrl('http://127.0.0.1:4747/#/t/abc%20d?artifact=2')).toBe('abc d');
    expect(N.threadInUrl('http://127.0.0.1:4747/#/settings')).toBeNull();
    expect(N.threadInUrl('http://127.0.0.1:4747/')).toBeNull();
  });
});

describe('notification settings', () => {
  it('are on by default with every kind on, and read a broken file key by key', () => {
    expect(DEFAULT_DESKTOP_SETTINGS.notifications).toEqual({
      enabled: true,
      kinds: { question: true, failed: true, finished: true, crewReport: true, prAttention: true },
      muted: [],
    });
    const parsed = parseDesktopSettings({ notifications: { enabled: 'yes', kinds: { finished: false }, muted: ['acme', 3, 'acme'] } });
    expect(parsed.notifications).toEqual({ ...DEFAULT_DESKTOP_SETTINGS.notifications, kinds: { ...DEFAULT_DESKTOP_SETTINGS.notifications.kinds, finished: false }, muted: ['acme'] });
  });

  it('patches one kind and keeps the rest', () => {
    const once = applySettingsPatch(DEFAULT_DESKTOP_SETTINGS, { notifications: { kinds: { prAttention: false } } });
    const twice = applySettingsPatch(once, { notifications: { muted: ['widgets'] } });
    expect(twice.notifications).toEqual({ enabled: true, kinds: { ...DEFAULT_DESKTOP_SETTINGS.notifications.kinds, prAttention: false }, muted: ['widgets'] });
  });
});

describe('the setup test notification', () => {
  const ctx = (opened: string[]) => ({ paths: { icon: null }, showMain: () => void opened.push('main') }) as unknown as Parameters<typeof N.postTestNotification>[0];

  it('posts the sample, and a click brings the main window forward', () => {
    const shown: { title?: string; body?: string; click: () => void }[] = [];
    const opened: string[] = [];
    const ok = N.postTestNotification(ctx(opened), { isSupported: () => true, show: (o, click) => void shown.push({ title: o.title, body: o.body, click }) });
    expect(ok).toBe(true);
    expect(shown.map(({ title, body }) => ({ title, body }))).toEqual([N.TEST_NOTIFICATION]);
    shown[0].click();
    expect(opened).toEqual(['main']);
  });

  it('says so when the system cannot show notifications', () => {
    const show = vi.fn();
    expect(N.postTestNotification(ctx([]), { isSupported: () => false, show })).toBe(false);
    expect(show).not.toHaveBeenCalled();
  });
});
