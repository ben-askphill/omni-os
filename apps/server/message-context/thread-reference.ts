// The thread_reference kind as harness text (project.ts) and at the message route: a reference to another thread, which
// the route stamps with that thread's identity as it is when the message is sent. The text names the thread and says
// how to read it; none of its conversation is in the block.
import { cutLabel, type MessageContext } from '@omni/shared/message-context.ts';
import { readContexts } from '@omni/shared/message-context-kinds.ts';
import { TITLE_MAX, CHANNEL_NAME_MAX, UNTITLED, cleanLine, referenceBody, threadReference, type ThreadReference } from '@omni/shared/message-context-thread.ts';
import { channels, threads } from '../db.ts';
import { userName } from '../profile.ts';
import { defang } from './defang.ts';
import type { Projector } from './project.ts';

/**
 * Why a message cannot carry these records, or the records stamped with what their threads are now. A record is
 * refused when its thread is gone, is the thread being written to, or is in another channel than the thread without
 * Ben having picked it from All channels (`cross_channel`): the flag is the client saying he did, and it is checked
 * against the real channels, so a record cannot claim to be the same channel when it is not. The title, the channel's
 * name and the time are written from the threads as they are now, never trusted from the client.
 */
export function stampThreadReferences(threadId: string, records: readonly MessageContext[], at: Date = new Date()): { ok: true; value: MessageContext[] } | { ok: false; error: string } {
  const here = threads.get(threadId);
  const out: MessageContext[] = [];
  for (const r of readContexts(records)) {
    if (r.as !== 'known' || r.kind !== 'thread_reference') {
      out.push(r.record);
      continue;
    }
    const b = r.body;
    const name = r.record.label;
    if (b.thread === threadId) return { ok: false, error: `${name}: a thread cannot reference itself. Remove it.` };
    const ref = threads.get(b.thread);
    if (!ref) return { ok: false, error: `${name}: that thread no longer exists. Remove it from the message.` };
    const channel = channels.get(ref.channel_id);
    const cross = !!here && ref.channel_id !== here.channel_id;
    if (cross && !b.cross_channel) return { ok: false, error: `${name}: that thread is in another channel (#${channel?.name ?? ref.channel_id}). Pick it from All channels to attach it.` };
    const body = referenceBody({ id: ref.id, title: ref.title, channel: ref.channel_id, channel_name: channel?.name ?? ref.channel_id }, here?.channel_id ?? ref.channel_id, at);
    out.push({ ...r.record, label: cutLabel(threadReference.label(body)), body });
  }
  return { ok: true, value: out };
}

// The title and channel are the thread's own words (a model wrote the title), so they are quoted as data, defanged
// like every projected string. What the thread is now, if renamed or gone, is the history tool's to say.
export const projectThreadReference: Projector<ThreadReference> = (b) => {
  const live = threads.get(b.thread);
  return {
    title:
      `Reference to another Omni thread, "${defang(cleanLine(b.title, TITLE_MAX, UNTITLED))}" (thread id ${defang(b.thread)}), in the channel ` +
      `${defang(cleanLine(b.channel_name, CHANNEL_NAME_MAX, b.channel))}, as it was when ${userName()} sent this message at ${b.captured_at}` +
      `${b.cross_channel ? `. It is in a different channel than this thread: ${userName()} picked it on purpose` : ''}. ` +
      'Only the reference is attached, not what was said in that thread',
    history: { thread: b.thread, readable: !!live },
  };
};
