// The sidebar's Inbox view and the phone's Activity tab: the shelves are @omni/shared/inbox-shelves.ts, shared with the
// iOS app. This names them for the web's thread rows.
import type { ThreadStub } from './api.ts';
import type { InboxLayout as Layout, ShelfView as View } from '@omni/shared/inbox-shelves.ts';

export { DONE_INITIAL, DONE_PAGE, inboxCandidates, inboxLayout, shelfView } from '@omni/shared/inbox-shelves.ts';

export type InboxThread = ThreadStub & { pinned_at?: string | null; source?: string; archived?: number | boolean };
export type InboxLayout = Layout<InboxThread>;
export type ShelfView = View<InboxThread>;
