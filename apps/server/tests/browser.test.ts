import { describe, it, expect } from 'vitest';
import { clampViewport, defaultFavicon, keyCommands, normalizeUrl, safeIcon } from '../browser.ts';
import { findChrome, type ChromeLookup } from '../browser-page.ts';

describe('normalizeUrl: the address bar', () => {
  it('adds https to a bare host', () => {
    expect(normalizeUrl('example.com')).toBe('https://example.com/');
    expect(normalizeUrl('  shop.example.com/products?a=1 ')).toBe('https://shop.example.com/products?a=1');
    expect(normalizeUrl('shop.example.com:8443/x')).toBe('https://shop.example.com:8443/x');
  });

  it('keeps http for localhost', () => {
    expect(normalizeUrl('localhost:4748/#/')).toBe('http://localhost:4748/#/');
    expect(normalizeUrl('127.0.0.1:3000')).toBe('http://127.0.0.1:3000/');
  });

  it('reads a machine on this network as the desktop Web tab does', () => {
    expect(normalizeUrl('192.168.1.5:3000')).toBe('http://192.168.1.5:3000/');
    expect(normalizeUrl('myhost.local')).toBe('http://myhost.local/');
    expect(normalizeUrl('[::1]:3000')).toBe('http://[::1]:3000/');
  });

  it('searches for words', () => {
    expect(normalizeUrl('volero bikes')).toBe('https://www.google.com/search?q=volero%20bikes');
    expect(normalizeUrl('amsterdam')).toBe('https://www.google.com/search?q=amsterdam');
  });

  it('refuses anything but web pages', () => {
    for (const u of ['file:///etc/passwd', 'chrome://settings', 'javascript:alert(1)', 'data:text/html,hi', '']) expect(normalizeUrl(u)).toBeNull();
    expect(normalizeUrl('about:blank')).toBe('about:blank');
  });
});

describe('clampViewport: the panel size the page lays out at', () => {
  it('keeps a sane size and scale', () => {
    expect(clampViewport(420.6, 700.2, 2)).toEqual({ width: 421, height: 700, scale: 2 });
    expect(clampViewport(100, 50, 3)).toEqual({ width: 320, height: 240, scale: 2 });
    expect(clampViewport(9000, 9000, 0)).toEqual({ width: 2560, height: 1600, scale: 1 });
  });
});

describe('tab icons', () => {
  it('defaults to the origin favicon for web pages only', () => {
    expect(defaultFavicon('https://shop.example.com/a/b?c')).toBe('https://shop.example.com/favicon.ico');
    expect(defaultFavicon('about:blank')).toBeUndefined();
    expect(defaultFavicon('chrome://settings')).toBeUndefined();
  });

  it('never points the UI at this machine or a non-web scheme', () => {
    expect(safeIcon('https://cdn.example.com/i.png')).toBe('https://cdn.example.com/i.png');
    expect(safeIcon('data:image/png;base64,AAAA')).toBe('data:image/png;base64,AAAA');
    for (const u of ['http://localhost:4747/api/status', 'http://127.0.0.1/x.ico', 'http://[::1]/x', 'http://app.localhost/x', 'file:///x.ico', 'javascript:1', 'data:text/html,x', 42])
      expect(safeIcon(u)).toBeUndefined();
    expect(defaultFavicon('http://localhost:4748/')).toBeUndefined();
  });
});

describe('keyCommands: Cmd shortcuts in the page', () => {
  it('maps the editing shortcuts', () => {
    expect(keyCommands('a', 4)).toEqual(['selectAll']);
    expect(keyCommands('z', 4)).toEqual(['undo']);
    expect(keyCommands('Z', 12)).toEqual(['redo']);
    expect(keyCommands('ArrowLeft', 12)).toEqual(['moveToBeginningOfLineAndModifySelection']);
    expect(keyCommands('a', 0)).toBeUndefined();
    expect(keyCommands('q', 4)).toBeUndefined();
  });
});

describe('findChrome: the browser Omni and the browser MCP run', () => {
  const machine = (platform: NodeJS.Platform, files: string[], path = '/usr/local/bin:/usr/bin'): ChromeLookup => {
    const set = new Set(files);
    return {
      platform,
      home: '/home/u',
      path,
      exists: (p) => set.has(p) || files.some((f) => f.startsWith(`${p}/`)),
      list: (dir) => [...new Set(files.filter((f) => f.startsWith(`${dir}/`)).map((f) => f.slice(dir.length + 1).split('/')[0]))],
    };
  };

  it('prefers Google Chrome on a Mac, then the newest Playwright build', () => {
    const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    const pw = (n: number) => `/home/u/Library/Caches/ms-playwright/chromium-${n}/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
    expect(findChrome(machine('darwin', [chrome, pw(1200)]))).toBe(chrome);
    expect(findChrome(machine('darwin', [pw(1100), pw(1200)]))).toBe(pw(1200));
    expect(findChrome(machine('darwin', []))).toBeNull();
  });

  it('finds Chromium on PATH on Linux, where Google Chrome is usually absent', () => {
    expect(findChrome(machine('linux', ['/usr/bin/chromium']))).toBe('/usr/bin/chromium');
    expect(findChrome(machine('linux', ['/usr/bin/chromium', '/usr/bin/brave']))).toBe('/usr/bin/chromium');
    expect(findChrome(machine('linux', ['/usr/bin/chromium', '/opt/google/chrome/chrome']))).toBe('/opt/google/chrome/chrome');
    expect(findChrome(machine('linux', ['/usr/bin/chromium', '/usr/bin/google-chrome-stable']))).toBe('/usr/bin/google-chrome-stable');
    expect(findChrome(machine('linux', ['/usr/bin/chromium'], '/usr/local/bin'))).toBeNull();
  });

  it("falls back to Playwright's Linux Chromium", () => {
    const pw = '/home/u/.cache/ms-playwright/chromium-1200/chrome-linux64/chrome';
    expect(findChrome(machine('linux', [pw]))).toBe(pw);
    expect(findChrome(machine('linux', []))).toBeNull();
  });

  it('finds nothing on other platforms', () => {
    expect(findChrome(machine('win32', ['/usr/bin/chromium']))).toBeNull();
  });
});
