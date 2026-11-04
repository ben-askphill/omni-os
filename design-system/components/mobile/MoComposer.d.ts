/**
 * Composer pinned above the keyboard: action chips, then + (attach, model, effort), the field, and mic until there is
 * text, then send. Stop replaces mic while a turn runs and the box is empty. Placeholder names who you talk to.
 * @startingPoint section="Phone" subtitle="Composer: done, running, typing" viewport="860x380"
 */
export interface MoComposerProps {
  placeholder?: string;
  /** Controlled text; omit to let the composer hold it. */
  value?: string;
  onChangeText?: (v: string) => void;
  actions?: import('./MoButtons').MoActionChipProps[];
  onSend?: (text: string) => void;
  onPlus?: () => void;
  /** Set while a turn runs: shows Stop when the box is empty. */
  onStop?: () => void;
  onDictate?: () => void;
  /** Attachment or context chips between the action chips and the box. */
  children?: React.ReactNode;
  /** Expo only: "Steer" or "Queue" when the message will not start a turn. */
  sendLabel?: string;
}
export function MoComposer(props: MoComposerProps): JSX.Element;
