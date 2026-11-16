// `omni threads` and `omni show`: what is there, and one thread in detail.
import type { NeedsYouItem, Thread } from '@omni/client-core';
import { ranOnTitle, runElapsed, type RanOnFields } from '@omni/shared/ran-on.ts';
import { flag, parseArgs, value } from '../args.ts';
import { client } from '../connection.ts';
import { blockerText, clip, fields, json, lastError, lastReply, needsYouWhy, shortId, statusText, table, when } from '../format.ts';
import { EXIT, UsageError, type Io } from '../io.ts';
import { resolveThread } from '../resolve.ts';

const THREADS_FLAGS = {
  'needs-you': {},
  running: {},
  channel: { short: 'c', value: true },
  limit: { short: 'n', value: true },
  json: {},
} as const;

const TITLE = 70;

export async function threadsCommand(argv: string[], io: Io): Promise<number> {
  const p = parseArgs(argv, THREADS_FLAGS, 'threads');
  if (p.positional.length) throw new UsageError(`unexpected ${p.positional[0]}`, 'threads');
  const limitText = value(p, 'limit');
  const limit = limitText === undefined ? 20 : Number(limitText);
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new UsageError('--limit takes a number from 1 to 500', 'threads');
  if (flag(p, 'needs-you') && flag(p, 'running')) throw new UsageError('pick --needs-you or --running, not both', 'threads');
  const c = client(io);
  const channel = value(p, 'channel');
  const now = io.now();

  if (flag(p, 'needs-you')) {
    const view = await c.api.needsYou(channel ? { channel } : {});
    const items = view.items.slice(0, limit);
    if (flag(p, 'json')) io.out(json({ unread: view.unread, blocked: view.blocked, items }));
    else if (!items.length) io.out('Nothing needs you.\n');
    else io.out(table([['ID', 'WHY', 'CHANNEL', 'WHEN', 'TITLE'], ...items.map((i) => needsRow(i, now))]));
    return EXIT.ok;
  }

  const list = await c.api.threads({ ...(channel && { channel }), ...(flag(p, 'running') && { status: 'running' as const }), limit });
  if (flag(p, 'json')) io.out(json(list));
  else if (!list.length) io.out(flag(p, 'running') ? 'Nothing is running.\n' : 'No threads.\n');
  else io.out(table([['ID', 'STATUS', 'CHANNEL', 'UPDATED', 'TITLE'], ...list.map((t) => threadRow(t, now))]));
  return EXIT.ok;
}

const threadRow = (t: Thread, now: number) => [shortId(t.id), statusText(t), `#${t.channel_id}`, when(t.updated_at, now), clip(t.title, TITLE)];

const needsRow = (i: NeedsYouItem, now: number) => [shortId(i.thread.id), needsYouWhy(i), `#${i.thread.channel_id}`, when(i.at, now), clip(i.thread.title, TITLE)];

export async function showCommand(argv: string[], io: Io): Promise<number> {
  const p = parseArgs(argv, { json: {} }, 'show');
  const [target, extra] = p.positional;
  if (!target) throw new UsageError('say which thread to show', 'show');
  if (extra) throw new UsageError(`unexpected ${extra}`, 'show');
  const c = client(io);
  const id = await resolveThread(c, target);
  const [d, needs] = await Promise.all([c.api.thread(id), c.api.needsYou({ thread: id })]);
  const item = needs.items.find((i) => i.thread.id === id) ?? null;
  const reply = await lastReply(c.api, id, d.events, d.thread.last_text);
  const url = c.link(`#/t/${id}`);
  const error = d.thread.status === 'failed' ? lastError(d.events) : null;
  if (flag(p, 'json')) {
    io.out(json({ thread: d.thread, error, channel: d.channel?.id ?? d.thread.channel_id, parent: d.parent?.id ?? null, children: d.children.map((t) => ({ id: t.id, status: t.status, title: t.title })), pending: d.pending?.length ?? 0, needs_you: item, reply, url }));
    return EXIT.ok;
  }
  const t = d.thread;
  const now = io.now();
  const extras = t as Thread & RanOnFields;
  const elapsed = runElapsed(extras, now);
  const running = d.children.filter((ch) => ch.status === 'running' || ch.status === 'queued').length;
  io.out(`${t.title}\n`);
  io.out(
    fields([
      ['id', t.id],
      ['status', `${statusText(t)}${elapsed ? ` for ${elapsed}` : `, updated ${when(t.updated_at, now)}`}`],
      ['channel', `#${t.channel_id}`],
      ['run', [t.role, t.harness, t.model, t.effort].filter(Boolean).join(' · ')],
      ['machine', extras.ran_on ? ranOnTitle({ ...extras, branch: null }, now) : null],
      ['branch', t.branch],
      ['parent', d.parent ? `${shortId(d.parent.id)} ${clip(d.parent.title, 60)}` : null],
      ['children', d.children.length ? `${d.children.length}${running ? ` (${running} running)` : ''}` : null],
      ['waiting', d.pending?.length ? `${d.pending.length} message${d.pending.length === 1 ? '' : 's'}` : null],
      ['blocked', d.blocked ?? null],
      ['error', error ? clip(error, 200) : null],
      ['setup', t.setup_error],
      ['needs you', item ? (item.blockers.length ? item.blockers.map(blockerText).join('; ') : needsYouWhy(item)) : null],
      ['url', url],
    ]),
  );
  if (reply) io.out(`\n${reply.replace(/\n+$/, '')}\n`);
  return EXIT.ok;
}
