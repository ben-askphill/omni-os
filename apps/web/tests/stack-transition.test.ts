// @vitest-environment happy-dom
import { act, createElement, type RefObject } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useHash } from '../src/router.ts';
import { canTransitionStack, stackMove, useStackTransitions } from '../src/mobile/stack-transition.ts';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// M28: the phone stack's push and back play as view transitions with a direction type, where the browser has them.

describe('stackMove', () => {
  it('pushes a screen opened from a tab root, and pops it on back', () => {
    expect(stackMove('#/', '#/t/abc', 0, null)).toBe('push');
    expect(stackMove('#/t/abc', '#/', 1, { omni: 0 })).toBe('pop');
    expect(stackMove('#/channels', '#/c/omni', 3, null)).toBe('push');
    expect(stackMove('#/c/omni', '#/t/abc', 4, { omni: 5 })).toBe('push');
  });

  it('leaves tab switches, replaces and reloads to the page', () => {
    expect(stackMove('#/', '#/channels', 0, null)).toBeNull();
    expect(stackMove('#/channels', '#/', 1, { omni: 0 })).toBeNull();
    expect(stackMove('#/t/abc', '#/t/abc/steps', 2, { omni: 2 })).toBeNull();
    expect(stackMove('', '#/t/abc', null, { omni: 4 })).toBeNull();
  });
});

type Start = (opts: { update: () => void; types: string[] }) => void;
let root: Root;
let shown = '';
let played: RefObject<string | null>;
let placeIndex = 0;
function Probe() {
  shown = useHash();
  played = useStackTransitions(placeIndex);
  return null;
}
const mount = async () => {
  root = createRoot(document.createElement('div'));
  await act(async () => root.render(createElement(Probe)));
};
// happy-dom sends hashchange for a pushState that moves the hash, as a browser does for a link or history.back().
const go = async (hash: string, state: unknown = null) => {
  await act(async () => {
    history.pushState(state, '', hash);
    await new Promise((r) => setTimeout(r, 0));
  });
};

describe('useStackTransitions', () => {
  let start: ReturnType<typeof vi.fn<Start>>;
  beforeEach(() => {
    history.replaceState(null, '', '#/');
    placeIndex = 0;
    start = vi.fn<Start>();
    Object.assign(document, { startViewTransition: start });
    vi.stubGlobal('CSS', { supports: (q: string) => q === 'selector(:active-view-transition-type(push))' });
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    delete (document as { startViewTransition?: unknown }).startViewTransition;
    vi.unstubAllGlobals();
  });

  it('plays a push as a view transition, holding the old screen until it renders the new one', async () => {
    expect(canTransitionStack()).toBe(true);
    await mount();
    await go('#/t/abc');
    expect(start).toHaveBeenCalledTimes(1);
    expect(start.mock.calls[0][0].types).toEqual(['push']);
    // Until the transition has captured the old state, the page still draws it.
    expect(shown).toBe('#/');
    act(() => start.mock.calls[0][0].update());
    expect(shown).toBe('#/t/abc');
    expect(played.current).toBe('#/t/abc');
  });

  it('plays back as a pop', async () => {
    history.replaceState({ omni: 0 }, '', '#/t/abc');
    placeIndex = 1;
    await mount();
    await go('#/', { omni: 0 });
    expect(start.mock.calls[0][0].types).toEqual(['pop']);
    act(() => start.mock.calls[0][0].update());
    expect(shown).toBe('#/');
  });

  it('switches tabs at once, with no transition', async () => {
    await mount();
    await go('#/channels');
    expect(start).not.toHaveBeenCalled();
    expect(shown).toBe('#/channels');
    expect(played.current).toBeNull();
  });

  it('gives a back the browser already animated (an edge swipe) no second slide', async () => {
    history.replaceState({ omni: 0 }, '', '#/t/abc');
    placeIndex = 1;
    await mount();
    await act(async () => {
      window.dispatchEvent(Object.assign(new PopStateEvent('popstate', { state: { omni: 0 } }), { hasUAVisualTransition: true }));
      history.pushState({ omni: 0 }, '', '#/');
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(start).not.toHaveBeenCalled();
    expect(shown).toBe('#/');
  });

  it('keeps today\'s rendering where the browser has no transition types', async () => {
    vi.stubGlobal('CSS', { supports: () => false });
    expect(canTransitionStack()).toBe(false);
    await mount();
    await go('#/t/abc');
    expect(start).not.toHaveBeenCalled();
    expect(shown).toBe('#/t/abc');
    expect(played.current).toBeNull();
  });
});
