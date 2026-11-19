// The find bar's half in the page (useThreadFind): the text of the elements each event draws, the ranges a query
// matches in it, the CSS Custom Highlights that paint them, and the scroll that brings the current one into view.
// Highlights leave React's DOM alone. Where the API is missing (iOS Safari before 17.2, Firefox before 149) the count,
// the stepping and the scroll still work, and nothing is painted.
import { rangesIn, type FindMatch } from '@omni/shared/thread-find.ts';

/** The attribute on the element that draws an event's text: a message, a reply, a call's input or its output. */
export const FIND_ATTR = 'data-find-event';
/** Text a find skips inside such an element: a control's label (Show all), a note the message did not say. */
export const FIND_SKIP = 'data-find-skip';

const HITS = 'thread-find';
const CURRENT = 'thread-find-current';

export const highlightsSupported = (): boolean => typeof CSS !== 'undefined' && 'highlights' in CSS && typeof Highlight !== 'undefined';

/** An element's text as a find reads it, and where each of its text nodes starts in it. Skips `FIND_SKIP` text. */
export function textOf(el: Element): { text: string; nodes: Text[]; starts: number[] } {
  const nodes: Text[] = [];
  const starts: number[] = [];
  let text = '';
  const walker = el.ownerDocument.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => {
      const parent = n.parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      const skip = parent.closest(`[${FIND_SKIP}]`);
      if (skip && el.contains(skip)) return NodeFilter.FILTER_REJECT;
      // Another event's element inside this one draws its own text.
      if (parent.closest(`[${FIND_ATTR}]`) !== el) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    nodes.push(n as Text);
    starts.push(text.length);
    text += (n as Text).data;
  }
  return { text, nodes, starts };
}

/** The text node and offset at a position in `textOf`'s text. `end`: a range's end, which may sit at a node's end. */
function locate(nodes: Text[], starts: number[], pos: number, end: boolean): [Text, number] {
  let k = 0;
  while (k + 1 < nodes.length && (end ? starts[k + 1] < pos : starts[k + 1] <= pos)) k++;
  return [nodes[k], pos - starts[k]];
}

/** The ranges `re` matches in an element's text, in reading order. A match may run across nodes (bold inside a line). */
export function rangesOf(el: Element, re: RegExp): Range[] {
  const { text, nodes, starts } = textOf(el);
  if (!nodes.length) return [];
  return rangesIn(text, re).map(([s, e]) => {
    const r = el.ownerDocument.createRange();
    r.setStart(...locate(nodes, starts, s, false));
    r.setEnd(...locate(nodes, starts, e, true));
    return r;
  });
}

/** What `paintFind` found of the current match: its range, or the element of its event when the range is not drawn. */
export interface Painted {
  range: Range | null;
  element: Element | null;
  /** Matches drawn on the page. */
  drawn: number;
}

/**
 * Paints every match of `re` in the elements of the events in `events` under `root`, and the current one on top.
 * An event's matches are counted across its elements in page order, as the server counts them in its text. When the
 * page draws fewer of them than the server found (a long output not loaded yet, a link's address), the current match
 * falls back to its event's last drawn one, or its element.
 */
export function paintFind(root: ParentNode, re: RegExp | null, events: ReadonlySet<number>, current: FindMatch | null): Painted {
  const all: Range[] = [];
  let range: Range | null = null;
  let element: Element | null = null;
  if (re) {
    const byEvent = new Map<number, Range[]>();
    for (const el of root.querySelectorAll(`[${FIND_ATTR}]`)) {
      const ev = Number(el.getAttribute(FIND_ATTR));
      if (!events.has(ev)) continue;
      const found = rangesOf(el, re);
      all.push(...found);
      byEvent.set(ev, [...(byEvent.get(ev) ?? []), ...found]);
      if (current && ev === current.event) element ??= el;
    }
    if (current) {
      const mine = byEvent.get(current.event) ?? [];
      range = mine[Math.min(current.n, mine.length - 1)] ?? null;
    }
  }
  if (highlightsSupported()) {
    const hits = new Highlight(...all.filter((r) => r !== range));
    const now = new Highlight(...(range ? [range] : []));
    now.priority = 1;
    CSS.highlights.set(HITS, hits);
    CSS.highlights.set(CURRENT, now);
  }
  return { range, element, drawn: all.length };
}

/** Takes the find's highlights off the page. */
export function clearFind() {
  if (!highlightsSupported()) return;
  CSS.highlights.delete(HITS);
  CSS.highlights.delete(CURRENT);
}

const scrolls = (el: Element) => el.scrollHeight > el.clientHeight + 1 && /(auto|scroll)/.test(getComputedStyle(el).overflowY);

/**
 * Scrolls `scroller` so a match sits in its middle: first any box inside the row that scrolls on its own (a tool's
 * output), then the transcript. An older row out of view is only a placeholder (`.tx-row`), so the row and the ones
 * that will show above it render first, as useReveal does, and the scroll lands on their real heights. Returns what
 * puts them back.
 */
export function scrollToMatch(scroller: HTMLElement, target: Range | Element): () => void {
  const start = target instanceof Range ? target.startContainer.parentElement : target;
  const row = start?.closest<HTMLElement>('[data-key]') ?? null;
  const shown: HTMLElement[] = [];
  const rows = [...scroller.querySelectorAll<HTMLElement>('[data-key]')];
  const at = row ? rows.indexOf(row) : -1;
  if (row) {
    row.style.contentVisibility = 'visible';
    shown.push(row);
  }
  const rect = () => target.getBoundingClientRect();
  for (let a = start; a && a !== scroller && a !== row; a = a.parentElement) {
    if (!scrolls(a)) continue;
    a.scrollTop += rect().top - a.getBoundingClientRect().top - (a.clientHeight - rect().height) / 2;
  }
  const offset = Math.max(8, (scroller.clientHeight - rect().height) / 2);
  for (let i = at - 1, room = offset; i >= 0 && room > 0; i--) {
    rows[i].style.contentVisibility = 'visible';
    shown.push(rows[i]);
    room -= rows[i].getBoundingClientRect().height;
  }
  scroller.scrollTop += rect().top - scroller.getBoundingClientRect().top - offset;
  return () => {
    for (const x of shown) x.style.contentVisibility = '';
  };
}

/** The event of the first row on screen in `scroller`, the one Ben is reading. Null with no rows. */
export function readingEvent(scroller: HTMLElement): number | null {
  const top = scroller.getBoundingClientRect().top;
  for (const r of scroller.querySelectorAll<HTMLElement>('[data-key]')) {
    if (r.getBoundingClientRect().bottom > top + 1) return Number(r.dataset.key);
  }
  return null;
}
