/**
 * MoDecisionCard: the agent's question with the buttons that answer it, the same card in Activity and in the thread.
 * kind confirm = body text · draft = the draft on a white sheet · choice = radio options, one recommended.
 * The answer is a 48pt vermilion pill, the only filled vermilion on the screen.
 * MoResolvedStrip: what replaces the card once answered, with Undo.
 * @startingPoint section="Phone" subtitle="Needs-you decision cards" viewport="860x900"
 */
export interface MoDecisionOption {
  label: string;
  sub?: string;
  recommended?: boolean;
}
export interface MoDecisionCardProps {
  kind?: 'confirm' | 'draft' | 'choice';
  title: string;
  channel?: string;
  role?: 'conductor' | 'researcher' | 'builder' | 'store-ops' | 'inbox';
  /** Delegated by the Conductor. */
  via?: boolean;
  time?: string;
  body?: string;
  draftTo?: string;
  draft?: string;
  options?: MoDecisionOption[];
  confirmLabel?: string;
  denyLabel?: string;
  /** For choice, the picked option's index. */
  onConfirm?: (pick?: number) => void;
  onDeny?: () => void;
  /** Tapping the head opens the thread (Activity only). */
  onOpen?: () => void;
  /** In the thread: no avatar or meta, title only. */
  inThread?: boolean;
}
export function MoDecisionCard(props: MoDecisionCardProps): JSX.Element;
export function MoResolvedStrip(props: { text: string; onUndo?: () => void }): JSX.Element;
