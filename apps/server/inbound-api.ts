// /api/inbound/:name: a message from a bot outside this Mac, such as a Grok Bot crewmate. The only /api route that
// checks a token, because it is the only one meant to be reached from elsewhere: index.ts serves it alone on
// OMNI_INBOUND_PORT, so a tunnel to that port exposes this route and nothing else.
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { createHash, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { channels, threads } from './db.ts';
import { createThread, postMessage } from './runner.ts';
import { globalSecret } from './secrets.ts';

/** An integration's name, as it appears in the URL: `grok` posts to /api/inbound/grok. */
export const INBOUND_NAME_RE = /^[a-z][a-z0-9]{0,31}$/;

/** The global Keychain secret holding an integration's bearer token. Never handed to an agent (secrets.ts). */
export const inboundTokenName = (name: string) => `OMNI_INBOUND_${name.toUpperCase()}_TOKEN`;

const bodySchema = z.object({
  text: z.string().trim().min(1).max(20_000),
  /** Who wrote it on the other side, e.g. the Grok bot's name. Shown to the agent and to Ben. */
  sender: z.string().trim().min(1).max(80).optional(),
  /** Post into this thread. Without it, a new thread starts in `channel`. */
  thread_id: z.string().min(1).max(100).optional(),
  /** A new thread's channel. The Conductor when unset. */
  channel: z.string().min(1).max(100).optional(),
  title: z.string().trim().min(1).max(200).optional(),
  /** The sender's id for this message, kept across retries, so a retry into a thread is not sent twice. */
  request_id: z.string().min(1).max(200).optional(),
});

const digest = (s: string) => createHash('sha256').update(s).digest();

/** Compares the presented token with the stored one in constant time. Hashing first hides the length. */
export function tokenMatches(presented: string | undefined, stored: string | null): boolean {
  if (!presented || !stored) return false;
  return timingSafeEqual(digest(presented), digest(stored));
}

/** What the agent reads: who sent it, so a bot's request is never mistaken for Ben's own words. */
export function inboundPrompt(name: string, text: string, sender?: string): string {
  const who = sender ? `"${sender.replace(/["\n]/g, '')}"` : 'a bot';
  return `Message from ${who} via the ${name} integration, not typed by Ben.\n\n${text}`;
}

export const inboundApi = new Hono();

inboundApi.post('/:name', bodyLimit({ maxSize: 64 * 1024, onError: (c) => c.json({ error: 'body too large' }, 413) }), async (c) => {
  const name = c.req.param('name');
  const auth = c.req.header('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  // An unknown name, a missing token, and a wrong one all look the same from outside.
  const stored = INBOUND_NAME_RE.test(name) ? await globalSecret(inboundTokenName(name)) : null;
  if (!tokenMatches(auth, stored)) {
    console.warn(`[inbound] ${name.slice(0, 32)}: refused (${stored ? 'wrong token' : 'no token set'})`);
    return c.json({ error: 'unauthorized' }, 401);
  }
  const parsed = bodySchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message ?? 'invalid body' }, 400);
  const { text, sender, thread_id, channel, title, request_id } = parsed.data;
  const prompt = inboundPrompt(name, text, sender);

  if (thread_id) {
    if (!threads.get(thread_id)) return c.json({ error: 'thread not found' }, 404);
    // Queued, so it never cuts into a turn Ben or the Conductor is in the middle of.
    const sent = await postMessage(thread_id, prompt, { from: 'inbound', mode: 'queue', requestId: request_id });
    console.log(`[inbound] ${name}: message into ${thread_id}`);
    return c.json({ thread_id, created: false, request_id: sent.request.request_id, state: sent.request.state }, 202);
  }

  const channelId = channel ?? 'conductor';
  if (!channels.get(channelId)) return c.json({ error: 'channel not found' }, 404);
  const thread = await createThread({
    channel: channelId,
    role: channelId === 'conductor' ? 'conductor' : undefined,
    prompt,
    title,
    source: 'inbound',
  });
  console.log(`[inbound] ${name}: new thread ${thread.id} in ${channelId}`);
  return c.json({ thread_id: thread.id, created: true, channel: thread.channel_id, status: thread.status }, 202);
});

/** Everything index.ts serves on OMNI_INBOUND_PORT: this route, and a 404 for every other path. */
export const inboundApp = new Hono();
inboundApp.onError((err, c) => {
  console.error('[inbound]', err);
  return c.json({ error: 'failed' }, ((err as { status?: number }).status ?? 500) as 500);
});
inboundApp.route('/api/inbound', inboundApi);
inboundApp.all('*', (c) => c.json({ error: 'Not found' }, 404));
