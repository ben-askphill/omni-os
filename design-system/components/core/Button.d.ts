import type { ReactNode, ButtonHTMLAttributes } from 'react';

/**
 * Pill button (web/src ui.tsx). primary = ink pill · secondary = surface-2 pill · ghost = Bencho hover wash that
 * springs in from the center · needs = vermilion, reserved for the action that resolves a waiting decision.
 * All variants press to scale(.96) with the settle spring. Heights 28 / 34 / 44.
 * @startingPoint section="Core" subtitle="Pill buttons: primary, secondary, ghost, needs" viewport="700x220"
 */
export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'needs' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  /** Icon name or node */
  icon?: ReactNode | string;
  kbd?: string;
  busy?: boolean;
  children?: ReactNode;
}
export function Button(props: ButtonProps): JSX.Element;
