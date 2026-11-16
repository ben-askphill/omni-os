// GitHub pull request links an Omni window would hand to the browser. The window's page opens the ones it has an Omni
// PR page for (bridge `routeLinks`, apps/web/src/pr-links.ts) and the rest still go to the browser. Main asks the page
// because only the page knows its channels and which of its own links said "Open on GitHub". It is for links in an
// agent's HTML: a sandboxed frame whose clicks the page cannot see. Pages are keyed by their webContents id.
import { parsePullRequestUrl } from '@omni/shared/pr-links.ts';

/** How long the page has to answer before the link opens in the browser anyway. */
export const ANSWER_MS = 1500;

interface Ask {
  page: number;
  url: string;
  external: (url: string) => void;
  routed?: () => void;
  timer: ReturnType<typeof setTimeout>;
}

export function createLinkRouter(timers: { set: typeof setTimeout; clear: typeof clearTimeout } = { set: setTimeout, clear: clearTimeout }) {
  const routing = new Set<number>();
  const pending = new Map<number, Ask>();
  let next = 0;

  const settle = (id: number, routed: boolean) => {
    const ask = pending.get(id);
    if (!ask) return;
    pending.delete(id);
    timers.clear(ask.timer);
    if (routed) ask.routed?.();
    else ask.external(ask.url);
  };

  return {
    /** The page said it takes links, or stopped (its unsubscribe, or it navigated away). */
    setRouting(page: number, on: boolean) {
      if (on) routing.add(page);
      else routing.delete(page);
    },
    /**
     * Asks `page` about a pull request link. True when it asked: the page opens the link, or `external` runs on its
     * answer, or once ANSWER_MS passes with none. False for any other link, or a page that takes none: open it as before.
     */
    ask(page: number, url: string, send: (id: number, url: string) => void, external: (url: string) => void, routed?: () => void): boolean {
      if (!routing.has(page) || !parsePullRequestUrl(url)) return false;
      const id = ++next;
      pending.set(id, { page, url, external, routed, timer: timers.set(() => settle(id, false), ANSWER_MS) });
      try {
        send(id, url);
      } catch {
        settle(id, false);
      }
      return true;
    },
    /** The page's answer. Only the page asked can answer, and only once. */
    answer(page: number, id: number, routed: boolean) {
      if (pending.get(id)?.page === page) settle(id, routed);
    },
  };
}

export type LinkRouter = ReturnType<typeof createLinkRouter>;

export const linkRouter: LinkRouter = createLinkRouter();
