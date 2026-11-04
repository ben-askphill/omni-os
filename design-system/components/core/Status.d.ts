/**
 * Status is the only place the three pops appear.
 * StatusGlyph: running = ultramarine dot with Bencho ping · needs = still vermilion diamond · done = volt disc (ink edge on white)
 * · settled = grey dot · idle/queued = hollow ring.
 * Status: the StatusPill from web/src (h24, rounded-full). Needs and done pills are filled with the pop + ink text;
 * others are surface-2 pills. No tinted washes.
 * @startingPoint section="Core" subtitle="Status dots and pills" viewport="700x180"
 */
export type StatusState = 'running' | 'needs' | 'done' | 'settled' | 'idle' | 'queued' | 'failed' | 'stopped';
export interface StatusProps {
  state?: StatusState;
  label?: string;
  showLabel?: boolean;
}
export function Status(props: StatusProps): JSX.Element;

export interface StatusGlyphProps {
  state?: StatusState;
  size?: number;
  className?: string;
}
export function StatusGlyph(props: StatusGlyphProps): JSX.Element;
export const STATUS_LABEL: Record<string, string>;
