/**
 * Loading indicator: a droplet circling the ring, merged into it as a travelling bulge.
 * Use instead of skeleton shimmer. Label in mono ("fetching 3 PRs").
 */
export interface LoaderProps {
  size?: number;
  label?: string;
  color?: string;
}
export function Loader(props: LoaderProps): JSX.Element;
