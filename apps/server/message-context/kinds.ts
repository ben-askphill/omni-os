// Every kind's projector to harness text, one line per kind in CONTEXT_KINDS (packages/shared/message-context-kinds.ts).
import type { ServerKinds } from './project.ts';
import { projectDiffSelection } from './diff-selection.ts';

export const SERVER_KINDS: ServerKinds = {
  diff_selection: projectDiffSelection,
};
