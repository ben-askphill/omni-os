/**
 * Bottom sheet: 28pt top corners, 36 × 5 grabber, optional title row with a close button, scrim tap closes.
 * Thread menu, attach + model + effort, search, new delegation. On Expo it renders in a Modal; pass visible.
 * @startingPoint section="Phone" subtitle="Bottom sheet" viewport="860x560"
 */
export interface MoSheetProps {
  /** Expo only. On web, mount it to show it. */
  visible?: boolean;
  title?: string;
  onClose: () => void;
  /** Stops just below the top instead of hugging its content. */
  full?: boolean;
  right?: React.ReactNode;
  children: React.ReactNode;
}
export function MoSheet(props: MoSheetProps): JSX.Element;
