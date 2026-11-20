// Memory facts over the API (db/repos/memories.ts): a channel's Recent learnings at /memory, and a crew role's memory
// at /crew/:id/memory (crew plan S6, docs/plans/2026-11-18-user-defined-crew.md section 3). GET lists, POST adds,
// PATCH /memory/:id edits or approves one, DELETE /memory/:id drops one. An agent thread is known by its own token, or
// the thread an install-token caller names (automation-guard.ts callerOf): it may only propose, never approve, edit or
// delete, because an approved fact is a prompt every later thread runs with. Nothing an agent sends makes a fact the
// user's: `proposed_by` is `agent` whatever the body says. A thread other than the Conductor proposes only for its own
// channel, and only for its own role, so what it saw in one client's work cannot land in another's. Text is masked for
// secrets before it is saved. Its own app so tests call it directly. A thread that reads data/api-token from disk on
// purpose still passes as the user, as automation-guard.ts says of its own rules (finding 12, part 3).
import { Hono } from 'hono';
import { parseMemoryText, sortLearnings } from '@omni/shared/memory.ts';
import { callerOf, lineage } from './automation-guard.ts';
import { getCrew } from './crew.ts';
import { userName } from './profile.ts';
import { publishFeed } from './bus.ts';
import { channels, memories, threads } from './db.ts';
import { secretValues } from './secrets.ts';
import { maskSecrets } from './usage-scan/mask.ts';

export const memoryApi = new Hono();

/** Why an agent may not settle a fact: a channel's learning waits in the channel's settings, a role's lesson in Settings > Crew. */
const agentWrite = (id: string) =>
  memories.get(id)?.role
    ? `Only ${userName()} approves, edits or deletes an agent's lesson. Propose one with remember instead; it waits in Settings > Agents.`
    : 'Only the user approves, edits or deletes a learning. Propose one instead; it waits in the channel settings.';

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
  publishFeed({ type: 'memory', channel_id: channel.id, role: null });
  return c.json(fact, 201);
});

memoryApi.patch('/:id', async (c) => {
  if (callerOf(c)) return c.json({ error: agentWrite(c.req.param('id')) }, 403);
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
  publishFeed({ type: 'memory', channel_id: fact.channel_id, role: fact.role });
  return c.json(fact);
});

memoryApi.delete('/:id', (c) => {
  if (callerOf(c)) return c.json({ error: agentWrite(c.req.param('id')) }, 403);
  const fact = memories.get(c.req.param('id'));
  if (!fact || !memories.remove(fact.id)) return c.json({ error: 'not found' }, 404);
  publishFeed({ type: 'memory', channel_id: fact.channel_id, role: fact.role });
  return c.json({ ok: true });
});

/** A crew role's memory: GET and POST /crew/:id/memory. Mounted beside /api/crew (app.ts). */
export const crewMemoryApi = new Hono();

const CONDUCTOR = 'conductor';

crewMemoryApi.get('/crew/:id/memory', (c) => {
  const role = getCrew(c.req.param('id'));
  if (!role) return c.json({ error: 'No agent with this id.' }, 404);
  const list = sortLearnings(memories.byRole(role.id));
  return c.json({ memories: list, waiting: list.filter((m) => m.status === 'proposed').length });
});

/**
 * Add a lesson to a role: `{ text, channel? }`. The user's applies at once. An agent's is a proposal, held to these
 * rules, and applies at once only when the user set the role's `memory_writes: auto`:
 * - The role's `memory` is read-write. With read or off, only the user adds to it.
 * - A thread proposes for its own role; only the Conductor proposes for any role.
 * - A thread other than the Conductor tags its own channel (leave `channel` out), or none (`channel: null`, every
 *   channel), never another channel. An untagged one always waits for the user, even on an auto role: it would carry
 *   one channel's lesson into every other.
 * - A thread an automation or a usage scan started, or any thread below one, only ever proposes: nobody watches it.
 */
crewMemoryApi.post('/crew/:id/memory', async (c) => {
  const role = getCrew(c.req.param('id'));
  if (!role) return c.json({ error: 'No agent with this id.' }, 404);
  const body = (await c.req.json().catch(() => null)) as { text?: unknown; channel?: unknown } | null;
  const parsed = parseMemoryText(body?.text);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  if (body?.channel !== undefined && body.channel !== null && typeof body.channel !== 'string') return c.json({ error: 'channel is a channel id, or null for every channel' }, 400);
  const asked = body?.channel as string | null | undefined;

  const caller = callerOf(c);
  const from = caller ? threads.get(caller) : undefined;
  if (caller && !from) return c.json({ error: 'unknown thread' }, 403);
  const who = userName();
  let channel: string | null;
  let status: 'proposed' | 'approved' = 'approved';
  if (from) {
    if (role.memory !== 'read-write') {
      return c.json({ error: `${role.name}'s memory is ${role.memory === 'off' ? 'off' : 'read only'}: only ${who} adds to it, in Settings > Agents.` }, 403);
    }
    const conductor = from.role === CONDUCTOR;
    if (!conductor && from.role !== role.id) {
      return c.json({ error: from.role ? `A thread proposes lessons for its own role (${from.role}) only.` : 'This thread runs as no agent, so it has no agent memory to add to.' }, 403);
    }
    if (conductor) channel = asked ?? null;
    else if (asked === undefined) channel = from.channel_id;
    else if (asked === null || asked === from.channel_id) channel = asked;
    else return c.json({ error: `A thread proposes lessons for its own channel (#${from.channel_id}), or for every channel, only.` }, 403);
    const l = lineage(from.id);
    const auto = role.memoryWrites === 'auto' && !l.automation && !l.scan && (conductor || channel !== null);
    status = auto ? 'approved' : 'proposed';
  } else {
    channel = asked ?? null;
  }
  if (channel !== null && !channels.get(channel)) return c.json({ error: 'channel not found' }, 404);

  const text = maskSecrets(parsed.value, await secretValues()).text;
  const fact = memories.create({ channel_id: channel, role: role.id, text, status, proposed_by: from ? 'agent' : 'user', source_thread_id: from?.id ?? null });
  // Every lesson a role kept at once names its thread, here and in the role's Memory tab.
  if (from && status === 'approved') console.log(`[memory] ${role.id} kept lesson ${fact.id} at once (memory_writes: auto), from thread ${from.id}`);
  publishFeed({ type: 'memory', channel_id: fact.channel_id, role: role.id });
  return c.json(fact, 201);
});
