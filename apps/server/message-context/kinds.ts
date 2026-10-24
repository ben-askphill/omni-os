// Every kind's projector to harness text, one line per kind in CONTEXT_KINDS (packages/shared/message-context-kinds.ts).
import type { ServerKinds } from './project.ts';
import { projectBrowserAnnotation } from './browser-annotation.ts';
import { projectDiffSelection } from './diff-selection.ts';
import { projectTerminalExcerpt } from './terminal-excerpt.ts';

export const SERVER_KINDS: ServerKinds = {
  diff_selection: projectDiffSelection,
  terminal_excerpt: projectTerminalExcerpt,
  browser_annotation: projectBrowserAnnotation,
};
