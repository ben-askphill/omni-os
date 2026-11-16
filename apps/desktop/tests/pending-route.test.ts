import { describe, expect, it } from 'vitest';
import { PendingRoute } from '../src/pending-route.ts';

/** The app as main.ts wires it: ctx.showMain takes the held page unless it was given one, and opens the window there. */
function app() {
  const pending = new PendingRoute();
  let ready = false;
  const shown: (string | undefined)[] = [];
  const host = {
    ready: () => ready,
    showMain: (route?: string) => void shown.push(pending.take(route)),
  };
  return {
    pending,
    shown,
    attach: () => pending.attach(host),
    setReady: (up: boolean) => {
      ready = up;
      if (up) pending.serverReady();
    },
    /** The failure screen's Try Again and the first start both call ctx.showMain() with no page. */
    showMain: () => host.showMain(),
  };
}

describe('a page asked for while the main window cannot show it', () => {
  it('opens at once while the server is up', () => {
    const a = app();
    a.attach();
    a.setReady(true);
    a.pending.ask('#/t/one');
    expect(a.shown).toEqual(['#/t/one']);
  });

  it('waits for the first start when it comes before the app is set up (an omni:// link at launch)', () => {
    const a = app();
    a.pending.ask('#/c/acme');
    a.attach();
    a.setReady(true);
    a.showMain();
    expect(a.shown).toEqual(['#/c/acme', undefined]);
  });

  it('survives a failed start until Try Again opens the main window, on the page asked for last', () => {
    const a = app();
    a.attach();
    a.pending.ask('#/t/one');
    a.pending.ask('#/t/two');
    expect(a.shown).toEqual([]);
    // Try Again: the server comes back, then server-screen.ts calls ctx.showMain() with no page.
    a.setReady(true);
    a.showMain();
    expect(a.shown).toEqual(['#/t/two', undefined]);
  });

  it('survives a restart (exit 75), and opens when the server is ready again', () => {
    const a = app();
    a.attach();
    a.setReady(true);
    a.setReady(false);
    a.pending.ask('#/t/during-restart');
    expect(a.shown).toEqual([]);
    a.setReady(true);
    expect(a.shown).toEqual(['#/t/during-restart']);
  });

  it('gives way to a page the main window is opened on directly, and is not shown later', () => {
    const a = app();
    a.attach();
    a.pending.ask('#/t/old');
    expect(a.pending.take('#/t/notification')).toBe('#/t/notification');
    a.setReady(true);
    a.showMain();
    expect(a.shown).toEqual([undefined]);
  });
});
