/**
 * The fluid Omni mark. A ring with surface tension; every state means something.
 * idle = barely-breathing, satellite droplet bobs · hover = surface leans toward pointer
 * thinking = surface ripples · delegating = one droplet pinches off per crew thread spawned, then orbits
 * report = a droplet falls back in and merges · attention = held, tense, vermilion, until acknowledged.
 * Honors prefers-reduced-motion (renders StaticMark). Pass `time` to freeze a keyframe.
 * @startingPoint section="Brand" subtitle="Fluid logo mark with six motion states" viewport="700x260"
 */
export type MarkState = 'idle' | 'hover' | 'thinking' | 'delegating' | 'report' | 'attention';
export interface OmniMarkProps {
  state?: MarkState;
  /** Rendered px of the 128-unit box (ring ≈ 78% of it). */
  size?: number;
  /** Delegating: number of droplets (crew threads spawned). Default 3. */
  droplets?: number;
  /** Lean toward the pointer when it comes near. Default true. */
  interactive?: boolean;
  color?: string;
  title?: string;
  /** Freeze at t seconds (for keyframe strips). */
  time?: number;
  /** Frozen hover lean amount 0–1 and angle (rad). */
  lean?: number;
  leanAngle?: number;
  /** Attention state: click handler that acknowledges. */
  onAcknowledge?: () => void;
  className?: string;
  style?: React.CSSProperties;
}
export function OmniMark(props: OmniMarkProps): JSX.Element;

/** Clean static mark (no filter). `ring` drops the satellite droplet — use at ≤16px. */
export interface StaticMarkProps {
  size?: number;
  color?: string;
  title?: string;
  ring?: boolean;
  className?: string;
  style?: React.CSSProperties;
}
export function StaticMark(props: StaticMarkProps): JSX.Element;
