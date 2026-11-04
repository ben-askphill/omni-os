import type { ReactNode } from 'react';

/**
 * Inline artifact (HTML report, CSV, file). Hairline frame, 32px mono bar (name · kind · size · split · external),
 * body is an iframe (srcDoc/src) or children, optional mono caption.
 */
export interface ArtifactEmbedProps {
  name: string;
  kind?: string;
  size?: string;
  taskId?: string;
  height?: number;
  srcDoc?: string;
  src?: string;
  caption?: string;
  onOpen?: () => void;
  children?: ReactNode;
}
export function ArtifactEmbed(props: ArtifactEmbedProps): JSX.Element;
