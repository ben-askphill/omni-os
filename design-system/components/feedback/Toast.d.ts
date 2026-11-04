import type { ReactNode } from 'react';

/**
 * Toast (Bencho "bell", web/src Toaster.tsx): 44px+, 22px radius, elev surface + menu shadow, springs in
 * (460ms spring). Used when a running thread finishes while you're elsewhere. Stack bottom-right, max 4.
 */
export interface ToastProps {
  title: ReactNode;
  body?: ReactNode;
  status?: 'running' | 'needs' | 'done' | 'settled' | 'failed';
  icon?: string;
  action?: string;
  onAction?: () => void;
  onDismiss?: () => void;
}
export function Toast(props: ToastProps): JSX.Element;
