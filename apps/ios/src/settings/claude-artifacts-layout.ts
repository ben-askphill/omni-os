import { DEFAULT_LAYOUT, parseLayout, type ClaudeArtifactsLayout } from '@omni/shared/claude-artifacts.ts';
import * as SecureStore from 'expo-secure-store';
import { useEffect, useSyncExternalStore } from 'react';

import { createStore } from '../live/store';

// The Library's claude.ai list as rows or a grid of cards, kept on this phone like the theme (settings/appearance.ts).

const KEY = 'omni.claudeArtifacts.layout';
const layout = createStore<ClaudeArtifactsLayout>(DEFAULT_LAYOUT);
let restored = false;

/** Applies at once, then saves. A failed save keeps the choice for this launch. */
export function setClaudeArtifactsLayout(next: ClaudeArtifactsLayout) {
  restored = true;
  layout.set(next);
  void SecureStore.setItemAsync(KEY, next).catch(() => {});
}

/** The saved layout, read once the first time the list shows. Rows until it answers. */
export function useClaudeArtifactsLayout(): ClaudeArtifactsLayout {
  useEffect(() => {
    if (restored) return;
    restored = true;
    SecureStore.getItemAsync(KEY)
      .then((saved) => layout.set(parseLayout(saved)))
      .catch(() => {});
  }, []);
  return useSyncExternalStore(layout.subscribe, layout.get);
}
