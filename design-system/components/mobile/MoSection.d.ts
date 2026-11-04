/**
 * List section: 12pt medium caption in fg-3, a quiet count, an optional trailing action. Pads 16pt unless flush.
 * @startingPoint section="Phone" subtitle="List section heading" viewport="860x200"
 */
export interface MoSectionProps {
  title: string;
  count?: number;
  right?: React.ReactNode;
  flush?: boolean;
  children?: React.ReactNode;
}
export function MoSection(props: MoSectionProps): JSX.Element;
