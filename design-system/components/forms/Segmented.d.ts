import type { ReactNode, RefObject } from 'react';

/**
 * Segmented pill with a sliding thumb (Bencho "pill", web/src ui.tsx). The thumb stretches to cover the old and new
 * item (190ms stretch ease) then settles with a spring (420ms). Used for tabs, filters, theme switch.
 * @startingPoint section="Forms" subtitle="Segmented pill with sliding thumb" viewport="700x160"
 */
export interface SegOption {
  id: string;
  label?: ReactNode;
  icon?: string;
  count?: number;
  title?: string;
}
export interface SegmentedProps {
  options?: SegOption[];
  value: string;
  onChange?: (id: string) => void;
  size?: 'sm' | 'md';
  label?: string;
  radio?: boolean;
  bare?: boolean;
  /** thumb tone: default white thumb · wash · soft */
  tone?: 'wash' | 'soft';
  vertical?: boolean;
  className?: string;
}
export function Segmented(props: SegmentedProps): JSX.Element;

export interface ThumbBox { x: number; y: number; w: number; h: number; phase: 'idle' | 'stretch' | 'settle' }
/** Track the [data-active="true"] child of `track` and return where the thumb should sit. */
export function useSlidingThumb(track: RefObject<HTMLElement | null>, activeKey: unknown, vertical?: boolean, selector?: string): ThumbBox | null;
export interface ThumbProps { box: ThumbBox | null; tone?: 'wash' | 'soft'; className?: string; style?: React.CSSProperties }
export function Thumb(props: ThumbProps): JSX.Element | null;
