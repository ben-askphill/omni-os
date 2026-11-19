import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { isImeEnter } from '../../ime.ts';

/**
 * The cursor of a dropdown listbox (the shared Picker, ModelPicker). Focus stays on the search field (a combobox) or on
 * the listbox itself, and `aria-activedescendant` names the option under the cursor, so a screen reader reads each
 * option as the arrow keys reach it.
 *
 * `keyed`: the cursor last moved by key, so the row draws the focus ring; a pointer moves it with the hover wash only.
 */
export function useListbox(count: number, open: boolean) {
  const listId = `${useId()}-list`;
  const [cursor, setCursor] = useState(0);
  const [keyed, setKeyed] = useState(false);
  const at = count ? Math.min(Math.max(cursor, 0), count - 1) : -1;
  const scroller = useRef<HTMLDivElement>(null);

  const optionId = (i: number) => `${listId}-${i}`;

  // As the list opens, and as the cursor moves.
  useEffect(() => {
    if (!open || at < 0) return;
    keepInView(scroller.current, document.getElementById(`${listId}-${at}`));
  }, [open, at, listId]);

  /** Arrow keys, Home and End (`homeEnd`, off in a search field, where they move the caret), Enter, Escape and Tab. */
  const onKeyDown = (
    e: ReactKeyboardEvent,
    {
      onPick,
      onClose,
      homeEnd = false,
      space = false,
    }: {
      onPick: (i: number) => void;
      /** `refocus`: put the focus back on the trigger, for Escape; Tab lets it move on. */
      onClose: (refocus: boolean) => void;
      homeEnd?: boolean;
      /** Space picks too, as in a listbox with no search field. */
      space?: boolean;
    },
  ) => {
    const move = (i: number) => {
      e.preventDefault();
      setKeyed(true);
      if (count) setCursor(Math.min(Math.max(i, 0), count - 1));
    };
    if (e.key === 'ArrowDown') move(at + 1);
    else if (e.key === 'ArrowUp') move(at - 1);
    else if (homeEnd && e.key === 'Home') move(0);
    else if (homeEnd && e.key === 'End') move(count - 1);
    else if ((e.key === 'Enter' && !isImeEnter(e)) || (space && e.key === ' ')) {
      e.preventDefault();
      if (at >= 0) onPick(at);
    } else if (e.key === 'Escape') {
      // Only this layer: a modal around the picker stays open.
      e.preventDefault();
      e.stopPropagation();
      onClose(true);
    } else if (e.key === 'Tab') onClose(false);
  };

  return {
    listId,
    optionId,
    cursor: at,
    keyed,
    /** The scrolling box around the options, kept scrolled to the cursor. */
    scroller,
    /** Put the cursor on an option, as the list opens or a search changes it. */
    reset: (i: number, byKey = false) => {
      setCursor(i);
      setKeyed(byKey);
    },
    /** A pointer over an option. */
    hover: (i: number) => {
      if (i === at && !keyed) return;
      setCursor(i);
      setKeyed(false);
    },
    onKeyDown,
  };
}

/** Scroll `box` the least that shows `el`, past a sticky header by the option's `scroll-margin-top`. */
function keepInView(box: HTMLElement | null, el: HTMLElement | null) {
  if (!box || !el) return;
  const b = box.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  const margin = parseFloat(getComputedStyle(el).scrollMarginTop) || 0;
  if (r.top - margin < b.top) box.scrollTop -= b.top - (r.top - margin);
  else if (r.bottom > b.bottom) box.scrollTop += r.bottom - b.bottom;
}
