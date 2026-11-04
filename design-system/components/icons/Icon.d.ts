/**
 * Omni icon. 24-unit grid, 1.75 stroke, round caps and joins, currentColor — the set from web/src/components/ui.tsx
 * plus a few Omni additions (delegate, switchboard, split, sidebar, browser, gauge, pause, diff, more).
 * v1 names (close, chevron-right, arrow-up, pull-request, attach, loop, settings…) still resolve via aliases.
 */
export type IconName =
  | 'menu' | 'x' | 'search' | 'plus' | 'chevronRight' | 'chevronDown' | 'chevronLeft' | 'stop' | 'send' | 'arrowRight'
  | 'external' | 'download' | 'copy' | 'check' | 'undo' | 'panel' | 'branch' | 'pr' | 'sliders' | 'file' | 'image'
  | 'paperclip' | 'globe' | 'terminal' | 'clock' | 'play' | 'archive' | 'key' | 'zap' | 'layers' | 'hash' | 'target'
  | 'maximize' | 'refresh' | 'trash' | 'alert' | 'tool' | 'inbox' | 'info' | 'lock' | 'home' | 'message' | 'sun'
  | 'moon' | 'monitor' | 'bell' | 'grid' | 'delegate' | 'switchboard' | 'split' | 'sidebar' | 'browser' | 'gauge'
  | 'pause' | 'diff' | 'more' | string;
export interface IconProps {
  name: IconName;
  /** px, default 16. UI uses 12–19. */
  size?: number;
  strokeWidth?: number;
  className?: string;
  title?: string;
  style?: React.CSSProperties;
}
export function Icon(props: IconProps): JSX.Element | null;
export const ICON_PATHS: Record<string, string>;
