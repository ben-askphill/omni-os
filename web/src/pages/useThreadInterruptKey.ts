import { useEffect } from 'react';

/**
 * Esc interrupts a busy thread. Capture phase, so it sees the page before any other Escape
 * handler closes its layer: an open modal, lightbox, drawer, sheet, menu or list keeps Esc for itself.
 */
export function useThreadInterruptKey({
  slotBusy,
  interrupting,
  sheetOpen,
  interrupt,
}: {
  slotBusy: boolean;
  interrupting: boolean;
  sheetOpen: boolean;
  interrupt: () => void;
}) {
  useEffect(() => {
    if (!slotBusy || interrupting || sheetOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.repeat || e.isComposing || e.keyCode === 229 || e.defaultPrevented) return;
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      if (document.querySelector('[aria-modal="true"], [role="dialog"], [role="menu"], [role="listbox"]')) return;
      // Esc in another field (sidebar search, a form) belongs to that field. The reply composer is the exception.
      const el = e.target instanceof HTMLElement ? e.target : null;
      if (el && (el.isContentEditable || el.matches('input, select') || (el.matches('textarea') && !el.hasAttribute('data-reply-composer')))) return;
      void interrupt();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [slotBusy, interrupting, sheetOpen, interrupt]);
}
