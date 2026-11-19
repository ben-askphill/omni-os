// Memory facts over the API (db/repos/memories.ts): a channel's Recent learnings. GET lists a channel's, POST adds one,
// PATCH edits or approves one, DELETE drops one. An agent thread is known by its own token, or the thread an
// install-token caller names (automation-guard.ts callerOf): it may only propose, never approve, edit or delete,
// because an approved fact is a prompt every later thread in the channel runs with. A thread other than the Conductor
// proposes only for its own channel, so what it saw in one client's work cannot land in another's. Text is masked for
// secrets before it is saved. Its own app so tests call it directly. A thread that reads data/api-token from disk on
// purpose still passes as the user, as automation-guard.ts says of its own rules (finding 12, part 3).
import { Hono } from 'hono';
import { parseMemoryText, sortLearnings } from '@omni/shared/memory.ts';
import { callerOf } from './automation-guard.ts';
import { publishFeed } from './bus.ts';
import { channels, memories, threads } from './db.ts';
import { secretValues } from './secrets.ts';
import { maskSecrets } from './usage-scan/mask.ts';

export const memoryApi = new Hono();

const AGENT_WRITE = 'Only the user approves, edits or deletes a learning. Propose one instead; it waits in the channel settings.';

memoryApi.get('/', (c) => {
  const channel = c.req.query('channel');
  if (!channel || !channels.get(channel)) return c.json({ error: 'not found' }, 404);
  const learnings = sortLearnings(memories.byChannel(channel));
  return c.json({ learnings, waiting: learnings.filter((m) => m.status === 'proposed').length });
});

memoryApi.post('/', async (c) => {
  const body = (await c.req.json().catch(() => null)) as { channel?: unknown; text?: unknown } | null;
  const channel = typeof body?.channel === 'string' ? channels.get(body.channel) : undefined;
  if (!channel) return c.json({ error: 'channel not found' }, 404);
  const parsed = parseMemoryText(body?.text);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const caller = callerOf(c);
  const from = caller ? threads.get(caller) : undefined;
  if (caller && !from) return c.json({ error: 'unknown thread' }, 403);
  if (from && from.role !== 'conductor' && from.channel_id !== channel.id) {
    return c.json({ error: `A thread proposes learnings for its own channel (#${from.channel_id}) only.` }, 403);
  }
  const text = maskSecrets(parsed.value, await secretValues()).text;
  const fact = memories.create({
    channel_id: channel.id,
    text,
    status: from ? 'proposed' : 'approved',
    proposed_by: from ? 'agent' : 'user',
    source_thread_id: from?.id ?? null,
  });
  publishFeed({ type: 'memory', channel_id: channel.id });
  return c.json(fact, 201);
});

memoryApi.patch('/:id', async (c) => {
  if (callerOf(c)) return c.json({ error: AGENT_WRITE }, 403);
  const body = (await c.req.json().catch(() => null)) as { text?: unknown; approve?: unknown } | null;
  let text: string | undefined;
  if (body?.text !== undefined) {
    const parsed = parseMemoryText(body.text);
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);
    text = maskSecrets(parsed.value, await secretValues()).text;
  }
  if (text === undefined && body?.approve !== true) return c.json({ error: 'pass text or approve: true' }, 400);
  const fact = memories.update(c.req.param('id'), { text, approve: body?.approve === true });
  if (!fact) return c.json({ error: 'not found' }, 404);
  publishFeed({ type: 'memory', channel_id: fact.channel_id });
  return c.json(fact);
});

memoryApi.delete('/:id', (c) => {
  if (callerOf(c)) return c.json({ error: AGENT_WRITE }, 403);
  const fact = memories.get(c.req.param('id'));
  if (!fact || !memories.remove(fact.id)) return c.json({ error: 'not found' }, 404);
  publishFeed({ type: 'memory', channel_id: fact.channel_id });
  return c.json({ ok: true });
});
