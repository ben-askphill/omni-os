// How the Web UI shows a thread_reference (packages/shared/message-context-thread.ts): which thread it named, in which
// channel, and a link that opens it. The title and channel are the ones captured when the message was sent, so a rename
// or an archive since does not change what a sent message says.
import { shortId, type ThreadReference } from '@omni/shared/message-context-thread.ts';
import { fullDate } from '../format.ts';
import { href } from '../router.ts';
import { Icon } from '../components/ui.tsx';
import type { ContextView } from './views.ts';

function ThreadReferenceDetail({ body: b }: { body: ThreadReference }) {
  return (
    <div className="min-w-0">
      <div className="break-words text-[13px] font-medium text-fg">{b.title}</div>
      <div className="mt-0.5 text-[11.5px] text-fg-2">
        {b.channel_name}
        {b.cross_channel && <span className="ml-1.5 rounded-full bg-surface-2 px-2 py-px text-[11px] text-fg-3">other channel</span>}
      </div>
      <div className="truncate font-mono text-[11px] text-fg-4">
        thread {shortId(b.thread)} · attached {fullDate(b.captured_at)}
      </div>
      <p className="mt-1.5 text-[11.5px] leading-snug text-fg-3">Only this reference went with the message. The agent reads the thread when it needs to.</p>
      <a href={href.thread(b.thread)} className="hov press mt-2 inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[12.5px] font-medium text-fg-2 hover:text-fg">
        <Icon name="external" size={13} />
        Open thread
      </a>
    </div>
  );
}

export const threadReferenceView: ContextView<ThreadReference> = { icon: 'message', Detail: ThreadReferenceDetail };
