/**
 * Phone buttons. Same props on web (MoButtons.jsx) and Expo (native/MoButtons.tsx).
 * MoRoundButton: 40pt round; default surface-2, ink = the one primary action (send, stop), quiet = no fill on a surface.
 * MoActionChip: 36pt pill for this thread's next step; needs = an answer to a question.
 * @startingPoint section="Phone" subtitle="Round buttons and action chips" viewport="860x180"
 */
export interface MoRoundButtonProps {
  icon: string;
  /** Accessible label; also the tooltip on web. */
  label: string;
  onPress?: () => void;
  tone?: 'default' | 'ink' | 'quiet';
  /** 40 by default; 32 inside sheets. Hit area stays 44pt on Expo. */
  size?: number;
  disabled?: boolean;
}
export function MoRoundButton(props: MoRoundButtonProps): JSX.Element;

export interface MoActionChipProps {
  label: string;
  icon?: string;
  tone?: 'default' | 'ink' | 'needs';
  /** Lines added and removed, shown after the label: [214, 38]. */
  diff?: [number, number];
  onPress?: () => void;
}
export function MoActionChip(props: MoActionChipProps): JSX.Element;
