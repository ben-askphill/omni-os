import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ANSWER_MS, createLinkRouter } from '../src/link-routing.ts';

// A plain click on a GitHub PR link asks the window's page, which opens the PR in Omni or says no; any other link,
// a page that never said it takes links, or no answer in time, and the link opens in the browser.

const PR = 'https://github.com/ben-askphill/omni-os/pull/745';
const PAGE = 7;

let router: ReturnType<typeof createLinkRouter>;
let send: ReturnType<typeof vi.fn<(id: number, url: string) => void>>;
let external: ReturnType<typeof vi.fn<(url: string) => void>>;
let routed: ReturnType<typeof vi.fn<() => void>>;

beforeEach(() => {
  vi.useFakeTimers();
  router = createLinkRouter();
  send = vi.fn<(id: number, url: string) => void>();
  external = vi.fn<(url: string) => void>();
  routed = vi.fn<() => void>();
});
afterEach(() => vi.useRealTimers());

const lastId = () => send.mock.calls.at(-1)![0];

describe('link router', () => {
  it('asks a page that takes links about a PR link', () => {
    router.setRouting(PAGE, true);
    expect(router.ask(PAGE, PR, send, external, routed)).toBe(true);
    expect(send).toHaveBeenCalledWith(expect.any(Number), PR);
    router.answer(PAGE, lastId(), true);
    expect(routed).toHaveBeenCalledOnce();
    expect(external).not.toHaveBeenCalled();
  });

  it('opens the browser when the page has no page for it', () => {
    router.setRouting(PAGE, true);
    router.ask(PAGE, PR, send, external, routed);
    router.answer(PAGE, lastId(), false);
    expect(external).toHaveBeenCalledWith(PR);
    expect(routed).not.toHaveBeenCalled();
  });

  it('does not ask about other links, or a page that never said it takes them', () => {
    router.setRouting(PAGE, true);
    expect(router.ask(PAGE, 'https://github.com/ben-askphill/omni-os/issues/1', send, external)).toBe(false);
    expect(router.ask(PAGE, 'https://example.com/', send, external)).toBe(false);
    expect(router.ask(8, PR, send, external)).toBe(false);
    router.setRouting(PAGE, false);
    expect(router.ask(PAGE, PR, send, external)).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it('opens the browser when the page does not answer in time, and ignores a late answer', () => {
    router.setRouting(PAGE, true);
    router.ask(PAGE, PR, send, external, routed);
    vi.advanceTimersByTime(ANSWER_MS - 1);
    expect(external).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(external).toHaveBeenCalledOnce();
    router.answer(PAGE, lastId(), true);
    expect(routed).not.toHaveBeenCalled();
  });

  it('takes one answer, from the page asked', () => {
    router.setRouting(PAGE, true);
    router.ask(PAGE, PR, send, external, routed);
    const id = lastId();
    router.answer(99, id, true);
    expect(routed).not.toHaveBeenCalled();
    router.answer(PAGE, id, false);
    router.answer(PAGE, id, true);
    vi.runAllTimers();
    expect(external).toHaveBeenCalledOnce();
    expect(routed).not.toHaveBeenCalled();
  });

  it('opens the browser when the page cannot be reached', () => {
    router.setRouting(PAGE, true);
    expect(router.ask(PAGE, PR, () => { throw new Error('destroyed'); }, external)).toBe(true);
    expect(external).toHaveBeenCalledWith(PR);
  });
});
