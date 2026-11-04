import type { ReactNode } from 'react';

/**
 * Animated to-do row (Bencho "chk", web/src ui.tsx). completed: box fills (spring), tick draws, label strikes through
 * left→right. in_progress: ink edge + a breathing ultramarine bead. Used for plans (TodoWrite) in threads.
 */
export interface CheckItemProps {
  state?: 'pending' | 'in_progress' | 'completed';
  children: ReactNode;
  onClick?: () => void;
}
export function CheckItem(props: CheckItemProps): JSX.Element;

/**
 * Progress/usage as ticks (Bencho "tick"). Off ticks sit at 55% height in a 14% ink tint; on ticks rise to full
 * height in ink (or vermilion via tone="needs" past a threshold).
 */
export interface TicksProps {
  value?: number;
  count?: number;
  height?: number;
  tone?: 'needs' | 'bad' | 'live';
  label?: string;
  className?: string;
  style?: React.CSSProperties;
}
export function Ticks(props: TicksProps): JSX.Element;
