import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: {}, session: {}, shell: {}, webContents: {}, BrowserWindow: {}, Menu: {}, nativeTheme: {}, screen: {}, ipcMain: { handle: vi.fn(), on: vi.fn() } }));

const {
  INLINE_IMAGE_MAX,
  NATIVE_BROWSER_PARTITION,
  allowedGuestSrc,
  encodeShot,
  guestNavigation,
  guestPreferences,
  guestUserAgent,
  hostsGuest,
  navigationAction,
  permissionAllowed,
  popupAction,
  popupWindowOptions,
} = await import('../src/native-browser.ts');
const { guestKey, pickRequest } = await import('../src/pick-protocol.ts');

describe('the webview guard', () => {
  it('lets a webview start on a web page or a blank one only', () => {
    expect(allowedGuestSrc('https://example.com/a')).toBe(true);
    expect(allowedGuestSrc('http://localhost:4784/')).toBe(true);
    expect(allowedGuestSrc('about:blank')).toBe(true);
    for (const src of [undefined, '', 'file:///etc/passwd', 'javascript:alert(1)', 'data:text/html,hi', 'chrome://gpu', 'about:config', 'devtools://x', 'not a url']) {
      expect(allowedGuestSrc(src)).toBe(false);
    }
  });

  it('forces the pick preload, the partition, no Node and a sandbox, whatever the tag asked for', () => {
    const asked = {
      preload: '/evil.js',
      preloadURL: 'file:///evil.js',
      nodeIntegration: true,
      nodeIntegrationInSubFrames: true,
      contextIsolation: false,
      sandbox: false,
      webSecurity: false,
      allowRunningInsecureContent: true,
      webviewTag: true,
      partition: 'persist:other',
      enableBlinkFeatures: 'Something',
      experimentalFeatures: true,
      disablePopups: true,
    };
    const prefs = guestPreferences(asked, '/app/dist/pick-preload.cjs') as Record<string, unknown>;
    expect(prefs).toMatchObject({
      preload: '/app/dist/pick-preload.cjs',
      nodeIntegration: false,
      nodeIntegrationInSubFrames: false,
      nodeIntegrationInWorker: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      plugins: false,
      partition: NATIVE_BROWSER_PARTITION,
      disablePopups: false,
    });
    expect(prefs.preloadURL).toBeUndefined();
    expect(prefs.enableBlinkFeatures).toBeUndefined();
    expect(prefs.experimentalFeatures).toBeUndefined();
  });

  it('keeps logins in a partition that lasts across launches', () => {
    expect(NATIVE_BROWSER_PARTITION.startsWith('persist:')).toBe(true);
  });
});

describe('permissions', () => {
  it('allows copying and full screen, and refuses the rest', () => {
    expect(permissionAllowed('clipboard-sanitized-write')).toBe(true);
    expect(permissionAllowed('fullscreen')).toBe(true);
    for (const p of ['media', 'geolocation', 'notifications', 'clipboard-read', 'midi', 'midiSysex', 'pointerLock', 'keyboardLock', 'openExternal', 'display-capture', 'idle-detection', 'window-management', 'unknown']) {
      expect(permissionAllowed(p)).toBe(false);
    }
  });
});

describe('navigation in a guest', () => {
  it('loads web pages, hands mail and phone links to their apps, and blocks the rest', () => {
    expect(guestNavigation('https://example.com')).toBe('allow');
    expect(guestNavigation('http://localhost:3000/x')).toBe('allow');
    expect(guestNavigation('about:blank')).toBe('allow');
    expect(guestNavigation('blob:https://example.com/123')).toBe('allow');
    expect(guestNavigation('mailto:ben@example.com')).toBe('external');
    expect(guestNavigation('tel:+3120')).toBe('external');
    for (const url of ['file:///etc/passwd', 'javascript:alert(1)', 'chrome://settings', 'omni://x', 'vscode://file/x', 'about:config', '']) {
      expect(guestNavigation(url)).toBe('block');
    }
  });

  it('hands a mail link to its app only for a click in the top frame', () => {
    expect(navigationAction('mailto:a@b.c', true, true)).toBe('external');
    expect(navigationAction('mailto:a@b.c', true, false)).toBe('block');
    expect(navigationAction('mailto:a@b.c', false, true)).toBe('block');
    expect(navigationAction('https://example.com', false, false)).toBe('allow');
    expect(navigationAction('file:///etc/passwd', true, true)).toBe('block');
  });
});

describe('popups', () => {
  const at = (url: string, disposition = 'foreground-tab') => ({ url, disposition });

  it('opens nothing without a click or key press first', () => {
    for (const d of [at('https://example.com/?n=1'), at('https://accounts.example.com', 'new-window'), at('mailto:a@b.c')]) {
      expect(popupAction(d, false)).toEqual({ kind: 'deny' });
    }
  });

  it('keeps a sign-in popup in a window of the Web tab, and sends a new-tab link to the default browser', () => {
    expect(popupAction(at('https://accounts.example.com/o/oauth', 'new-window'), true)).toEqual({ kind: 'window' });
    expect(popupAction(at('about:blank', 'new-window'), true)).toEqual({ kind: 'window' });
    expect(popupAction(at('https://example.com/a'), true)).toEqual({ kind: 'external', url: 'https://example.com/a' });
    expect(popupAction(at('https://example.com/a', 'background-tab'), true)).toEqual({ kind: 'external', url: 'https://example.com/a' });
    expect(popupAction(at('mailto:a@b.c'), true)).toEqual({ kind: 'external', url: 'mailto:a@b.c' });
  });

  it('opens no other kind of page anywhere', () => {
    for (const url of ['about:blank', 'blob:https://x/1', 'file:///etc/passwd', 'javascript:void(0)', 'chrome://gpu']) {
      expect(popupAction(at(url), true)).toEqual({ kind: 'deny' });
    }
    expect(popupAction(at('file:///etc/passwd', 'new-window'), true)).toEqual({ kind: 'deny' });
  });

  it('gives a popup window no preload, no Node and a sandbox in the Web tab session', () => {
    expect(popupWindowOptions().webPreferences).toMatchObject({
      partition: NATIVE_BROWSER_PARTITION,
      preload: undefined,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webviewTag: false,
    });
  });
});

describe('the guest user agent', () => {
  it('drops the Electron and app tokens and keeps Chrome', () => {
    const ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Omni/0.1.0 Chrome/144.0.7559.60 Electron/44.10.1 Safari/537.36';
    expect(guestUserAgent(ua)).toBe('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.7559.60 Safari/537.36');
  });
});

describe('screenshots', () => {
  it('sends a PNG while it fits the inline limit, else a JPEG', () => {
    const small = new Uint8Array(10);
    const jpeg = vi.fn(() => new Uint8Array(5));
    expect(encodeShot(small, jpeg)).toEqual({ mime: 'image/png', data: small });
    expect(jpeg).not.toHaveBeenCalled();
    const big = new Uint8Array(INLINE_IMAGE_MAX + 1);
    expect(encodeShot(big, jpeg).mime).toBe('image/jpeg');
  });

  it('lets a page screenshot only a webview it hosts', () => {
    const host = { id: 7 };
    const guest = (type: string, hostId: number | null) => ({ getType: () => type, hostWebContents: hostId === null ? null : { id: hostId } }) as never;
    expect(hostsGuest(host, guest('webview', 7))).toBe(true);
    expect(hostsGuest(host, guest('webview', 8))).toBe(false);
    expect(hostsGuest(host, guest('window', 7))).toBe(false);
    expect(hostsGuest(host, guest('webview', null))).toBe(false);
    expect(hostsGuest(host, undefined)).toBe(false);
  });
});

describe('the pick preload', () => {
  const k = (key: string, mods: Partial<Record<'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'isTrusted', boolean>> = {}) => ({ key, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, isTrusted: true, ...mods });
  it('answers well-formed requests only', () => {
    expect(pickRequest({ id: 1, op: 'look' })).toEqual({ id: 1, op: 'look' });
    expect(pickRequest({ id: 2, op: 'pick', x: 10.7, y: 3 })).toEqual({ id: 2, op: 'pick', x: 10, y: 3 });
    expect(pickRequest({ id: 3, op: 'inspect', x: 0, y: 0 })).toEqual({ id: 3, op: 'inspect', x: 0, y: 0 });
    for (const bad of [null, 'look', { op: 'look' }, { id: 'a', op: 'look' }, { id: 1, op: 'eval', code: 'x' }, { id: 1, op: 'pick', x: -1, y: 0 }, { id: 1, op: 'pick', x: 1, y: Number.NaN }, { id: 1, op: 'pick', x: 1e9, y: 0 }]) {
      expect(pickRequest(bad)).toBeNull();
    }
  });

  it('hands the Web tab its shortcuts with Cmd on a Mac and Ctrl elsewhere, plus Escape and Alt', () => {
    expect(guestKey(k('l', { metaKey: true }), true)).toBe('l');
    expect(guestKey(k('L', { metaKey: true }), true)).toBe('l');
    expect(guestKey(k('l', { ctrlKey: true }), true)).toBeNull();
    expect(guestKey(k('l', { ctrlKey: true }), false)).toBe('l');
    expect(guestKey(k('[', { metaKey: true }), true)).toBe('[');
    expect(guestKey(k('r', { ctrlKey: true }), false)).toBe('r');
    expect(guestKey(k('r', { ctrlKey: true, shiftKey: true }), false)).toBeNull();
    expect(guestKey(k('c', { metaKey: true }), true)).toBeNull();
    expect(guestKey(k('l'), true)).toBeNull();
    expect(guestKey(k('Escape'), true)).toBe('Escape');
    expect(guestKey(k('Alt', { altKey: true }), false)).toBe('Alt');
  });

  it("ignores keys a page's script dispatched", () => {
    expect(guestKey(k('l', { metaKey: true, isTrusted: false }), true)).toBeNull();
    expect(guestKey(k('r', { ctrlKey: true, isTrusted: false }), false)).toBeNull();
    expect(guestKey(k('Escape', { isTrusted: false }), true)).toBeNull();
    expect(guestKey(k('Alt', { altKey: true, isTrusted: false }), false)).toBeNull();
  });
});
