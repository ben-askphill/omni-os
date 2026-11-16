/**
 * Loading indicator for a wait that is not a thread at work (a button's request, a list being read): the running
 * status dot at half its box, in the text colour, with the same halo. No spinner (PR #755). Reduced motion keeps the dot.
 */
export interface LoaderProps {
  size?: number;
  label?: string;
  color?: string;
}
export function Loader(props: LoaderProps): JSX.Element;
