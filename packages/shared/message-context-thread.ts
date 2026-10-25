// The thread_reference kind of message context: another thread Ben points at, by identity and not by transcript. The
// record holds who that thread was when the message was sent (its id, its title, its channel) and nothing of what was
// said in it. The agent reads that on demand, a bounded page at a time, through an Omni tool (apps/server/thread-history.ts),
// so attaching a reference never copies a history into the message and never touches the referenced thread.
// The server stamps title, channel and time at send (apps/server/message-context/thread-reference.ts): a rename or an
// archive after that does not rewrite a sent message. apps/mac/OmniKit/Sources/OmniKit/ThreadReferenceContext.swift ports it.
import { ID_MAX, cutLabel, type MessageContextKind, type Parsed } from './message-context.ts';
import { FORBIDDEN_CLASS, plain } from './message-context-terminal.ts';

export interface ThreadReference {
  /** The referenced thread's id. */
  thread: string;
  /** Its title when the message was sent. One plain line. */
  title: string;
  /** Its channel's id, and that channel's name when the message was sent. */
  channel: string;
  channel_name: string;
  /** Whether it is in another channel than the thread the message goes to. Only true when Ben picked it from All channels. */
  cross_channel: boolean;
  /** When the message was sent, as `Date.toISOString` writes it. Ben's pick sets it first; the route stamps it again. */
  captured_at: string;
}

export const TITLE_MAX = 200;
export const CHANNEL_NAME_MAX = 100;
/** The id's characters in a label, enough to tell two threads with one title apart. */
export const SHORT_ID = 8;
export const UNTITLED = 'Untitled thread';
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const FORBIDDEN = new RegExp(FORBIDDEN_CLASS, 'gu');

const validTime = (v: unknown): v is string => typeof v === 'string' && ISO_TIME.test(v) && !Number.isNaN(Date.parse(v)) && new Date(v).toISOString() === v;
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * A title or name from outside the record as one plain line of at most `max` characters: control characters and
 * bidirectional overrides dropped, runs of whitespace made one space, cut with an ellipsis. `fallback` for nothing.
 */
export function cleanLine(raw: unknown, max: number, fallback: string): string {
  const s = (typeof raw === 'string' ? raw : '').replace(FORBIDDEN, ' ').replace(/\s+/g, ' ').trim();
  const chars = [...s];
  if (!chars.length) return fallback;
  return chars.length > max ? `${chars.slice(0, max - 1).join('').trimEnd()}…` : s;
}

export const shortId = (id: string) => id.slice(0, SHORT_ID);

export const threadReference: MessageContextKind<ThreadReference> = {
  kind: 'thread_reference',
  v: 1,
  parse(body, v): Parsed<ThreadReference> {
    if (v !== 1) return { ok: false, error: `thread_reference has no version ${v}` };
    if (!isObj(body)) return { ok: false, error: 'not an object' };
    const thread = plain(body.thread, 'thread', ID_MAX);
    if (!thread.ok) return thread;
    const title = plain(body.title, 'title', TITLE_MAX);
    if (!title.ok) return title;
    const channel = plain(body.channel, 'channel', ID_MAX);
    if (!channel.ok) return channel;
    const channelName = plain(body.channel_name, 'channel_name', CHANNEL_NAME_MAX);
    if (!channelName.ok) return channelName;
    if (typeof body.cross_channel !== 'boolean') return { ok: false, error: 'cross_channel must be true or false' };
    if (!validTime(body.captured_at)) return { ok: false, error: 'captured_at must be a time like 2026-10-24T09:30:00.000Z' };
    return {
      ok: true,
      value: { thread: thread.value, title: title.value, channel: channel.value, channel_name: channelName.value, cross_channel: body.cross_channel, captured_at: body.captured_at },
    };
  },
  // cutLabel keeps the end of a long label, so the id that tells two threads of one title apart is what survives.
  label: (b) => cutLabel(`Thread: ${b.title} (${b.channel_name} · ${shortId(b.thread)})`),
};

/** What the picker and the route know of a thread: the fields a record is made from. */
export interface ThreadIdentity {
  id: string;
  title: string;
  channel: string;
  channel_name: string;
}

/** The record body for `thread` as Ben picked it. `current` is the channel of the thread the message goes to. */
export function referenceBody(thread: ThreadIdentity, current: string, at: Date): ThreadReference {
  return {
    thread: thread.id,
    title: cleanLine(thread.title, TITLE_MAX, UNTITLED),
    channel: thread.channel,
    channel_name: cleanLine(thread.channel_name, CHANNEL_NAME_MAX, thread.channel),
    cross_channel: thread.channel !== current,
    captured_at: at.toISOString(),
  };
}
