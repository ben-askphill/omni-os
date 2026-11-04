/**
 * Your message: right-aligned surface-2 bubble, 15/1.45, max 86% wide, a caption above (who sent it, or why it failed).
 * @startingPoint section="Phone" subtitle="User bubble: sent, sending, failed" viewport="860x320"
 */
export interface MoBubbleProps {
  caption?: string;
  state?: 'sent' | 'sending' | 'failed';
  children: React.ReactNode;
}
export function MoBubble(props: MoBubbleProps): JSX.Element;
