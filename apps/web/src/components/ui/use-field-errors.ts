import { useCallback, useEffect, useRef, useState, type FocusEvent } from 'react';

/** A form's problems by the id of the field each belongs to, in the order the fields sit in. Null or '' for none. */
export type FieldProblems = Record<string, string | null | undefined>;

// Whether a mouse button or a finger is down. A field blurs on pointerdown, before the click: a message that appeared
// then would move what was being clicked (Submit, often) out from under the pointer, and the click would be lost.
let pressing = false;
let watching = false;
function watchPointer() {
  if (watching || typeof window === 'undefined') return;
  watching = true;
  window.addEventListener('pointerdown', () => (pressing = true), true);
  for (const end of ['pointerup', 'pointercancel'] as const) window.addEventListener(end, () => (pressing = false), true);
}

/** Runs `show` now, or, while a press is under way, once its click has landed. */
function afterPress(show: () => void) {
  if (!pressing) return show();
  window.addEventListener('pointerup', () => setTimeout(show), { capture: true, once: true });
}

/**
 * When each field's problem shows. Not while typing: once the field is left with something in it, or once the form is
 * submitted. A shown problem follows the value from then on, so it goes away the moment the field is fixed. `error(id)`
 * feeds the Label or Row error slot and `invalid(id)` the control's aria-invalid, so the field is marked invalid exactly
 * when its message and its red edge show (`.field[aria-invalid="true"]` in index.css).
 */
export function useFieldErrors(problems: FieldProblems) {
  useEffect(watchPointer, []);
  const [touched, setTouched] = useState<ReadonlySet<string>>(() => new Set());
  const [submitted, setSubmitted] = useState(false);
  // The field a submit sends focus to, once the render that shows its message (and opens a fold around it) is in.
  const focusNext = useRef<string | null>(null);
  const [round, setRound] = useState(0);
  useEffect(() => {
    const id = focusNext.current;
    focusNext.current = null;
    if (id) document.getElementById(id)?.focus();
  }, [round]);
  const shown = (id: string) => submitted || touched.has(id);
  const touch = useCallback((id: string) => setTouched((cur) => (cur.has(id) ? cur : new Set(cur).add(id))), []);

  const error = (id: string) => (shown(id) && problems[id]) || undefined;
  return {
    error,
    invalid: (id: string) => (error(id) ? true : undefined),
    /** Shows a field's problem, as autosave does when a field it could not save is left (after a click under way). */
    touch: (id: string) => afterPress(() => touch(id)),
    /** For the field's onBlur: a field left empty waits for the submit, so tabbing through stays quiet. */
    onBlur: (e: FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const { id, value } = e.currentTarget;
      if (value) afterPress(() => touch(id));
    },
    /**
     * On submit: shows every problem and, after that render, moves focus to the first field that has one. Null when
     * there is none. A field the page does not show takes no focus, so its caller shows the message in the form.
     */
    submit: (): { id: string; message: string } | null => {
      setSubmitted(true);
      const first = Object.entries(problems).find(([, p]) => p);
      if (!first) return null;
      focusNext.current = first[0];
      setRound((n) => n + 1);
      return { id: first[0], message: first[1]! };
    },
    /** After a save, or when the form starts over: nothing shows until the next blur or submit. */
    reset: () => {
      setTouched(new Set());
      setSubmitted(false);
    },
  };
}
