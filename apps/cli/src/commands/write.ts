// `omni new` and `omni send`: start a thread, message one, and with --wait report how its turn ended.
import type { CreateThreadRequest, SendMode, Thread } from '@omni/client-core';
import { flag, parseArgs, value, type Parsed } from '../args.ts';
import { client, type Client } from '../connection.ts';
import { blockerText, clip, json, shortId } from '../format.ts';
import { EXIT, UsageError, type Io } from '../io.ts';
import { resolveThread } from '../resolve.ts';
import { EXIT_OF, newestEvent, waitFor, type Outcome, type Seen } from '../wait.ts';
import { openRoute } from './open.ts';

/** The text from the arguments, or stdin when there is none or it is "-". */
async function textFrom(words: string[], io: Io, command: string, what: string): Promise<string> {
  const piped = words.length === 0 || (words.length === 1 && words[0] === '-');
  const text = piped ? ((await io.stdin()) ?? '') : words.join(' ');
  if (!text.trim()) throw new UsageError(`write a ${what}, or pipe one in`, command);
  return piped ? text.replace(/\n+$/, '') : text;
}

const isBusy = (t: Pick<Thread, 'status'>) => t.status === 'queued' || t.status === 'running';

/** Waits, prints the reply on stdout and how it ended on stderr (or one JSON object), and answers the exit code. */
async function waitAndReport(c: Client, io: Io, id: string, seen: Seen, asJson: boolean): Promise<number> {
  if (!asJson) io.err(`Waiting for ${shortId(id)}. Ctrl-C stops waiting, not the thread.\n`);
  const outcome = await waitFor(c, io, id, seen);
  if (asJson) io.out(json(outcomeJson(c, outcome)));
  else {
    if (outcome.reply) io.out(`${outcome.reply.replace(/\n+$/, '')}\n`);
    io.err(`${endLine(outcome)}\n${c.link(`#/t/${id}`)}\n`);
  }
  return EXIT_OF[outcome.kind];
}

function endLine(o: Outcome): string {
  const id = shortId(o.thread.id);
  if (o.kind === 'needs-you') return `${id} needs you: ${o.blockers.map(blockerText).join('; ') || 'see the thread'}`;
  return o.error ? `${id} ${o.kind}: ${clip(o.error, 300)}` : `${id} ${o.kind}`;
}

const outcomeJson = (c: Client, o: Outcome) => ({
  id: o.thread.id,
  outcome: o.kind,
  status: o.thread.status,
  reply: o.reply,
  needs_you: o.blockers,
  error: o.error,
  url: c.link(`#/t/${o.thread.id}`),
  thread: o.thread,
});

const NEW_FLAGS = {
  channel: { short: 'c', value: true },
  role: { short: 'r', value: true },
  model: { short: 'm', value: true },
  wait: { short: 'w' },
  json: {},
  open: { short: 'o' },
} as const;

export async function newCommand(argv: string[], io: Io): Promise<number> {
  const p = parseArgs(argv, NEW_FLAGS, 'new');
  const prompt = await textFrom(p.positional, io, 'new', 'prompt');
  const c = client(io);
  const parent = c.conn.thread;
  const body: CreateThreadRequest & { source: 'capture' | 'conductor'; parent_id?: string } = {
    // A retry after a lost answer gets this thread back instead of a second one.
    id: io.uuid(),
    prompt,
    ...(value(p, 'channel') && { channel: value(p, 'channel') }),
    ...(value(p, 'role') && { role: value(p, 'role') }),
    ...(value(p, 'model') && { model: value(p, 'model') }),
    // From inside a thread it is a delegation, as the Conductor's delegate makes: filed under it, reporting back to it.
    ...(parent ? { source: 'conductor', parent_id: parent } : { source: 'capture' }),
  };
  const t = await c.api.createThread(body);
  if (flag(p, 'open')) await openRoute(c, io, `#/t/${t.id}`, { quiet: flag(p, 'json') || flag(p, 'wait') });
  if (flag(p, 'wait')) {
    if (!flag(p, 'json')) io.err(`Started ${shortId(t.id)} in #${t.channel_id}: ${t.title}\n`);
    return waitAndReport(c, io, t.id, { baseline: 0, sawBusy: isBusy(t) }, flag(p, 'json'));
  }
  if (flag(p, 'json')) io.out(json({ id: t.id, url: c.link(`#/t/${t.id}`), thread: t }));
  else io.out(`Started ${shortId(t.id)} in #${t.channel_id}: ${t.title}\n${c.link(`#/t/${t.id}`)}\n`);
  return EXIT.ok;
}

const SEND_FLAGS = {
  queue: {},
  interrupt: {},
  wait: { short: 'w' },
  json: {},
} as const;

function modeOf(p: Parsed): SendMode {
  if (flag(p, 'queue') && flag(p, 'interrupt')) throw new UsageError('pick --queue or --interrupt, not both', 'send');
  return flag(p, 'queue') ? 'queue' : flag(p, 'interrupt') ? 'interrupt' : 'steer';
}

const HOW: Record<SendMode, string> = {
  steer: 'it reads it at its next step',
  queue: 'it runs after the current turn',
  interrupt: 'the current turn stops and it runs',
};

export async function sendCommand(argv: string[], io: Io): Promise<number> {
  const p = parseArgs(argv, SEND_FLAGS, 'send');
  const [target, ...words] = p.positional;
  if (!target) throw new UsageError('say which thread to send to', 'send');
  const mode = modeOf(p);
  const message = await textFrom(words, io, 'send', 'message');
  const c = client(io);
  const id = await resolveThread(c, target);
  // The newest event before sending, so the wait ends on the turn this message starts, not an older one.
  const baseline = flag(p, 'wait') ? newestEvent(await c.api.thread(id)) : 0;
  const body = {
    prompt: message,
    mode,
    request_id: io.uuid(),
    // An agent's message reads as the Conductor's, as message_thread sends it; a person's as Ben's.
    from: c.conn.thread ? 'conductor' : 'ben',
  };
  const sent = await c.api.sendMessage(id, body);
  const forwardedTo = (sent as { forwarded_to?: string }).forwarded_to;
  if (flag(p, 'wait')) {
    if (!flag(p, 'json')) io.err(`Sent to ${shortId(id)}${forwardedTo ? ` on ${forwardedTo}` : ''}.\n`);
    return waitAndReport(c, io, id, { baseline, sawBusy: isBusy(sent) }, flag(p, 'json'));
  }
  if (flag(p, 'json')) io.out(json({ id, status: sent.status, request: sent.request, ...(forwardedTo && { forwarded_to: forwardedTo }), url: c.link(`#/t/${id}`) }));
  else {
    const busy = isBusy(sent) && mode !== 'interrupt';
    const where = forwardedTo ? ` on ${forwardedTo}` : '';
    io.out(`Sent to ${shortId(id)}${where} (${sent.status})${busy ? `: ${HOW[mode]}` : ''}.\n`);
  }
  return EXIT.ok;
}
