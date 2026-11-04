/**
 * Slide to confirm (Bencho "sld", web/src ui.tsx). 56px pill track, 48px ink grip; drag past 90% to commit, release
 * early to spring back (500ms settle). Keyboard: Enter/Space commits, → steps a quarter, ←/Esc resets.
 * Use for irreversible, deliberate actions (merge to main, send to a client, run on production).
 */
export interface SlideToConfirmProps {
  label: string;
  doneLabel?: string;
  busyLabel?: string;
  disabled?: boolean;
  onConfirm: () => void | Promise<void>;
  className?: string;
}
export function SlideToConfirm(props: SlideToConfirmProps): JSX.Element;
