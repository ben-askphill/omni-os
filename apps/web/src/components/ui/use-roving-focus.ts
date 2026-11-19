// One Tab stop for a row of controls (tabs, a toolbar, a radio group), with the arrow keys, Home and End moving between
// them. A roving tabindex, since `focusgroup` is Chromium-only. The items are the elements marked ROVING_ITEM; anything
// else inside the row (a menu a toolbar button opened, a field) keeps its own keys.
import { useLayoutEffect, useRef, type FocusEvent, type KeyboardEvent } from 'react';

/** Spread on each item of the row. */
export const ROVING_ITEM = { 'data-roving-item': '' } as const;
const ITEMS = '[data-roving-item]';

export interface RovingOptions {
  /**
   * Where Tab into the row lands. `selected`: the selected tab or checked radio, so a selection made another way
   * (a click, a route) is where the keys start. `last`: the item last focused, as a toolbar does.
   */
  stop?: 'selected' | 'last';
  /** An arrow key also picks the item it lands on (clicks it): radios, and tabs whose panel is cheap to show. */
  activate?: boolean;
  /** Up and Down move too, as in a radio group. */
  vertical?: boolean;
}

const enabled = (el: HTMLElement) => !(el as HTMLButtonElement).disabled && el.getAttribute('aria-disabled') !== 'true';
const isSelected = (el: HTMLElement) => el.getAttribute('aria-selected') === 'true' || el.getAttribute('aria-checked') === 'true';

/** The row's items, in document order, skipping ones that cannot run. */
export function rovingItems(root: HTMLElement) {
  return [...root.querySelectorAll<HTMLElement>(ITEMS)].filter(enabled);
}

/** The index an arrow, Home or End moves to from `at`, wrapping at the ends; undefined for any other key. */
export function rovingStep(key: string, at: number, count: number, vertical = false): number | undefined {
  const next = key === 'ArrowRight' || (vertical && key === 'ArrowDown') ? at + 1 : key === 'ArrowLeft' || (vertical && key === 'ArrowUp') ? at - 1 : key === 'Home' ? 0 : key === 'End' ? count - 1 : undefined;
  return next === undefined || count === 0 ? undefined : (next + count) % count;
}

export function useRovingFocus<T extends HTMLElement = HTMLDivElement>({ stop = 'last', activate = false, vertical = false }: RovingOptions = {}) {
  const ref = useRef<T>(null);
  const last = useRef<HTMLElement | null>(null);

  const settle = () => {
    const root = ref.current;
    if (!root) return;
    const all = rovingItems(root);
    const remembered = last.current && all.includes(last.current) ? last.current : undefined;
    const pick = (stop === 'selected' ? all.find(isSelected) : remembered) ?? remembered ?? all.find(isSelected) ?? all[0];
    for (const el of root.querySelectorAll<HTMLElement>(ITEMS)) el.tabIndex = el === pick ? 0 : -1;
  };
  // Every render: the items, their selection and which can run all change with the props.
  useLayoutEffect(settle);

  const onFocus = (e: FocusEvent) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>(ITEMS);
    if (!el || !ref.current?.contains(el)) return;
    last.current = el;
    settle();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    const root = ref.current;
    const target = e.target as HTMLElement;
    if (!root || e.altKey || e.ctrlKey || e.metaKey || !target.matches(ITEMS)) return;
    const all = rovingItems(root);
    const next = rovingStep(e.key, all.indexOf(target), all.length, vertical);
    if (next === undefined || all.indexOf(target) < 0) return;
    e.preventDefault();
    e.stopPropagation();
    const el = all[next];
    el.focus();
    if (activate && !isSelected(el)) el.click();
  };

  return { ref, onFocus, onKeyDown };
}
