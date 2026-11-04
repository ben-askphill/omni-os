import type { ReactNode } from 'react';

/**
 * Side panel beside a thread (the Thread page's `.panel-in` column): white, 1px left line, 52px header in the display
 * face, body of PanelSections — each a 20px-radius surface tray with a caption label. Slides in 18px and settles (500ms).
 * Resizable: drag the left edge (a 2px line appears on hover), double-click to reset, ←/→ nudge 16px (⇧ 48px) when focused.
 * Width persists to localStorage under `storageKey`.
 */
export interface PanelProps {
  title: string;
  meta?: string;
  icon?: string;
  onClose?: () => void;
  actions?: ReactNode;
  /** Controlled width in px. Omit to let the user drag (uncontrolled, persisted). */
  width?: number;
  /** Default true. */
  resizable?: boolean;
  /** Default 280. */
  minWidth?: number;
  /** Default 720. Also clamped so the sibling column keeps ≥ 420px; re-clamped on window resize. */
  maxWidth?: number;
  /** Width on first open and on double-click reset. Default 360. */
  defaultWidth?: number;
  /** localStorage key; pass '' to not persist. Default 'omni.panel.width' (shared by all panels). */
  storageKey?: string;
  onResize?: (width: number) => void;
  children?: ReactNode;
}
export function Panel(props: PanelProps): JSX.Element;

export interface PanelSectionProps {
  label?: string;
  meta?: string;
  children?: ReactNode;
}
export function PanelSection(props: PanelSectionProps): JSX.Element;
