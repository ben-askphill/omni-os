import type { SearchHit } from '@omni/client-core';
import { useEffect, useState } from 'react';

import { useLiveHub } from '../live/react';
import { SEARCH_DEBOUNCE_MS } from './search-model';

export type SearchState =
  | { kind: 'idle' }
  | { kind: 'searching' }
  | { kind: 'done'; hits: SearchHit[] }
  | { kind: 'error'; message: string };

/** Searches the active server once typing pauses. An answer to an older query never replaces a newer one. */
export function useThreadSearch(query: string): SearchState {
  const hub = useLiveHub();
  const [state, setState] = useState<SearchState>({ kind: 'idle' });

  useEffect(() => {
    if (!query) {
      setState({ kind: 'idle' });
      return;
    }
    setState({ kind: 'searching' });
    let current = true;
    const timer = setTimeout(() => {
      hub.request((api) => api.search(query)).then(
        (hits) => current && setState({ kind: 'done', hits }),
        (e: unknown) => current && setState({ kind: 'error', message: e instanceof Error ? e.message : 'Search failed. Try again.' }),
      );
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [hub, query]);

  return state;
}
