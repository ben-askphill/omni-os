/**
 * Where the thread's quick card sits. The thread's main column is a size container (`@container/thread`), so the card
 * docks by the thread's own width, not the window's: from 48rem (768px) it takes a 288px column beside the transcript,
 * leaving the transcript at least 480px. Narrower, in a half-screen window or beside an open inspector, it floats over
 * the transcript's top right corner instead of squeezing it to a strip.
 */
export const THREAD_COLUMN = '@container/thread flex min-w-0 flex-1 flex-col';

export const QUICK_CARD_SLOT =
  'absolute top-2 right-2 z-20 flex max-h-[calc(100%-1rem)] w-[17rem] max-w-[calc(100%-1rem)] flex-col gap-[var(--sp-4)] overflow-y-auto ' +
  '@3xl/thread:static @3xl/thread:max-h-full @3xl/thread:w-72 @3xl/thread:max-w-none @3xl/thread:shrink-0 @3xl/thread:pt-2 @3xl/thread:pr-3 @3xl/thread:pb-2 @3xl/thread:pl-1';

/** The composer keeps clear of the docked card's column, so it centres under the transcript. */
export const COMPOSER_CLEARS_CARD = '@3xl/thread:pr-[19.5rem]';
