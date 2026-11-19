// The thread's find bar (useThreadFind): a field, the count, previous and next, and close. It floats over the top of
// the transcript, so the rows keep their place. Enter steps to the next match, Shift+Enter to the one before, Esc
// closes it from anywhere on the page (one layer on the dismiss stack) and takes the highlights off.
import { useId, useLayoutEffect, useRef } from 'react';
import { isImeEnter } from '../../ime.ts';
import type { ThreadFind } from '../../pages/useThreadFind.ts';
import { useDismissLayer } from '../ui/dismiss-stack.ts';
import { Icon, Loader, type IconName } from '../ui.tsx';

/** IconButton's look, at the phone's 44px when `touch`. */
function FindButton({ icon, label, onClick, disabled, flip, touch }: { icon: IconName; label: string; onClick: () => void; disabled?: boolean; flip?: boolean; touch: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={`hov press inline-flex ${touch ? 'h-11 w-11' : 'h-8 w-8'} shrink-0 items-center justify-center rounded-full text-fg-3 transition-colors hover:text-fg disabled:opacity-40`}
    >
      <Icon name={icon} size={16} className={flip ? 'rotate-180' : undefined} />
    </button>
  );
}

/** `touch`: the phone layout's bar, 48px tall with 44px buttons. */
export function FindBar({ find, touch = false, className = '' }: { find: ThreadFind; touch?: boolean; className?: string }) {
  const root = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const countId = useId();
  useDismissLayer(find.open, { roots: () => [root.current], escape: () => find.close() });
  useLayoutEffect(() => {
    if (!find.open) return;
    field.current?.focus();
    field.current?.select();
  }, [find.open, find.focusSeq]);
  if (!find.open) return null;
  const none = find.count !== null && find.total === 0;
  return (
    <div ref={root} role="search" aria-label="Find in thread" className={`float pop-in flex ${touch ? 'h-12 gap-0.5 pr-0.5' : 'h-10 gap-1 pr-1'} items-center rounded-full pl-3.5 ${className}`}>
      <Icon name="search" size={15} className="text-fg-3" />
      <input
        ref={field}
        type="text"
        value={find.query}
        onChange={(e) => find.setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== 'Enter' || isImeEnter(e)) return;
          e.preventDefault();
          if (e.shiftKey) find.prev();
          else find.next();
        }}
        placeholder="Find in thread"
        aria-label="Find in thread"
        aria-describedby={countId}
        aria-invalid={none || undefined}
        enterKeyHint="search"
        autoComplete="off"
        spellCheck={false}
        className="field-sm h-full w-40 min-w-0 flex-1 bg-transparent text-fg outline-none placeholder:text-fg-3 sm:w-52"
      />
      <span id={countId} aria-live="polite" className={`min-w-14 shrink-0 text-right font-num text-[11.5px] tabular-nums ${none || find.error ? 'text-fg' : 'text-fg-3'}`}>
        {find.error ?? (find.count === null && find.busy ? <Loader size={11} /> : find.count)}
      </span>
      <span aria-hidden className="mx-1 h-4 w-px shrink-0 bg-line-strong" />
      <FindButton icon="chevronDown" flip label={touch ? 'Previous match' : 'Previous match (Shift+Enter)'} disabled={!find.total} onClick={find.prev} touch={touch} />
      <FindButton icon="chevronDown" label={touch ? 'Next match' : 'Next match (Enter)'} disabled={!find.total} onClick={find.next} touch={touch} />
      <FindButton icon="x" label={touch ? 'Close find' : 'Close find (Esc)'} onClick={find.close} touch={touch} />
    </div>
  );
}
