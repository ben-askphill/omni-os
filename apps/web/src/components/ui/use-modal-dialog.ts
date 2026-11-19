import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';

/**
 * Runs a `<dialog>` as a modal: `showModal()` on mount and `close()` on unmount, so the browser keeps the focus inside,
 * makes the page behind inert, stacks it in the top layer and returns the focus to whatever opened it.
 *
 * `onDismiss` hears Escape (and the back gesture where there is one) and a press that starts and ends on the
 * backdrop. Without it the dialog stays open until its owner unmounts it. The browser never closes it on its own:
 * React decides, through `onDismiss`.
 *
 * `ready` turns true right after `showModal()`. Render the dialog's content only then: a field's `autoFocus` runs
 * when it mounts, and a closed dialog cannot take the focus.
 */
/** Dialogs closed by an owner unmounting them, whose close event is not a dismissal. */
const closedByOwner = new WeakSet<HTMLDialogElement>();

/**
 * The open modals, the top one last. A page behind a modal is inert even where it sits higher in the top layer, so
 * whatever must stay usable over a modal (the toasts) renders inside the top one.
 */
const openModals: HTMLDialogElement[] = [];
const modalListeners = new Set<() => void>();
const modalsChanged = () => modalListeners.forEach((fn) => fn());

/** The modal on top, or null when none is open. */
export const topModal = (): HTMLDialogElement | null => openModals.at(-1) ?? null;

export function subscribeModals(fn: () => void) {
  modalListeners.add(fn);
  return () => {
    modalListeners.delete(fn);
  };
}

export function useModalDialog(ref: RefObject<HTMLDialogElement | null>, onDismiss?: () => void) {
  const [ready, setReady] = useState(false);
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;
  const pressedOutside = useRef(false);

  useLayoutEffect(() => {
    const d = ref.current;
    if (!d) return;
    closedByOwner.delete(d);
    if (!d.open) d.showModal();
    if (!openModals.includes(d)) openModals.push(d);
    modalsChanged();
    // Only this dialog's own events: a nested dialog's are not ours, and React would hand them up the tree.
    const onCancel = (e: Event) => {
      if (e.target !== d) return;
      e.preventDefault();
      dismissRef.current?.();
    };
    // A browser may refuse to cancel a second Escape without a click in between, and close the dialog itself. Ask
    // the owner as for a cancel, and stay up until it unmounts the dialog. A close event that finds it open again is
    // a late one from an earlier close() (StrictMode runs this effect twice): not a dismissal.
    const onClose = (e: Event) => {
      if (e.target !== d || closedByOwner.has(d) || d.open) return;
      d.showModal();
      dismissRef.current?.();
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
        const at = openModals.indexOf(shut);
        if (at >= 0) openModals.splice(at, 1);
      }
      modalsChanged();
    };
  }, [ref]);

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
      pressedOutside.current = outside(e);
    },
    onPointerUp: (e: ReactPointerEvent<HTMLDialogElement>) => {
      if (pressedOutside.current && outside(e)) dismissRef.current?.();
      pressedOutside.current = false;
    },
  };
  return { ready, dialogProps };
}
