// What a thread argument names: a full id, the first characters of one, a link to it, or `parent`.
import type { Client } from './connection.ts';
import { CliError } from './io.ts';
import { shortId } from './format.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PREFIX = /^[0-9a-f][0-9a-f-]{3,35}$/i;
/** How many of the latest threads a short id is looked for in. */
const SEARCHED = 500;

export const isThreadId = (s: string) => UUID.test(s);

/** The id in a Web UI link such as http://127.0.0.1:4747/#/t/<id>, or null. */
export function idFromLink(s: string): string | null {
  const m = s.match(/#\/t\/([^/?#\s]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

export const looksLikeThread = (s: string) => s === 'parent' || UUID.test(s) || PREFIX.test(s) || idFromLink(s) !== null;

export async function resolveThread(c: Client, arg: string): Promise<string> {
  if (arg === 'parent') {
    if (!c.conn.thread) throw new CliError('`parent` only works inside an Omni thread (OMNI_THREAD_ID is not set).');
    const self = await c.api.thread(c.conn.thread);
    if (!self.thread.parent_id) throw new CliError(`Thread ${shortId(c.conn.thread)} has no parent: no other thread started it.`);
    return self.thread.parent_id;
  }
  const linked = idFromLink(arg);
  if (linked) return linked;
  if (UUID.test(arg)) return arg.toLowerCase();
  if (!PREFIX.test(arg)) throw new CliError(`${arg} is not a thread id. Use the id, its first 8 characters, a link to it, or parent.`);
  const prefix = arg.toLowerCase();
  const found = (await c.api.threads({ limit: SEARCHED })).filter((t) => t.id.startsWith(prefix));
  if (found.length === 1) return found[0].id;
  if (!found.length) throw new CliError(`No thread among the latest ${SEARCHED} starts with ${arg}. Use its full id.`);
  throw new CliError(`${arg} matches ${found.length} threads: ${found.map((t) => shortId(t.id)).join(', ')}. Use more of the id.`);
}
