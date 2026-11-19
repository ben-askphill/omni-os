import { useLayoutEffect, useRef } from 'react';

/**
 * One stack for every open layer: modals, phone sheets, menus, picker lists, inline confirms, the annotation view.
 * Escape and a press outside go to the top layer only, so one Escape closes one layer and a press on a modal's
 * backdrop with a list open closes the list, not the modal.
 *
 * - Escape: one `keydown` listener on the document, after the focused control's own handlers (a search field that
 *   clears itself, a listbox that closes itself) and before any window listener. A handler that took the key calls
 *   `preventDefault()`, and the stack leaves it alone. Taking it also keeps a `<dialog>` from hearing the close request.
 * - A press outside: on `pointerdown` for a mouse or pen, and on the `mousedown` after a touch for a finger, which iOS
 *   sends for a tap but not for a scroll.
 * - A modal `<dialog>` registers too, so a layer opened inside it sits above it, but leaves Escape to the browser's
 *   close request (`escape: 'native'`) and checks `wasTopAtPress` before a backdrop press closes it.
 *
 * Layers stack in the order they open. One that opens inside another's DOM in the same commit (effects run child
 * first) still goes above it.
 */
export type Layer = {
  /** The elements a press or focus inside of is not "outside": the panel, and the button that toggles it. */
  roots: () => readonly (Node | null | undefined)[];
  /** Escape while on top. Return `false` to leave the key alone. `native`: the browser's close request handles it. */
  escape?: ((e: KeyboardEvent) => boolean | void) | 'native';
  /** A press outside every root while on top. */
  outside?: () => void;
  /** The focus moving outside every root while on top (Tab out of a menu). */
  focusOut?: () => void;
  /** A close request (`closeTopLayer`) for a layer whose Escape is `native`: a modal dialog's own dismissal. */
  request?: () => void;
  /** A modal `<dialog>`'s element. The stack keeps the modals' order too: `topDialog`. */
  dialog?: () => HTMLDialogElement | null;
};

const stack: Layer[] = [];
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((fn) => fn());

/** Hear the stack change: a layer opening or closing. */
export function subscribeLayers(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/**
 * The top open modal dialog, or null when none is open. A page behind a modal is inert even where it sits higher in the
 * top layer, so what must stay usable over a modal (the toasts) renders inside this one. A dialog playing its exit has
 * already left the stack.
 */
export function topDialog(): HTMLDialogElement | null {
  for (let i = stack.length - 1; i >= 0; i--) {
    const d = stack[i]!.dialog?.();
    if (d) return d;
  }
  return null;
}
/**
 * The top layer as the current press began, and whether the press was outside it. `wait`: a finger went down, and its
 * mousedown (a tap) has yet to come; `done`: a mouse or pen press already handled, whose mousedown is the same press.
 */
let press: { top: Layer | undefined; outside: boolean; state: 'idle' | 'wait' | 'done' } = { top: undefined, outside: false, state: 'idle' };

const within = (layer: Layer, target: EventTarget | null) => target instanceof Node && layer.roots().some((r) => !!r && r.contains(target));

function onKey(e: KeyboardEvent) {
  if (e.key !== 'Escape' || e.defaultPrevented || e.isComposing || e.keyCode === 229) return;
  const top = stack.at(-1);
  if (!top?.escape || top.escape === 'native') return;
  if (top.escape(e) === false) return;
  e.preventDefault();
  e.stopPropagation();
}

const begin = (target: EventTarget | null) => {
  const top = stack.at(-1);
  return { top, outside: !!top && !within(top, target) };
};

function pressedOutside() {
  const { top, outside } = press;
  // Only if it is still on top: the press began on it.
  if (outside && top && stack.at(-1) === top) top.outside?.();
}

function onPointerDown(e: PointerEvent) {
  const touch = e.pointerType === 'touch';
  press = { ...begin(e.target), state: touch ? 'wait' : 'done' };
  if (!touch) pressedOutside();
}

function onMouseDown(e: MouseEvent) {
  if (press.state === 'done') {
    press.state = 'idle';
    return;
  }
  // No pointerdown before it (an engine without pointer events, a test): a press of its own.
  if (press.state === 'idle') press = { ...begin(e.target), state: 'idle' };
  press.state = 'idle';
  pressedOutside();
}

function onFocusIn(e: FocusEvent) {
  const top = stack.at(-1);
  if (top?.focusOut && !within(top, e.target)) top.focusOut();
}

function listen(on: boolean) {
  const fn = on ? document.addEventListener.bind(document) : document.removeEventListener.bind(document);
  fn('keydown', onKey as EventListener);
  fn('pointerdown', onPointerDown as EventListener, true);
  fn('mousedown', onMouseDown as EventListener, true);
  fn('focusin', onFocusIn as EventListener, true);
}

/** Add a layer: on top, or under the lowest open layer whose DOM sits inside it. Returns its removal. */
export function pushLayer(layer: Layer): () => void {
  if (!stack.length) listen(true);
  const inside = stack.findIndex((l) => l.roots().some((r) => !!r && layer.roots().some((own) => !!own && own !== r && own.contains(r))));
  if (inside < 0) stack.push(layer);
  else stack.splice(inside, 0, layer);
  changed();
  return () => {
    const i = stack.indexOf(layer);
    if (i >= 0) stack.splice(i, 1);
    if (!stack.length) listen(false);
    changed();
  };
}

export const isTopLayer = (layer: Layer) => stack.at(-1) === layer;

/**
 * A close request that reached a layer not on top (a dialog on its way out still holds the browser's close watcher,
 * and a back gesture skips the keys): close the top layer instead, as Escape would.
 */
export function closeTopLayer() {
  const top = stack.at(-1);
  if (!top) return;
  if (typeof top.escape === 'function') top.escape(new KeyboardEvent('keydown', { key: 'Escape' }));
  else top.request?.();
}

/** Whether `layer` was on top as the current press began: a press that closed a list over a modal is not the modal's. */
export const wasTopAtPress = (layer: Layer) => press.top === layer;

/**
 * Whether a layer is open, for the page's own keys (Esc to interrupt, I for the Inbox): a stacked layer, a modal or
 * popover the browser shows, a phone sheet (`aria-modal`, which keeps a stack of its own), or a composer menu, which
 * keeps its keys in the composer.
 */
export function layerOpen(): boolean {
  if (stack.length) return true;
  try {
    if (document.querySelector(':modal, :popover-open')) return true;
  } catch {
    // An engine without these selectors has no top layer either.
  }
  return !!document.querySelector('[aria-modal="true"], [role="menu"], [role="listbox"]');
}

/** For tests: the number of open layers. */
export const layerCount = () => stack.length;

/**
 * While `active`, hold a layer on the stack. The callbacks are read from a ref, so a new function identity does not
 * move the layer. Returns the layer, for `isTopLayer` and `wasTopAtPress`.
 */
export function useDismissLayer(active: boolean, options: Layer): Layer {
  const opts = useRef(options);
  opts.current = options;
  const layer = useRef<Layer | null>(null);
  layer.current ??= {
    roots: () => opts.current.roots(),
    outside: () => opts.current.outside?.(),
    request: () => opts.current.request?.(),
    dialog: () => opts.current.dialog?.() ?? null,
  };
  const l = layer.current;
  // Read off the layer itself, so they follow the options as they change: which keys it takes, whether it hears the
  // focus leaving.
  const { escape, focusOut } = options;
  l.escape = escape === 'native' || !escape ? escape : (e) => (opts.current.escape as (e: KeyboardEvent) => boolean | void)(e);
  l.focusOut = focusOut && (() => opts.current.focusOut?.());
  useLayoutEffect(() => (active ? pushLayer(l) : undefined), [active, l]);
  return l;
}
