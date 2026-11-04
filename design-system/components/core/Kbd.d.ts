import type { ReactNode } from 'react';

/** Keycap (web/src Kbd): 18px, 6px radius, surface-2, SF Mono 10.5. */
export interface KbdProps {
  children: ReactNode;
  className?: string;
}
export function Kbd(props: KbdProps): JSX.Element;
