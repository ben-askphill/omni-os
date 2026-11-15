import type { NeedsYou, NeedsYouItem, Thread } from '../api.ts';
import { useInbox } from '../app/useInbox.ts';
import { EmptyNote, ItemsSection } from '../components/NeedsYou.tsx';
import type { InboxThread } from '../inbox.ts';
import { splitNeeds } from '../needs-you.ts';
import { PageHeader } from '../components/ui.tsx';
import { pageColumn } from '../components/ui/feedback.tsx';
import { useApp } from '../store.tsx';

/** The counts under the title, from the same shelves as the Inbox list, so the two never disagree. */
export function inboxSummary(counts: { needs: number; finished: number; working: number }): string {
  const parts = [
    counts.needs ? `${counts.needs} need${counts.needs === 1 ? 's' : ''} you` : null,
    counts.finished ? `${counts.finished} finished` : null,
    counts.working ? `${counts.working} working` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'Nothing is waiting on you.';
}

/**
 * The Finished shelf's threads as rows: a thread with an unread result keeps its Needs you item (bold, its last words);
 * one Ben has read already has none, so it reads as Finished from its own copy.
 */
export function finishedItems(finished: readonly InboxThread[], needsYou: NeedsYou | null): NeedsYouItem[] {
  const byId = new Map((needsYou?.items ?? []).map((i) => [i.thread.id, i]));
  return finished.map((t) => byId.get(t.id) ?? { thread: t as Thread, result: null, blockers: [], at: t.updated_at ?? t.created_at });
}

/**
 * The Inbox disc's page, with no thread open: what needs Ben at full size, then the Finished shelf (turns that ended,
 * read or not), so its heading counts what the subtitle counts. The list panel beside it holds every shelf
 * (InboxView); opening a thread from either keeps the panel on the Inbox.
 */
export function InboxPage() {
  const { needsYou } = useApp();
  const { needs, finished, working, loaded } = useInbox();
  return (
    <div className="scroll-thin h-full overflow-y-auto">
      <PageHeader title="Inbox" subtitle={loaded ? inboxSummary({ needs: needs.length, finished: finished.length, working: working.count }) : undefined} width="page" />
      <div className={`${pageColumn('page')} -mt-10 pb-16`}>
        {needsYou && (
          <ItemsSection
            label="Needs you"
            items={splitNeeds(needsYou.items).needs}
            showChannel
            empty={<EmptyNote icon="check">Nothing needs you. Questions, failures and usage limits show up here.</EmptyNote>}
          />
        )}
        {finished.length > 0 && <ItemsSection label="Finished" items={finishedItems(finished, needsYou)} showChannel />}
      </div>
    </div>
  );
}
