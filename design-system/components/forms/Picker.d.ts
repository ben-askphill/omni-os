import type { ReactNode } from 'react';

/**
 * Dropdown picker (Bencho "pik", web/src ui.tsx). 32px surface-2 pill with a 24px avatar; opens a 22px-radius card
 * that pops with the settle spring, rows 40px with a checkbox mark. Searchable past 7 options. Keyboard ↑↓ ⏎ esc.
 * Used in the composer for target (crew role), channel, harness and model.
 * @startingPoint section="Forms" subtitle="Pill picker with popover card" viewport="700x380"
 */
export interface PickerOption {
  value: string;
  label: string;
  sub?: string;
  icon?: string;
  code?: string;
  /** Letter avatar seed; false hides the avatar */
  avatar?: string | false;
  /** Custom lead node (e.g. a CrewMark) */
  lead?: ReactNode;
}
export interface PickerProps {
  value: string;
  options?: PickerOption[];
  onChange?: (v: string) => void;
  label: string;
  prefix?: ReactNode;
  lead?: ReactNode;
  searchable?: boolean;
  disabled?: boolean;
  align?: 'left' | 'right';
  /** Force the card to open upwards */
  up?: boolean;
  className?: string;
}
export function Picker(props: PickerProps): JSX.Element;
