import { apiPath, type HttpClient } from '../http.ts';
import type { CommandList } from '@omni/shared/slash.ts';

export type { CommandList, SlashCommand } from '@omni/shared/slash.ts';

/** Whose `/` menu: a thread's reply box, or the new-thread composer's for a harness in a channel. */
export type CommandsFor = { thread: string } | { harness: string; channel: string };

/**
 * GET /commands: the commands a composer's `/` menu offers, the templates on offer among them, and `recent`. `wait` waits
 * for a refresh that is running, so a list served from the cache can be swapped for a fresh one.
 */
export function commandsApi(http: HttpClient) {
  return {
    commands: (of: CommandsFor, wait = false) => http.request<CommandList>('GET', apiPath`/commands`, { query: { ...of, wait: wait ? '1' : undefined } }),
  };
}
