import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type CommandList } from '../../api.ts';

/**
 * The command list for a `/` menu: a thread's (`thread=<id>`), or the one a new thread would get
 * (`harness=<id>&channel=<id>`). `load` sets the cached list at once, then the fresh one when a
 * refresh was running. The server probes at most every 30 seconds, so calling it often is cheap.
 * A new query has no list until it loads, and `load` changes with it.
 */
export function useCommands(query: string) {
  // The list with the query it answers, so another query never shows it.
  const [got, setGot] = useState<{ query: string; list: CommandList } | null>(null);
  const current = useRef(query);

  useEffect(() => {
    current.current = query;
  }, [query]);

  const load = useCallback(async () => {
    const path = `/commands?${query}`;
    const mine = (prev: typeof got) => (prev?.query === query ? prev.list : null);
    // Never swap a list for an older one when two loads overlap.
    const take = (next: CommandList) =>
      current.current === query &&
      setGot((prev) => {
        const had = mine(prev);
        return had?.fetchedAt && (next.fetchedAt ?? 0) < had.fetchedAt ? prev : { query, list: next };
      });
    try {
      take(await api.get<CommandList>(path));
      take(await api.get<CommandList>(`${path}&wait=1`));
    } catch {
      if (current.current === query) setGot((prev) => (mine(prev) ? prev : { query, list: { status: 'unavailable', commands: [], fetchedAt: null } }));
    }
  }, [query]);

  return { list: got?.query === query ? got.list : null, load };
}
