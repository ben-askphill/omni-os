// PROTOTYPE, throwaway.
import type { ReactNode } from 'react';

export interface Variant {
  key: string;
  name: string;
  /** One line on what this variant tries, shown in the switcher's tooltip and the README. */
  idea: string;
  desktop: () => ReactNode;
  phone: () => ReactNode;
}

/** Where the screen sits in the desktop shell: which channel the rail selects and what the list panel shows. */
export type Place =
  | { kind: 'channel'; channel: string; hash: string }
  | { kind: 'settings'; hash: string }
  /** The screen draws the list panel itself (screen 5). */
  | { kind: 'own-list'; channel: string; hash: string };

export interface Screen {
  id: number;
  name: string;
  place: Place;
  /** Ben's pick (2026-11-20): the variant the page opens on. The others stay behind the switcher. */
  pick: string;
  /** A switch only this screen reads, shown in the bar. */
  toggle?: { key: string; label: string };
  variants: Variant[];
}
