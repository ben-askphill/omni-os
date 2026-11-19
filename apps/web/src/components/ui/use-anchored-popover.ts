import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { useDismissLayer } from './dismiss-stack.ts';

/** The Popover API, its methods too: some engines reflect the attribute alone. Read as a panel opens, so a test can stub it. */
export function supportsPopover(): boolean {
  return typeof HTMLElement !== 'undefined' && Object.hasOwn(HTMLElement.prototype, 'popover') && typeof HTMLElement.prototype.showPopover === 'function';
}

/** CSS anchor positioning: Chromium, so the desktop app, and Safari 26. */
export function supportsAnchoring(): boolean {
  return typeof CSS !== 'undefined' && typeof CSS.supports === 'function' && CSS.supports('position-area: block-end');
}

/** Between the trigger and the panel. Matches the panel's `margin-block` in index.css. */
const GAP = 8;
/** The least room kept between the panel and the window's edge. */
const EDGE = 8;

type Mode = 'anchored' | 'placed' | 'inline';

/**
 * A dropdown panel tethered to its trigger: the shared Picker's list and ModelPicker's.
 *
 * - With the Popover API the panel is a `popover="auto"` in the top layer, so a modal's scrolling body or a `<dialog>`
 *   never clips it, and a popover opened inside a modal dialog shows above it.
 *   - With CSS anchor positioning (the desktop app, Chromium, Safari 26) CSS places it under the trigger and flips it
 *     above or across at the window's edges (`.pik-card[popover]` in index.css).
 *   - Without it (iOS Safari 18) script places it from the trigger's box and follows the trigger as the page scrolls.
 * - Without popovers it stays where it always was: absolute under the trigger, or above when there is no room below.
 *
 * It is a layer on the dismiss stack (dismiss-stack.ts): Escape and a press outside close it while it is the top layer,
 * and a press that closes it is not also a press on a modal's backdrop. The stack catches a tap too: iOS Safari before
 * 18.3 does not light dismiss a popover on a tap. Escape with the focus in the panel puts it back on the trigger.
 *
 * `onDismiss` runs for Escape, a press outside, or the browser closing the popover (light dismiss, another popover
 * opening). The panel must render only while `open`, or while its exit plays (`useExit`).
 */
export function useAnchoredPopover({
  open,
  onDismiss,
  wrap,
  trigger,
  panel,
  align = 'left',
  initialFocus,
}: {
  open: boolean;
  onDismiss: () => void;
  /** Holds the trigger and the panel: a press inside it is not outside. */
  wrap: RefObject<HTMLElement | null>;
  trigger: RefObject<HTMLElement | null>;
  panel: RefObject<HTMLElement | null>;
  align?: 'left' | 'right';
  /** Where the focus goes once the panel shows: a popover can't take focus before it shows. */
  initialFocus?: () => HTMLElement | null | undefined;
}) {
  const anchor = `--pik-${useId().replace(/[^\w-]/g, '')}`;
  const [mode, setMode] = useState<Mode>('inline');
  const [up, setUp] = useState(false);
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;
  const focus = useRef(initialFocus);
  focus.current = initialFocus;
  /** Whether the panel was open as the pointer went down on the trigger, so its click closes it, not reopens it. */
  const openAtPress = useRef<boolean | null>(null);

  // Before the panel first renders, so it renders as a popover from the start.
  if (open && mode === 'inline' && supportsPopover()) setMode(supportsAnchoring() ? 'anchored' : 'placed');

  useLayoutEffect(() => {
    const el = panel.current;
    const btn = trigger.current;
    if (!open || !el || !btn) return;
    if (mode !== 'inline') {
      try {
        // `source` makes the trigger its invoker, so light dismiss leaves a press on it to the trigger's own click.
        // Browsers without the option ignore it.
        (el.showPopover as (o?: { source?: HTMLElement }) => void).call(el, { source: btn });
      } catch {
        // Already showing: an older engine throws where the spec returns.
      }
    }
    const t = btn.getBoundingClientRect();
    if (mode === 'inline') {
      const below = window.innerHeight - t.bottom;
      setUp(below < el.offsetHeight + GAP && t.top > below);
    } else if (mode === 'anchored') {
      setUp(el.getBoundingClientRect().top < t.top);
    } else {
      // Which side is decided once, as the panel opens, so typing a search doesn't flip it back and forth.
      el.style.minWidth = `${t.width}px`;
      const below = window.innerHeight - t.bottom - GAP;
      const above = t.top - GAP;
      const flip = el.offsetHeight > below && above > below;
      setUp(flip);
      // Runs again as the panel resizes, so a list that shrinks as you search stays against the trigger.
      const place = () => {
        const r = btn.getBoundingClientRect();
        const w = el.offsetWidth;
        const left = align === 'right' ? r.right - w : r.left;
        el.style.left = `${Math.max(EDGE, Math.min(left, window.innerWidth - w - EDGE))}px`;
        el.style.top = `${flip ? Math.max(EDGE, r.top - GAP - el.offsetHeight) : r.bottom + GAP}px`;
      };
      place();
      const onScroll = (e: Event) => {
        if (!el.contains(e.target as Node)) place();
      };
      const resize = new ResizeObserver(place);
      resize.observe(el);
      window.addEventListener('scroll', onScroll, { capture: true, passive: true });
      window.addEventListener('resize', place);
      return () => {
        resize.disconnect();
        window.removeEventListener('scroll', onScroll, { capture: true });
        window.removeEventListener('resize', place);
      };
    }
  }, [open, mode, align, panel, trigger]);

  // Focus after the popover shows; the effect above runs first.
  useLayoutEffect(() => {
    if (open) focus.current?.()?.focus();
  }, [open]);

  useEffect(() => {
    const el = panel.current;
    if (!open || !el || mode === 'inline') return;
    const onToggle = (e: Event) => {
      if ((e as ToggleEvent).newState === 'closed') dismiss.current();
    };
    el.addEventListener('toggle', onToggle);
    return () => el.removeEventListener('toggle', onToggle);
  }, [open, mode, panel]);

  useDismissLayer(open, {
    roots: () => [wrap.current, panel.current],
    escape: () => {
      const refocus = !!panel.current?.contains(document.activeElement);
      dismiss.current();
      if (refocus) trigger.current?.focus();
    },
    outside: () => dismiss.current(),
  });

  const popover = mode !== 'inline';
  return {
    /** Spread on the trigger. */
    triggerProps: {
      style: mode === 'anchored' ? ({ anchorName: anchor } as CSSProperties) : undefined,
      onPointerDown: () => {
        openAtPress.current = open;
      },
    },
    /** Whether a click on the trigger should close the panel: read in its onClick. */
    clickCloses: () => {
      const was = openAtPress.current ?? open;
      openAtPress.current = null;
      return was;
    },
    /** Spread on the panel, with `.pik-card` and its width. */
    panelProps: {
      popover: popover ? ('auto' as const) : undefined,
      'data-up': up || undefined,
      'data-align': align,
      style: mode === 'anchored' ? ({ positionAnchor: anchor } as CSSProperties) : undefined,
    },
    /** The old placement classes, for a browser without popovers. */
    inlineClass: popover ? '' : `${up ? 'bottom-[calc(100%+8px)]' : 'top-[calc(100%+8px)]'} ${align === 'right' ? 'right-0' : 'left-0'}`,
  };
}
