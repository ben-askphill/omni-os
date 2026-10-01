import { useEffect, useRef } from 'react';

/**
 * While `active`, call `onDismiss` for a mousedown outside `root` and for Escape.
 * Either listener can be left off. The callback is read from a ref so a new function
 * identity does not detach and reattach the listeners.
 */
export function useDismissable(
  active: boolean,
  onDismiss: () => void,
  options?: {
    root?: { readonly current: HTMLElement | null };
    /** Listen for mousedown outside `root`. Default true. */
    outside?: boolean;
    /** Listen for Escape. Default true. */
    escape?: boolean;
  },
): void {
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;
  const root = options?.root;
  const outside = options?.outside ?? true;
  const escape = options?.escape ?? true;

  useEffect(() => {
    if (!active) return;
    const onDown = (e: MouseEvent) => {
      if (root?.current?.contains(e.target as Node)) return;
      onDismissRef.current();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onDismissRef.current();
    };
    if (outside) document.addEventListener('mousedown', onDown);
    if (escape) window.addEventListener('keydown', onKey);
    return () => {
      if (outside) document.removeEventListener('mousedown', onDown);
      if (escape) window.removeEventListener('keydown', onKey);
    };
  }, [active, escape, outside, root]);
}
