/**
 * Ink pill that springs up 112pt above the bottom: what just happened, in a few words, with an optional status glyph.
 * @startingPoint section="Phone" subtitle="Toast" viewport="860x140"
 */
export interface MoToastProps {
  status?: 'running' | 'needs' | 'done' | 'settled' | 'failed';
  /** Web only: static lays it out in flow (previews). */
  placement?: 'float' | 'static';
  children: React.ReactNode;
}
export function MoToast(props: MoToastProps): JSX.Element;
