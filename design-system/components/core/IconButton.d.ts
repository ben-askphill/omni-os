import type { ReactNode, ButtonHTMLAttributes } from 'react';

/** 32px round icon button with the Bencho hover wash and press. `active`/`pressed` keeps the wash on. Always pass `label`. */
export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  icon?: string;
  iconSize?: number;
  size?: 'sm' | 'md';
  pressed?: boolean;
  active?: boolean;
  children?: ReactNode;
}
export function IconButton(props: IconButtonProps): JSX.Element;
