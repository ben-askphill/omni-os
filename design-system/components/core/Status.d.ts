/**
 * StatusDot: the one status mark, one drawing per thread state (PR #755; Mark in packages/shared/status.ts).
 * Shape says who has the ball: circle the agent, square a system outside Omni, diamond Ben, cross or triangle broken.
 * Colour repeats it: live (blue), warn (amber), needs (vermilion), danger-text (red), done (volt), fg-4 (grey).
 * Fill says how far along (hollow, half, filled); a satellite dot says the state is its crew's.
 * Two motions: a halo while the agent's own turn works, a slow breathe while it waits on other work. Nothing spins;
 * reduced motion stops both. Shaped marks never draw below 8px, marks with a satellite never below 9.
 * StatusGlyph is the older name and takes the plain status words. Status is the pill (h24): needs and done fill with
 * their pop and ink text, Ready for review stays a quiet pill, a failed pill is role="alert".
 * @startingPoint section="Core" subtitle="18 status marks, dots and pills" viewport="1120x1700"
 */
export type Mark =
  | 'queued' | 'starting' | 'working' | 'tool' | 'delegating'
  | 'checking' | 'resuming' | 'limited'
  | 'question' | 'crew_question' | 'review' | 'held'
  | 'failed' | 'crew_failed' | 'setup_failed'
  | 'done' | 'stopped' | 'idle';
export type MarkFamily = 'agent' | 'system' | 'you' | 'broken' | 'settled' | 'quiet';
export type MarkMotion = 'ping' | 'breathe' | 'still';
export type StatusState = 'running' | 'needs' | 'limited' | 'failed' | 'done' | 'settled' | 'idle' | 'queued' | 'reconnecting' | 'stopped';
export const MARK: Record<Mark, { label: string; hint: string; family: MarkFamily; glyph: string; motion: MarkMotion; look: string }>;
export const MARK_ORDER: Mark[];
/** States not built yet: each needs data the server does not send (permission wait, finishing, stalled, tool phase in list rows). */
export const MARK_NEEDS_DATA: { label: string; why: string }[];
export const STATUS_LABEL: Record<string, string>;

export interface StatusDotProps {
  /** Names the state outright. */
  mark?: Mark;
  /** A plain status word, when `mark` is not given. */
  state?: StatusState;
  size?: number;
  title?: string;
  className?: string;
}
export function StatusDot(props: StatusDotProps): JSX.Element;

export interface StatusGlyphProps {
  state?: StatusState;
  mark?: Mark;
  size?: number;
  className?: string;
}
export function StatusGlyph(props: StatusGlyphProps): JSX.Element;

export interface StatusProps {
  state?: StatusState;
  mark?: Mark;
  label?: string;
  showLabel?: boolean;
}
export function Status(props: StatusProps): JSX.Element;
