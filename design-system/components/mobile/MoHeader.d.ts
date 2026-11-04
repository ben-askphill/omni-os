/**
 * MoHeader: pushed-screen header, 52pt under the status bar: back, title + subtitle, up to two trailing actions.
 * MoLargeTitle: 30/1.1 title on tab roots only; the subtitle counts running (live text) and needs you (ink, medium).
 * @startingPoint section="Phone" subtitle="Headers and large titles" viewport="860x300"
 */
export interface MoHeaderProps {
  title?: React.ReactNode;
  sub?: React.ReactNode;
  /** Shows the back button. */
  onBack?: () => void;
  /** Leading content when there is no back button (the Conductor mark on Activity). */
  left?: React.ReactNode;
  right?: React.ReactNode;
  /** Skip the status-bar inset (inside a sheet or a preview). */
  flush?: boolean;
}
export function MoHeader(props: MoHeaderProps): JSX.Element;

export interface MoLargeTitleProps {
  title: string;
  /** Leading context: "Friday 23 October". */
  sub?: string;
  needs?: number;
  running?: number;
}
export function MoLargeTitle(props: MoLargeTitleProps): JSX.Element;
