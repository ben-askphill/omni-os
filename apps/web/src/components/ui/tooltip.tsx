import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useDismissLayer } from './dismiss-stack.ts';
import { supportsAnchoring, supportsPopover } from './use-anchored-popover.ts';

/**
 * A short tip on a link or button that shows on hover and on keyboard focus: text the user can do without, such as a
 * link's preview or a key to press. What a user needs goes inline instead, and so does anything for the phone, where
 * nothing hovers. A plain `title` stays fine for a tip that only repeats what the control already says.
 *
 * - Where the browser has interest invokers (`interestfor` with `popover="hint"`: Chromium, so the desktop app) the
 *   browser opens and closes the tip, and CSS anchor positioning places it.
 * - Elsewhere (Safari, Firefox) a small fallback does the same: it opens after a short hover or at once on keyboard
 *   focus, stays open while the pointer is over the tip, and closes on leaving, blur, a press or a scroll. It shows as
 *   a `manual` popover, so it never closes an open menu, placed by CSS anchoring where there is some (Safari 26) and by
 *   script where there is not. Without popovers at all it is a fixed box at the end of its parent.
 *
 * Either way the tip is a layer on the dismiss stack (dismiss-stack.ts) while it shows, as a `hint`: Escape closes the
 * tip alone, not the menu, modal or running turn under it. The trigger names the tip in `aria-describedby` unless the
 * tip only repeats the trigger's own name (`describes: false`), which a screen reader would read twice.
 */
export type TooltipSide = 'top' | 'right' | 'bottom';
/** `tip`: the short dark tip. `card`: a wider card on the raised surface with a few lines of detail (the list panel's rows). */
export type TooltipVariant = 'tip' | 'card';

/** How long a pointer rests on the trigger before the fallback opens: about the browser's own `interest-delay`. */
const OPEN_DELAY = 500;
/** How long the fallback waits after the pointer leaves, so it can cross the gap onto the tip. */
const CLOSE_DELAY = 120;
/** A card that closed this recently hands the pointer's next row its card at once: sweeping down a list swaps cards. */
const WARM_MS = 300;
/** Between the trigger and the tip. Matches `.tip`'s margin in index.css, and `.tip-card`'s. */
const GAPS: Record<TooltipVariant, number> = { tip: 6, card: 8 };
const EDGE = 8;

type Mode = 'interest' | 'anchored' | 'placed' | 'plain';

/** Interest invokers and hint popovers. Read once per tip, so a test can stub it. */
export function supportsInterest(): boolean {
  if (typeof HTMLButtonElement === 'undefined' || !('interestForElement' in HTMLButtonElement.prototype) || !supportsPopover()) return false;
  const probe = document.createElement('div');
  probe.setAttribute('popover', 'hint');
  return probe.popover === 'hint';
}

function pickMode(): Mode {
  if (supportsInterest()) return 'interest';
  if (!supportsPopover()) return 'plain';
  return supportsAnchoring() ? 'anchored' : 'placed';
}

/** The fallback's one open tip: opening another closes it, as the browser's hint popovers do. */
let shown: (() => void) | null = null;
let closedAt = 0;

/** Places the tip beside the trigger by script, flipped to the other side when it would leave the window. */
function place(tip: HTMLElement, trigger: HTMLElement, side: TooltipSide, GAP: number) {
  const r = trigger.getBoundingClientRect();
  const w = tip.offsetWidth;
  const h = tip.offsetHeight;
  const clampX = (x: number) => Math.max(EDGE, Math.min(x, window.innerWidth - w - EDGE));
  const clampY = (y: number) => Math.max(EDGE, Math.min(y, window.innerHeight - h - EDGE));
  let x: number;
  let y: number;
  if (side === 'right') {
    x = r.right + GAP + w > window.innerWidth - EDGE ? r.left - GAP - w : r.right + GAP;
    y = clampY(r.top + r.height / 2 - h / 2);
  } else {
    const above = r.top - GAP - h;
    const below = r.bottom + GAP;
    y = side === 'top' ? (above < EDGE ? below : above) : below + h > window.innerHeight - EDGE ? above : below;
    x = clampX(r.left + r.width / 2 - w / 2);
  }
  tip.style.left = `${Math.max(EDGE, x)}px`;
  tip.style.top = `${y}px`;
}

const keyboardFocus = (el: Element) => {
  try {
    return el.matches(':focus-visible');
  } catch {
    // An engine without :focus-visible: count it as the keyboard, so the tip is never out of reach.
    return true;
  }
};

/**
 * A tooltip for one trigger, an `<a>` or a `<button>`. Spread `triggerProps` on it (its `ref` and focus and pointer
 * handlers, so the trigger has none of those of its own) and render `tip` right after it.
 * `content`: the tip's text; null renders no tip. `side`: where it sits, flipped at the window's edges.
 */
export function useTooltip(content: ReactNode, { side = 'top', describes = true, variant = 'tip' }: { side?: TooltipSide; describes?: boolean; variant?: TooltipVariant } = {}) {
  const id = `tip-${useId().replace(/[^\w-]/g, '')}`;
  const anchor = `--${id}`;
  const [mode] = useState(pickMode);
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLElement | null>(null);
  const tipRef = useRef<HTMLElement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  /** Closed by Escape or a press: stays shut until the pointer or focus leaves and comes back. */
  const muted = useRef(false);
  const on = content != null && content !== '' && content !== false;

  const clear = () => clearTimeout(timer.current);
  const close = useCallback(() => {
    clearTimeout(timer.current);
    if (mode === 'interest') {
      const el = tipRef.current;
      if (el?.matches(':popover-open')) el.hidePopover();
    } else setOpen(false);
  }, [mode]);
  const later = (fn: () => void, ms: number) => {
    clear();
    timer.current = setTimeout(fn, ms);
  };
  const show = () => {
    if (!muted.current) setOpen(true);
  };

  useEffect(() => clear, []);

  // The fallback: show the popover, place it, and close on a scroll or a press anywhere.
  useLayoutEffect(() => {
    const el = tipRef.current;
    const btn = trigger.current;
    if (mode === 'interest' || !open || !el || !btn) return;
    if (shown && shown !== close) shown();
    shown = close;
    if (mode !== 'plain') {
      try {
        el.showPopover();
      } catch {
        // Already showing.
      }
    }
    if (mode !== 'anchored') place(el, btn, side, GAPS[variant]);
    const onScroll = (e: Event) => {
      if (!el.contains(e.target as Node)) close();
    };
    const onPress = () => {
      muted.current = true;
      close();
    };
    window.addEventListener('scroll', onScroll, {
      capture: true,
      passive: true,
    });
    window.addEventListener('resize', close);
    document.addEventListener('pointerdown', onPress, true);
    return () => {
      if (shown === close) {
        shown = null;
        closedAt = Date.now();
      }
      window.removeEventListener('scroll', onScroll, { capture: true });
      window.removeEventListener('resize', close);
      document.removeEventListener('pointerdown', onPress, true);
      if (mode !== 'plain' && el.matches(':popover-open')) el.hidePopover();
    };
  }, [mode, open, side, variant, close]);

  // Interest invokers: the browser opens the tip. Follow it, for the dismiss stack.
  useEffect(() => {
    const el = tipRef.current;
    if (mode !== 'interest' || !el) return;
    const onToggle = (e: Event) => setOpen((e as ToggleEvent).newState === 'open');
    el.addEventListener('toggle', onToggle);
    return () => el.removeEventListener('toggle', onToggle);
  }, [mode, on]);

  useDismissLayer(open, {
    hint: true,
    roots: () => [trigger.current, tipRef.current],
    escape: () => {
      muted.current = true;
      close();
    },
  });

  const fallback = mode !== 'interest';
  const anchored = mode === 'anchored' || mode === 'interest';
  const triggerProps = {
    // The anchor name goes on the element itself, not through `style`, so the trigger keeps a style of its own.
    ref: (el: HTMLElement | null) => {
      trigger.current = el;
      if (el && anchored) el.style.setProperty('anchor-name', anchor);
    },
    'aria-describedby': on && describes ? id : undefined,
    ...(on && mode === 'interest' ? { interestfor: id } : {}),
    ...(on && fallback
      ? {
          onPointerEnter: (e: { pointerType: string }) => {
            if (e.pointerType === 'touch') return;
            muted.current = false;
            later(show, shown || Date.now() - closedAt < WARM_MS ? 0 : OPEN_DELAY);
          },
          onPointerLeave: () => later(close, CLOSE_DELAY),
          onFocus: (e: { currentTarget: Element }) => {
            muted.current = false;
            if (keyboardFocus(e.currentTarget)) (clear(), show());
          },
          onBlur: () => close(),
        }
      : {}),
  };

  const tip = on ? (
    <span
      ref={(el) => {
        tipRef.current = el;
      }}
      id={id}
      role={describes ? 'tooltip' : undefined}
      className={variant === 'card' ? 'tip tip-card' : 'tip'}
      data-side={side}
      data-mode={mode}
      {...(mode === 'plain' ? { hidden: !open } : { popover: mode === 'interest' ? 'hint' : 'manual' })}
      style={anchored ? ({ positionAnchor: anchor } as CSSProperties) : undefined}
      onPointerEnter={fallback ? clear : undefined}
      onPointerLeave={fallback ? () => later(close, CLOSE_DELAY) : undefined}
    >
      {content}
    </span>
  ) : null;

  return { triggerProps, tip };
}
