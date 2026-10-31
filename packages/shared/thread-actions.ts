// The thread action menu: one list of ids, groups, labels and conditions that the Web UI's right-click menu, the phone's
// thread sheet and the Mac app's right-click all render. The Mac runs it from the slash engine bundle
// (apps/mac/slash-engine/entry.ts, `npm run build:slash`), and apps/server/tests/mac-fixtures.test.ts records its
// JSON as thread-menu.json for the Swift types.
import { continueSourceRefusal } from './continue.ts';

export type ThreadActionId = 'pin' | 'done' | 'rename' | 'move' | 'archive' | 'fork' | 'reference' | 'grok';
export type ThreadActionGroupId = 'organize' | 'continue' | 'send';
/** Names every client's icon set has. */
export type ThreadActionIcon = 'pin' | 'check' | 'pencil' | 'folder' | 'archive' | 'branch' | 'message' | 'grok';

/** What a surface knows about the thread when it opens the menu. */
export interface ThreadMenuFacts {
  /** The surface has the thread's row, so it knows the state below. Pin, done, move, fork and reference wait for it. */
  row: boolean;
  archived: boolean;
  pinned: boolean;
  done: boolean;
  /** No turn is running, so it can be marked done. A running thread brings its own result. */
  settled: boolean;
  /** It reports to a parent, so it sits under that parent rather than in a folder. */
  child: boolean;
  /** The agent CLI it runs in. Fork is off for one whose files are not on this Mac. */
  harness: string | null;
  /** Grok Bot's webhook URL is set. */
  grokBot: boolean;
}

export interface ThreadMenuItem {
  id: ThreadActionId;
  label: string;
  icon: ThreadActionIcon;
  /** A line under the label where the surface has room for one (the phone's sheet). */
  hint?: string;
  /** Why it cannot run here. Shown under it, and the item does nothing. */
  off?: string;
}

export interface ThreadMenuGroup {
  id: ThreadActionGroupId;
  title: string;
  items: ThreadMenuItem[];
}

interface Spec {
  id: ThreadActionId;
  group: ThreadActionGroupId;
  icon: ThreadActionIcon;
  when: (f: ThreadMenuFacts) => boolean;
  label: (f: ThreadMenuFacts) => string;
  hint?: string;
  off?: (f: ThreadMenuFacts) => string | null;
}

export const THREAD_ACTION_GROUPS: { id: ThreadActionGroupId; title: string }[] = [
  { id: 'organize', title: 'Organize' },
  { id: 'continue', title: 'Continue' },
  { id: 'send', title: 'Send to' },
];

/**
 * Every action, in menu order. At most ten, so the menu stays short on a phone. Where a thread runs (Run on, Hand off,
 * Take over) is the composer's Machine chip, not a menu item.
 */
export const THREAD_ACTIONS: readonly Spec[] = [
  // Archived threads are out of the lists, so out of Pinned too.
  { id: 'pin', group: 'organize', icon: 'pin', when: (f) => f.row && !f.archived, label: (f) => (f.pinned ? 'Unpin thread' : 'Pin thread') },
  { id: 'done', group: 'organize', icon: 'check', when: (f) => f.row && (f.done || f.settled), label: (f) => (f.done ? 'Mark as not done' : 'Mark as done') },
  { id: 'rename', group: 'organize', icon: 'pencil', when: () => true, label: () => 'Rename thread' },
  { id: 'move', group: 'organize', icon: 'folder', when: (f) => f.row && !f.child, label: () => 'Move to folder' },
  { id: 'archive', group: 'organize', icon: 'archive', when: () => true, label: (f) => (f.archived ? 'Unarchive thread' : 'Archive thread') },
  {
    id: 'fork',
    group: 'continue',
    icon: 'branch',
    when: (f) => f.row,
    label: () => 'Fork thread',
    hint: 'A new thread that picks up from here',
    off: (f) => (f.harness ? continueSourceRefusal(f.harness) : null),
  },
  { id: 'reference', group: 'continue', icon: 'message', when: (f) => f.row && !f.archived, label: () => 'Reference a thread', hint: 'Attach another thread, not its messages' },
  { id: 'grok', group: 'send', icon: 'grok', when: (f) => f.grokBot, label: () => 'Send to Grok Bot', hint: "This thread's text" },
];

/** The menu for a thread in this state: its groups in order, each with the actions that apply. Empty groups are left out. */
export function threadMenu(f: ThreadMenuFacts): ThreadMenuGroup[] {
  return THREAD_ACTION_GROUPS.map((g) => ({
    ...g,
    items: THREAD_ACTIONS.filter((a) => a.group === g.id && a.when(f)).map((a) => {
      const item: ThreadMenuItem = { id: a.id, label: a.label(f), icon: a.icon };
      if (a.hint) item.hint = a.hint;
      const off = a.off?.(f);
      if (off) item.off = off;
      return item;
    }),
  })).filter((g) => g.items.length > 0);
}

/** A thread every action applies to: the Mac fixture, and the base the tests vary. */
export const EVERY_ACTION_FACTS: ThreadMenuFacts = {
  row: true,
  archived: false,
  pinned: false,
  done: false,
  settled: true,
  child: false,
  harness: 'claude-code',
  grokBot: true,
};
