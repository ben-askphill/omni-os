/**
 * Secret request card: what an agent asked for with Omni's request_secret tool (an API key, a password, a token), in
 * the thread where it asked. Pending: a 22px surface card with a surface-2 header (the "Secret" tag, the label, the env
 * var name in mono with where it goes, and the reason when the agent gave one), a masked field, and Cancel plus an ink
 * Save. A value already saved under that name is said before Save, Save reads Replace, and the first press asks once
 * more (Confirm replace). A vermilion "Needs your input" pill sits under it. The value goes to the secret store and
 * nowhere else: never into the thread, and the agent only learns the name. Once Ben acts it collapses to a read-only
 * summary: "Saved to this channel as STRIPE_TEST_KEY", "Cancelled" or "Not entered".
 * @startingPoint section="Thread" subtitle="Agent asks you for a secret, pending and settled" viewport="760x560"
 */
export interface SecretAsk {
  /** The env var the value goes into, UPPER_SNAKE_CASE. */
  name: string;
  /** What Ben is asked for, like "Stripe test secret key". At most 80 characters. */
  label: string;
  /** "channel" is this thread's channel, "global" every channel. */
  scope: 'channel' | 'global';
  /** Why the agent needs it. At most 300 characters. */
  reason?: string | null;
}
export interface SecretRequestCardProps {
  ask: SecretAsk;
  /** A secret of this name is already saved in the scope. */
  exists?: boolean;
  state?: 'pending' | 'saved' | 'cancelled' | 'dismissed';
  /** Saved over an old value. */
  replaced?: boolean;
  /** Phone layout: 44px field and buttons. */
  touch?: boolean;
  /** Start on the replace confirm step. */
  confirming?: boolean;
  /** What the server said when it refused. The typed value stays. */
  error?: string | null;
  onSave?: (value: string, options: { replace: boolean }) => void;
  onCancel?: () => void;
}
export function SecretRequestCard(props: SecretRequestCardProps): JSX.Element;
