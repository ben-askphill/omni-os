/**
 * One spacing spec for the thread's side panels: the quick card beside the transcript and the cards in the Details tab.
 * Every value sits on the design system's --sp scale, so text and icons start --sp-8 in from a card's edge everywhere.
 */

/** A card's own padding, between its edge and its rows' hover wash. */
export const CARD_PAD = 'p-[var(--sp-2)]';
/** A row's side padding. With CARD_PAD, its content sits --sp-8 from the card edge. */
export const ROW_X = 'px-[var(--sp-6)]';
/** A full-bleed row (a key/value list without CARD_PAD) gets the whole --sp-8 itself. */
export const ROW_X_BLEED = 'px-[var(--sp-8)]';
/** A row's height and hover shape. */
export const ROW = `h-9 rounded-[var(--r-sm)] ${ROW_X}`;
/** A rule between two groups inside one card, with the same space on both sides. */
export const DIVIDER = 'mt-[var(--sp-2)] border-t border-line pt-[var(--sp-2)]';
/** A group's caption: one step more room above than below, so it reads with the rows under it. */
export const CAPTION = `${ROW_X} pt-[var(--sp-4)] pb-[var(--sp-2)]`;
