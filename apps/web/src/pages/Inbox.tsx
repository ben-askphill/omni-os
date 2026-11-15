import { useInbox } from '../app/useInbox.ts';
import { NeedsYouSection } from '../components/NeedsYou.tsx';
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
 * The Inbox disc's page, with no thread open: what needs Ben at full size, then the results he has not read. The list
 * panel beside it holds every shelf (InboxView); opening a thread from either keeps the panel on the Inbox.
 */
export function InboxPage() {
  const { needsYou } = useApp();
  const { needs, finished, working, loaded } = useInbox();
  return (
    <div className="scroll-thin h-full overflow-y-auto">
      <PageHeader title="Inbox" subtitle={loaded ? inboxSummary({ needs: needs.length, finished: finished.length, working: working.count }) : undefined} width="page" />
      <div className={`${pageColumn('page')} -mt-10 pb-16`}>
        <NeedsYouSection inbox={needsYou} showChannel />
      </div>
    </div>
  );
}
