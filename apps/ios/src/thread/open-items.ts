// The Open items card's state, kept out of the component so it can be tested without a renderer. The web card
// (apps/web/src/components/thread/OpenItemsCard.tsx) holds the same rules.
import type { Thread } from '@omni/client-core';
import { answersMessage, readOpenItems, type OpenItem } from '@omni/shared/open-items.ts';

import type { OutboxItem } from '../send/outbox';

/** What Ben typed or picked, by the item's text. */
export type OpenAnswers = Readonly<Record<string, string>>;

/**
 * The items the card lists, or none while it should not show: the Open items card is off in Settings (`on`, the
 * server's display switch, off by default), the turn is still going, or a message waits to be read (it clears the
 * items once the agent takes it). A delegated thread never has any, since the server makes none for it.
 */
export function shownOpenItems(thread: Pick<Thread, 'status' | 'open_items'>, waiting: boolean, on: boolean): OpenItem[] {
  if (!on || thread.status !== 'done' || waiting) return [];
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

/**
 * Whether a message on its way hides the card, as a queued one hides the web's: one the server holds for the agent, or
 * one this phone is sending. A failed send does not. It sits in the outbox with Retry and Edit, and the card stays.
 */
export const answersWait = (queued: boolean, outbox: Pick<OutboxItem, 'phase'> | null): boolean => queued || outbox?.phase === 'sending';

/**
 * The one reply Send answers sends, or null while no item has an answer. Return on any answer field sends it, so the
 * focused field may be empty while another holds the answer, as Enter works on the web card.
 */
export const answersReply = (items: readonly OpenItem[], answers: OpenAnswers): string | null =>
  answersMessage(items, items.map((i) => answers[i.text]));

/** Why Send answers did not go: the outbox holds one message, and a failed one waits for its Retry or Edit. */
export const SLOT_TAKEN = 'A message that did not send is waiting above. Retry or edit it first.';

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
