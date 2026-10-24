// Each kind's view in the Web UI: one line per kind in packages/shared/message-context-kinds.ts.
import { diffSelectionView } from './diff-selection.tsx';
import { terminalExcerptView } from './terminal-excerpt.tsx';
import type { WebViews } from './views.ts';

export const CONTEXT_VIEWS: WebViews = {
  diff_selection: diffSelectionView,
  terminal_excerpt: terminalExcerptView,
};
