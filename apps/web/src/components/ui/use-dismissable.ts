import { useDismissLayer } from './dismiss-stack.ts';

/**
 * While `active`, call `onDismiss` for a press outside `root` and for Escape, when this is the top layer
 * (dismiss-stack.ts): an inline confirm in a modal closes alone, and so does a menu over the annotation view.
 * Either can be left off. The callback is read from a ref, so a new function identity changes nothing.
 */
export function useDismissable(
  active: boolean,
  onDismiss: () => void,
  options?: {
    root?: { readonly current: HTMLElement | null };
    /** Close on a press outside `root`. Default true. */
    outside?: boolean;
    /** Close on Escape. Default true. */
    escape?: boolean;
  },
): void {
  const root = options?.root;
  useDismissLayer(active, {
    roots: () => [root?.current],
    escape: options?.escape === false ? undefined : () => onDismiss(),
    outside: options?.outside === false ? undefined : onDismiss,
  });
}
