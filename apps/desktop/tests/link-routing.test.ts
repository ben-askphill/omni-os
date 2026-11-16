import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ANSWER_MS, ANSWER_TRANSIT_MS, answerLink, createLinkRouter } from '../src/link-routing.ts';

// A plain click on a GitHub PR link asks the window's page, which opens the PR in Omni or says no; any other link,
// a page that never said it takes links, or no answer in time, and the link opens in the browser.

const PR = 'https://github.com/ben-askphill/omni-os/pull/745';
const PAGE = 7;

let router: ReturnType<typeof createLinkRouter>;
let send: ReturnType<typeof vi.fn<(id: number, url: string, deadline: number) => void>>;
let external: ReturnType<typeof vi.fn<(url: string) => void>>;
let routed: ReturnType<typeof vi.fn<() => void>>;

beforeEach(() => {
  vi.useFakeTimers();
  router = createLinkRouter();
  send = vi.fn<(id: number, url: string, deadline: number) => void>();
  external = vi.fn<(url: string) => void>();
  routed = vi.fn<() => void>();
});
afterEach(() => vi.useRealTimers());

const lastId = () => send.mock.calls.at(-1)![0];

describe('link router', () => {
  it('asks a page that takes links about a PR link', () => {
    router.setRouting(PAGE, true);
    expect(router.ask(PAGE, PR, send, external, routed)).toBe(true);
    expect(send).toHaveBeenCalledWith(expect.any(Number), PR, expect.any(Number));
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

// A page too busy to see the link before main gave up must not open the PR page too: main has opened the browser.
describe('the deadline', () => {
  it('leaves the answer room to travel back before main stops waiting', () => {
    vi.setSystemTime(10_000);
    router.setRouting(PAGE, true);
    router.ask(PAGE, PR, send, external, routed);
    expect(send.mock.calls[0][2]).toBe(10_000 + ANSWER_MS - ANSWER_TRANSIT_MS);
    expect(ANSWER_TRANSIT_MS).toBeGreaterThan(0);
    expect(ANSWER_TRANSIT_MS).toBeLessThan(ANSWER_MS);
  });

  it('lets the page decide before it, and refuses without deciding after it', () => {
    const decide = vi.fn((_url: string) => true);
    expect(answerLink(decide, PR, 2000, 1999)).toBe(true);
    expect(answerLink(decide, PR, 2000, 2000)).toBe(true);
    expect(decide).toHaveBeenCalledTimes(2);
    decide.mockClear();
    expect(answerLink(decide, PR, 2000, 2001)).toBe(false);
    expect(answerLink(decide, PR, Number.NaN, 0)).toBe(false);
    expect(answerLink(decide, PR, undefined as unknown as number, 0)).toBe(false);
    expect(decide).not.toHaveBeenCalled();
  });

  it('passes on the page saying no, or failing to decide', () => {
    expect(answerLink(() => false, PR, 2000, 0)).toBe(false);
    expect(answerLink(() => { throw new Error('boom'); }, PR, 2000, 0)).toBe(false);
  });

  it('a page that answers late never moves, and main opens the browser once', () => {
    vi.setSystemTime(0);
    router.setRouting(PAGE, true);
    const decide = vi.fn((_url: string) => true);
    // The page is busy: its handler runs only after main's wait is over.
    router.ask(PAGE, PR, send, external, routed);
    vi.advanceTimersByTime(ANSWER_MS);
    expect(external).toHaveBeenCalledOnce();
    const [id, url, deadline] = send.mock.calls[0];
    router.answer(PAGE, id, answerLink(decide, url, deadline));
    expect(decide).not.toHaveBeenCalled();
    expect(routed).not.toHaveBeenCalled();
    expect(external).toHaveBeenCalledOnce();
  });
});
