import { describe, expect, it } from 'vitest';
import { linkTarget, nextWindowState, parseWindowState, restoreBounds, staysInWindow, trafficLights } from '../src/window-rules.ts';

const origins = { app: 'http://127.0.0.1:4747', server: 'http://127.0.0.1:4747' };

describe('linkTarget', () => {
  it('opens a Web UI route in an Omni window', () => {
    expect(linkTarget('http://127.0.0.1:4747/#/t/abc', origins)).toEqual({ kind: 'omni', route: '#/t/abc' });
    expect(linkTarget('http://127.0.0.1:4747/', origins)).toEqual({ kind: 'omni', route: '#/' });
  });

  it('opens another server path as a plain window, not the home screen', () => {
    expect(linkTarget('http://127.0.0.1:4747/api/files/a.png', origins)).toEqual({ kind: 'server', url: 'http://127.0.0.1:4747/api/files/a.png' });
  });

  it('treats a UI from Vite and the server as two origins', () => {
    const dev = { app: 'http://localhost:4748', server: 'http://127.0.0.1:4747' };
    expect(linkTarget('http://localhost:4748/#/settings', dev)).toEqual({ kind: 'omni', route: '#/settings' });
    expect(linkTarget('http://127.0.0.1:4747/api/x', dev).kind).toBe('server');
  });

  it('sends the web to the default browser and drops the rest', () => {
    expect(linkTarget('https://github.com/x', origins)).toEqual({ kind: 'external', url: 'https://github.com/x' });
    expect(linkTarget('mailto:a@b.c', origins).kind).toBe('external');
    expect(linkTarget('file:///etc/passwd', origins).kind).toBe('none');
    expect(linkTarget('javascript:alert(1)', origins).kind).toBe('none');
    expect(linkTarget('not a url', origins).kind).toBe('none');
  });

  it('does not take a port that only starts with the server port for the server', () => {
    expect(linkTarget('http://127.0.0.1:47470/#/t/x', origins).kind).toBe('external');
    expect(staysInWindow('http://127.0.0.1:47470/', origins)).toBe(false);
    expect(staysInWindow('http://127.0.0.1:4747/api/auth/desktop-pair', origins)).toBe(true);
  });
});

describe('window state', () => {
  const screen = [{ x: 0, y: 0, width: 1440, height: 875 }];
  const min = { width: 640, height: 420 };

  it('parses a saved state and rejects a broken one', () => {
    expect(parseWindowState({ bounds: { x: 10.4, y: 20, width: 1000, height: 700 }, maximized: true })).toEqual({
      bounds: { x: 10, y: 20, width: 1000, height: 700 },
      maximized: true,
    });
    expect(parseWindowState({ bounds: { x: 0, y: 0, width: 'big', height: 700 } })).toBeNull();
    expect(parseWindowState({ bounds: { x: 0, y: 0, width: 10, height: 10 } })).toBeNull();
    expect(parseWindowState(null)).toBeNull();
    expect(parseWindowState({ maximized: true })).toEqual({ bounds: null, maximized: true });
  });

  it('keeps the bounds from before when it closes maximized', () => {
    const before = { bounds: { x: 100, y: 50, width: 1000, height: 700 }, maximized: false };
    // A tiling window manager reports the minimum size as the maximized window's normal bounds.
    const tiny = { x: 0, y: 0, width: 640, height: 420 };
    expect(nextWindowState(before, { bounds: tiny, maximized: true })).toEqual({ bounds: before.bounds, maximized: true });
    expect(nextWindowState(null, { bounds: tiny, maximized: true })).toEqual({ bounds: null, maximized: true });
    expect(nextWindowState(before, { bounds: tiny, maximized: false })).toEqual({ bounds: tiny, maximized: false });
  });

  it('opens where it was on a screen that is still there', () => {
    expect(restoreBounds({ x: 100, y: 50, width: 1000, height: 700 }, screen, min)).toEqual({ x: 100, y: 50, width: 1000, height: 700 });
  });

  it('fits a window that hangs off the screen', () => {
    expect(restoreBounds({ x: 900, y: 300, width: 1000, height: 900 }, screen, min)).toEqual({ x: 440, y: 0, width: 1000, height: 875 });
  });

  it('forgets a position on a screen that has gone', () => {
    expect(restoreBounds({ x: 2000, y: 50, width: 1000, height: 700 }, screen, min)).toBeNull();
  });
});

describe('trafficLights', () => {
  it('sits in the sidebar row, or above the phone layout', () => {
    expect(trafficLights(1320, 1)).toEqual({ x: 18, y: 29 });
    expect(trafficLights(700, 1)).toEqual({ x: 12, y: 7 });
    // 1000 window pixels at 160% are 625 CSS pixels: the phone layout.
    expect(trafficLights(1000, 1.6)).toEqual({ x: 12, y: 7 });
  });
});
