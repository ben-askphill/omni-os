import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import { closeTopLayer, isTopLayer, useDismissLayer, wasTopAtPress } from './dismiss-stack.ts';

/**
 * Runs a `<dialog>` as a modal: `showModal()` on mount and `close()` on unmount, so the browser keeps the focus inside,
 * makes the page behind inert, stacks it in the top layer and returns the focus to whatever opened it.
 *
 * `onDismiss` hears Escape (and the back gesture where there is one) and a press that starts and ends on the
 * backdrop, while the dialog is the top layer (dismiss-stack.ts): Escape in a list or an inline confirm inside it, or a
 * press that closes a list over it, closes only that. Without `onDismiss` the dialog stays open until its owner
 * unmounts it. The browser never closes it on its own: React decides, through `onDismiss`.
 *
 * `ready` turns true right after `showModal()`. Render the dialog's content only then: a field's `autoFocus` runs
 * when it mounts, and a closed dialog cannot take the focus.
 */
/** Dialogs closed by an owner unmounting them, whose close event is not a dismissal. */
const closedByOwner = new WeakSet<HTMLDialogElement>();

export function useModalDialog(ref: RefObject<HTMLDialogElement | null>, onDismiss?: () => void, active = true) {
  const [ready, setReady] = useState(false);
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;
  const pressedOutside = useRef(false);
  // On the stack for its order only: Escape reaches it as the browser's close request. The stack is also the modals'
  // order, which the toasts follow into the top one (topDialog).
  // `active` false: on its way out, so off the stack.
  const layer = useDismissLayer(active, { roots: () => [ref.current], dialog: () => ref.current, escape: 'native', request: () => dismissRef.current?.() });

  useLayoutEffect(() => {
    const d = ref.current;
    if (!d) return;
    closedByOwner.delete(d);
    if (!d.open) d.showModal();
    // Only this dialog's own events: a nested dialog's are not ours, and React would hand them up the tree.
    const onCancel = (e: Event) => {
      if (e.target !== d) return;
      e.preventDefault();
      // Not on top (a layer over it let a back gesture through, or this one is on its way out): the request is the top
      // layer's.
      if (isTopLayer(layer)) dismissRef.current?.();
      else closeTopLayer();
    };
    // A browser may refuse to cancel a second Escape without a click in between, and close the dialog itself. Ask
    // the owner as for a cancel, and stay up until it unmounts the dialog. A close event that finds it open again is
    // a late one from an earlier close() (StrictMode runs this effect twice): not a dismissal.
    const onClose = (e: Event) => {
      if (e.target !== d || closedByOwner.has(d) || d.open) return;
      d.showModal();
      if (isTopLayer(layer)) dismissRef.current?.();
      else closeTopLayer();
    };
    d.addEventListener('cancel', onCancel);
    d.addEventListener('close', onClose);
    setReady(true);
    return () => {
      d.removeEventListener('cancel', onCancel);
      d.removeEventListener('close', onClose);
      // React unmounts a parent before its children. A confirm still open over this one would keep the page inert
      // while this one hands the focus back, so close the inner dialogs first, top one first.
      for (const shut of [...d.querySelectorAll<HTMLDialogElement>('dialog[open]')].reverse().concat(d)) {
        closedByOwner.add(shut);
        if (shut.open) shut.close();
      }
    };
  }, [ref, layer]);

  // Once the content is in: a field that took the focus itself (autoFocus) keeps it; otherwise the marked control,
  // then the first one. On open only. The app re-renders whenever a thread moves, and a focus move on each of those
  // took the caret out of the field Ben was typing in.
  useEffect(() => {
    const d = ref.current;
    if (!ready || !d) return;
    if (d.contains(document.activeElement) && document.activeElement !== d) return;
    (d.querySelector<HTMLElement>('[data-autofocus]') ?? d.querySelector<HTMLElement>('button:not([disabled]), input, select, textarea'))?.focus();
  }, [ready, ref]);

  // A press on the backdrop lands on the dialog element itself, outside its box. Both the press and the release
  // must be out there, so a text selection dragged past the edge does not dismiss. (`closedby="any"` does this in
  // Chromium, but Safari has none, and one path keeps the unsaved-changes guard in one place.)
  const outside = (e: ReactPointerEvent<HTMLDialogElement>) => {
    if (e.target !== e.currentTarget) return false;
    const r = e.currentTarget.getBoundingClientRect();
    return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
  };
  const dialogProps = {
    onPointerDown: (e: ReactPointerEvent<HTMLDialogElement>) => {
      pressedOutside.current = outside(e) && wasTopAtPress(layer);
    },
    onPointerUp: (e: ReactPointerEvent<HTMLDialogElement>) => {
      if (pressedOutside.current && outside(e)) dismissRef.current?.();
      pressedOutside.current = false;
    },
  };
  return { ready, dialogProps };
}
