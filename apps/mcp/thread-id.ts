// What a Conductor tool's thread_id names: a full id, or the short form Omni prints everywhere (its first 8 characters,
// as in the omni/<8> branch). The `omni` command resolves the same short ids (apps/cli/src/resolve.ts).
import { call } from './api.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PREFIX = /^[0-9a-f][0-9a-f-]{3,35}$/i;
/** How many of the latest threads a short id is looked for in. */
const SEARCHED = 500;

/** The id a short one names among `threads`, or why it names none. `arg` is not a full id. */
export function pickThread(arg: string, threads: { id: string }[]): string {
  const prefix = arg.toLowerCase();
  const found = threads.filter((t) => t.id.startsWith(prefix));
  if (found.length === 1) return found[0].id;
  if (!found.length) throw new Error(`No thread among the latest ${SEARCHED} starts with ${arg}. Pass its full id from list_threads.`);
  throw new Error(`${arg} matches ${found.length} threads: ${found.map((t) => t.id.slice(0, 8)).join(', ')}. Pass more of the id.`);
}

/** The full thread id for `arg`: a full id as given, a short id or an omni/<id> branch looked up among recent threads. */
export async function threadId(arg: string): Promise<string> {
  const id = arg.trim().replace(/^omni\//, '');
  if (UUID.test(id) || !PREFIX.test(id)) return id;
  return pickThread(id, await call(`/threads?limit=${SEARCHED}`));
}
