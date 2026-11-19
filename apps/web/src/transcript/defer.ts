/**
 * Which transcript rows may skip rendering while out of view (`.tx-row`, `content-visibility: auto` in index.css).
 * The newest rows never do: the live turn streams into them and the bottom pin measures them, so neither ever meets
 * a placeholder. Desktop counts rows (one item each), the phone counts turns.
 */
export const LIVE_ROWS = 12;
export const LIVE_TURNS = 2;

/** Whether row `i` of `n` may skip rendering while off screen. */
export const defers = (i: number, n: number, live: number): boolean => i < n - live;
