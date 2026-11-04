/**
 * Inline confirm (Bencho "say", web/src ui.tsx). A pill that asks in place: label → Cancel | Confirm → Done + Undo
 * with a burning fuse; `onConfirm` runs when the fuse is out. The shell springs between widths (340ms spring).
 * `needs` fills the confirm half in vermilion — use it when the action resolves a waiting decision.
 * @startingPoint section="Forms" subtitle="Ask-in-place confirm with undo fuse" viewport="700x160"
 */
export interface InlineConfirmProps {
  label: React.ReactNode;
  icon?: string;
  confirmLabel: string;
  cancelLabel?: string;
  doneLabel?: string;
  busyLabel?: string;
  /** Undo window in ms. Omit to confirm immediately. */
  undoMs?: number;
  needs?: boolean;
  disabled?: boolean;
  onConfirm: () => void | Promise<void>;
  className?: string;
  height?: number;
}
export function InlineConfirm(props: InlineConfirmProps): JSX.Element;
