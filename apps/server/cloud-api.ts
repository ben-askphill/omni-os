// /api/cloud/reply/:sessionId: a Claude Code cloud session's Stop hook (scripts/cloud-reply-hook.sh) posts each turn's
// final message here, and the thread waiting on that session takes it as its reply (harness/claude-cloud/replies.ts).
// The session reaches this Mac through a tunnel, so the bearer token, the Keychain secret OMNI_CLOUD_REPLY_SECRET,
// is what keeps anyone else from answering for it. Without that secret the route refuses everything.
import { timingSafeEqual } from 'node:crypto';
import { Hono } from 'hono';
import { globalSecret } from './secrets.ts';
import { deliverReply } from './harness/claude-cloud/replies.ts';
import { isCloudSessionId } from './harness/claude-cloud/dispatch.ts';

export const cloudApi = new Hono();

/** Replies longer than this are cut: a crew report is a summary, not a transcript. */
const MAX_REPLY = 100_000;

export function bearerMatches(header: string | undefined, secret: string | null): boolean {
  if (!secret) return false;
  const got = Buffer.from((header ?? '').replace(/^Bearer\s+/i, ''));
  const want = Buffer.from(secret);
  return got.length === want.length && timingSafeEqual(got, want);
}

cloudApi.post('/reply/:sessionId', async (c) => {
  if (!bearerMatches(c.req.header('authorization'), await globalSecret('OMNI_CLOUD_REPLY_SECRET'))) return c.json({ error: 'unauthorized' }, 401);
  const id = c.req.param('sessionId');
  if (!isCloudSessionId(id)) return c.json({ error: 'not a cloud session id' }, 400);
  const raw = await c.req.text();
  let text = raw;
  if ((c.req.header('content-type') ?? '').includes('application/json')) {
    try {
      const body = JSON.parse(raw) as { text?: unknown };
      text = typeof body.text === 'string' ? body.text : '';
    } catch {
      return c.json({ error: 'bad json' }, 400);
    }
  }
  if (!text.trim()) return c.json({ ok: true, delivered: false });
  return c.json({ ok: true, delivered: deliverReply(id, text.slice(0, MAX_REPLY)) });
});
