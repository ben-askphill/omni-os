import { useEffect, useRef } from 'react';

/** True when a plain "i" keypress should open the Inbox: no modifiers, no field or terminal focused, no layer open. */
export function isInboxKey(e: KeyboardEvent): boolean {
  if (e.key !== 'i' || e.repeat || e.isComposing || e.defaultPrevented) return false;
  if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return false;
  const el = e.target instanceof HTMLElement ? e.target : null;
  if (el && (el.isContentEditable || el.matches('input, textarea, select') || el.closest('.xterm, [contenteditable]'))) return false;
  if (document.querySelector('[aria-modal="true"], [role="dialog"], [role="menu"], [role="listbox"]')) return false;
  return true;
}

/** Press "i" anywhere outside a text field to open the Inbox. */
export function useInboxKey(open: () => void) {
  const latest = useRef(open);
  latest.current = open;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!isInboxKey(e)) return;
      e.preventDefault();
      latest.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
