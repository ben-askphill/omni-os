// The Open items card's state, kept out of the component so it can be tested without a renderer. The web card
// (apps/web/src/components/thread/OpenItemsCard.tsx) holds the same rules.
import type { Thread } from '@omni/client-core';
import { readOpenItems, type OpenItem } from '@omni/shared/open-items.ts';

/** What Ben typed or picked, by the item's text. */
export type OpenAnswers = Readonly<Record<string, string>>;

/**
 * The items the card lists, or none while it should not show: the turn is still going, or a message waits to be read
 * (it clears the items once the agent takes it). A delegated thread never has any, since the server makes none for it.
 */
export function shownOpenItems(thread: Pick<Thread, 'status' | 'open_items'>, waiting: boolean): OpenItem[] {
  if (thread.status !== 'done' || waiting) return [];
  return readOpenItems(thread.open_items);
}

/**
 * The answers to keep when the stored items change. A dismiss leaves some of the same items, and what was typed on the
 * rest stays. Anything else is a new set (a reply cleared it and a later turn asked again), which starts empty, even
 * when it repeats a question.
 */
export function answersAfter(before: string | null, after: string | null, answers: OpenAnswers): OpenAnswers {
  const now = readOpenItems(after);
  const was = new Set(readOpenItems(before).map((i) => i.text));
  if (!now.length || !now.every((i) => was.has(i.text))) return {};
  return Object.fromEntries(now.flatMap((i) => (answers[i.text] ? [[i.text, answers[i.text]]] : [])));
}

/** A tap on an option picks it, and a second tap on the picked one clears the answer. */
export const pickOption = (answers: OpenAnswers, item: OpenItem, option: string): OpenAnswers => ({
  ...answers,
  [item.text]: answers[item.text] === option ? '' : option,
});

/** The heading over the items. */
export const openItemsHeading = (count: number) => `${count === 1 ? 'Open item' : `${count} open items`} before this thread is done`;

/** The answer field's hint for an item. */
export const answerPlaceholder = (item: OpenItem) =>
  item.kind === 'blocker' ? 'Note, e.g. done' : item.options ? 'Or write your own answer' : 'Your answer';
