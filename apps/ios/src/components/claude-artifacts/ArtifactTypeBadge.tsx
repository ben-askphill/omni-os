import { typeLabel } from '@omni/shared/claude-artifacts.ts';

import { Chip } from '../../ui/Chip';

/** A claude.ai artifact's type (Page, Slides, Doc, Design, Dashboard, Motion, Design system), as a neutral chip. Nothing until the type is known. */
export function ArtifactTypeBadge({ type }: { type: string | null }) {
  if (!type) return null;
  return <Chip label={typeLabel(type)} />;
}
