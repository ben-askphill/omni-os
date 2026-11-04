/**
 * Omni wordmark — always just "omni", no "OS". "omni" as one continuous 20u line leaning 10°; the o is the mark's ring.
 * variant: wordmark ("omni") · mark (fluid mark only).
 * `live` puts the fluid OmniMark beside the word (use on splash/about, not in chrome).
 */
export interface OmniLogoProps {
  variant?: 'wordmark' | 'mark';
  /** Rendered height in px (x-height box incl. stroke). */
  height?: number;
  live?: boolean;
  markState?: 'idle' | 'hover' | 'thinking' | 'delegating' | 'report' | 'attention';
  color?: string;
  title?: string;
}
export function OmniLogo(props: OmniLogoProps): JSX.Element;
