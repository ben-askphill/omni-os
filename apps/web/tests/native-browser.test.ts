import { describe, expect, it, vi } from 'vitest';
import { NATIVE_PICK_ANSWER, NATIVE_PICK_ASK, NATIVE_PICK_EVENT } from '@omni/shared/desktop-bridge.ts';
import { GuestLink, captureProblem, inputPoint, inputScale, lookOf, nativeCaptureQuery, pageMatches, resolveAddress, saveAddress, savedAddress } from '../src/components/native-browser.ts';

describe('the Web tab address bar', () => {
  it('loads a web address as it is, adds a scheme to a host, and searches for the rest', () => {
    expect(resolveAddress('https://example.com/a?b=1')).toBe('https://example.com/a?b=1');
    expect(resolveAddress('  example.com ')).toBe('https://example.com/');
    expect(resolveAddress('localhost:3000/x')).toBe('http://localhost:3000/x');
    expect(resolveAddress('app.localhost')).toBe('http://app.localhost/');
    expect(resolveAddress('192.168.1.10:8080')).toBe('http://192.168.1.10:8080/');
    expect(resolveAddress('volero bikes')).toBe('https://www.google.com/search?q=volero%20bikes');
    expect(resolveAddress('amsterdam')).toBe('https://www.google.com/search?q=amsterdam');
    expect(resolveAddress('about:blank')).toBe('about:blank');
    expect(resolveAddress('   ')).toBeNull();
  });

  it('never loads a file, a script or another app', () => {
    for (const text of ['file:///etc/passwd', 'javascript:alert(1)', 'chrome://settings', 'vscode://file/x', 'mailto:a@b.co']) {
      expect(resolveAddress(text)).toMatch(/^https:\/\/www\.google\.com\/search\?q=/);
    }
  });
});

describe('a channel remembers its page', () => {
  it('keeps the last web page and ignores blanks and errors', () => {
    const map = new Map<string, string>();
    const storage = { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v) };
    expect(savedAddress('c1', storage)).toBeNull();
    saveAddress('c1', 'https://example.com/', storage);
    saveAddress('c1', 'about:blank', storage);
    saveAddress('c1', 'chrome-error://chromewebdata/', storage);
    expect(savedAddress('c1', storage)).toBe('https://example.com/');
    expect(savedAddress('c2', storage)).toBeNull();
    map.set('omni.nativeBrowser.c3', 'javascript:alert(1)');
    expect(savedAddress('c3', storage)).toBeNull();
  });
});

const look = { url: 'https://example.com/', title: 'Example', width: 800, height: 600, scrollX: 0, scrollY: 120 };

describe('the page a capture describes', () => {
  it('holds while the address, the window and the scroll stay, within a pixel', () => {
    expect(pageMatches(look, { ...look, scrollY: 121, title: 'Other' })).toBe(true);
    expect(pageMatches(look, { ...look, scrollY: 122 })).toBe(false);
    expect(pageMatches(look, { ...look, width: 801 })).toBe(false);
    expect(pageMatches(look, { ...look, url: 'https://example.com/b' })).toBe(false);
  });

  it('reads what the page said, rounding and refusing other shapes', () => {
    expect(lookOf({ ...look, width: 800.4, scrollY: -3 })).toEqual({ ...look, scrollY: 0 });
    expect(lookOf({ ...look, title: 7 })).toEqual({ ...look, title: '' });
    expect(lookOf({ ...look, width: 'wide' })).toBeNull();
    expect(lookOf(null)).toBeNull();
  });

  it('is captured only as a loaded web page with a size', () => {
    expect(captureProblem(null, false)?.message).toBe('There is no page to annotate.');
    expect(captureProblem({ ...look, url: 'about:blank' }, false)).toMatchObject({ retryable: false, message: 'Only a web page can be annotated. Open one in the browser first.' });
    expect(captureProblem(look, true)).toMatchObject({ retryable: true });
    expect(captureProblem({ ...look, width: 0 }, false)).toMatchObject({ retryable: true });
    expect(captureProblem(look, false)).toBeNull();
  });

  it('goes to the server with the numbers the native capture route reads', () => {
    const q = new URLSearchParams(nativeCaptureQuery('t1', look));
    expect(Object.fromEntries(q)).toEqual({ thread: 't1', url: 'https://example.com/', title: 'Example', vw: '800', vh: '600', sx: '0', sy: '120' });
  });
});

describe('the link to the pick preload', () => {
  it('matches answers to questions by id, and hands back the page events', async () => {
    const sent: unknown[][] = [];
    const link = new GuestLink({ send: (...args) => void sent.push(args) });
    const first = link.ask({ op: 'inspect', x: 4, y: 5 });
    const second = link.ask({ op: 'look' });
    expect(sent).toEqual([
      [NATIVE_PICK_ASK, { op: 'inspect', x: 4, y: 5, id: 1 }],
      [NATIVE_PICK_ASK, { op: 'look', id: 2 }],
    ]);
    expect(link.receive(NATIVE_PICK_ANSWER, [{ id: 2, value: look }])).toBeNull();
    expect(link.receive(NATIVE_PICK_ANSWER, [{ id: 1, value: { ok: true } }])).toBeNull();
    await expect(second).resolves.toEqual(look);
    await expect(first).resolves.toEqual({ ok: true });
    expect(link.receive(NATIVE_PICK_EVENT, [{ type: 'scroll', x: 0, y: 40 }])).toEqual({ type: 'scroll', x: 0, y: 40 });
    expect(link.receive(NATIVE_PICK_EVENT, [{ type: 'key', key: 'Escape', down: true }])).toEqual({ type: 'key', key: 'Escape', down: true });
    expect(link.receive(NATIVE_PICK_EVENT, [{ type: 'key', key: 'q', down: true }])).toBeNull();
    expect(link.receive('something-else', [{ type: 'scroll', x: 0, y: 0 }])).toBeNull();
  });

  it('answers null when the page does not, or the webview is not attached', async () => {
    vi.useFakeTimers();
    const quiet = new GuestLink({ send: () => {} }, 100);
    const asked = quiet.ask({ op: 'look' });
    vi.advanceTimersByTime(150);
    await expect(asked).resolves.toBeNull();
    vi.useRealTimers();
    const detached = new GuestLink({
      send: () => {
        throw new Error('The WebView must be attached to the DOM');
      },
    });
    await expect(detached.look()).resolves.toBeNull();
    const gone = new GuestLink({ send: () => {} });
    const pending = gone.ask({ op: 'pick', x: 1, y: 1 });
    gone.reset();
    await expect(pending).resolves.toBeNull();
  });
});

describe('input sent to the page', () => {
  it('scales a point in page pixels by the zoom the page follows', () => {
    expect(inputPoint({ x: 100, y: 40.4 }, 1)).toEqual({ x: 100, y: 40 });
    expect(inputPoint({ x: 100, y: 40 }, 1.5)).toEqual({ x: 150, y: 60 });
    expect(inputPoint({ x: -120, y: 0 }, 0.8)).toEqual({ x: -96, y: 0 });
    expect(inputPoint({ x: 10, y: 10 }, Number.NaN)).toEqual({ x: 10, y: 10 });
    expect(inputPoint({ x: 10, y: 10 }, 0)).toEqual({ x: 10, y: 10 });
    expect(inputScale(1.25)).toBe(1.25);
    expect(inputScale(Number.POSITIVE_INFINITY)).toBe(1);
  });
});
