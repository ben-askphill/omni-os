import { useEffect, useId, useLayoutEffect, useRef, useState, type ChangeEvent, type FocusEvent as ReactFocusEvent, type KeyboardEvent as ReactKeyboardEvent, type RefObject, type SyntheticEvent } from 'react';
import { api } from '../api.ts';
import { fileQuery, pickFile, type FileMention } from '../../../shared/mention-menu.ts';
import { Icon } from './ui.tsx';

const optionId = (menuId: string, i: number) => `${menuId}-${i}`;

/**
 * The `@` menu over a composer's textarea: the files a message can name, from this thread's
 * artifacts and the repo it works in. `scope` is `thread=<id>` or `channel=<id>`. It only reads the
 * caret and keys; the composer's own handlers keep the text and the `/` menu.
 */
export function useFileMenu({
  ref,
  text,
  onText,
  scope,
}: {
  ref: RefObject<HTMLTextAreaElement | null>;
  text: string;
  onText: (text: string) => void;
  scope: string;
}) {
  const menuId = useId();
  const [caret, setCaret] = useState(0);
  const [focused, setFocused] = useState(false);
  // Esc closes the menu for this mention until the text changes.
  const [dismissed, setDismissed] = useState<string | null>(null);
  const at = focused ? fileQuery(text, caret) : null;
  const here = at && `${at.start}\0${text}`;
  const query = at?.query ?? null;

  // The rows with the search they answer, so a slower reply for an older search never shows.
  const [got, setGot] = useState<{ key: string; rows: FileMention[] } | null>(null);
  useEffect(() => {
    if (query === null) return;
    const key = `${scope}\0${query}`;
    let stale = false;
    const t = setTimeout(
      () => {
        api
          .get<FileMention[]>(`/mentions?${scope}&q=${encodeURIComponent(query)}`)
          .then((rows) => !stale && setGot({ key, rows }))
          .catch(() => !stale && setGot({ key, rows: [] }));
      },
      got ? 90 : 0,
    );
    return () => {
      stale = true;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, query]);
  // Until the search for the new text answers, the last rows stay (so typing doesn't flicker the menu).
  const rows = got?.rows ?? [];
  const open = !!here && dismissed !== here && rows.length > 0;

  const [nav, setNav] = useState<{ key: string; row: string | null }>({ key: '', row: null });
  const navKey = `${at?.start}\0${at?.query}`;
  const active = Math.max(nav.key === navKey ? rows.findIndex((r) => r.insert === nav.row) : 0, 0);
  const moveTo = (i: number) => setNav({ key: navKey, row: rows[i]?.insert ?? null });
  const [picked, setPicked] = useState<{ caret: number } | null>(null);
  useLayoutEffect(() => {
    if (picked) ref.current?.setSelectionRange(picked.caret, picked.caret);
  }, [picked, ref]);

  const pick = (r: FileMention) => {
    if (!at) return;
    const next = pickFile(text, at, r.insert);
    onText(next.text);
    setCaret(next.caret);
    setPicked({ caret: next.caret });
  };

  /** Arrow keys, Enter, Tab and Esc drive the menu while it is open. True when the key was used. */
  const onKey = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (!open || e.nativeEvent.isComposing || e.keyCode === 229) return false;
    const n = rows.length;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      moveTo((active + (e.key === 'ArrowDown' ? 1 : -1) + n) % n);
    } else if ((e.key === 'Enter' && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) || (e.key === 'Tab' && !e.shiftKey)) {
      pick(rows[active]);
    } else if (e.key === 'Escape') {
      setDismissed(here);
    } else {
      return false;
    }
    e.preventDefault();
    return true;
  };

  const textarea = {
    onChange: (e: ChangeEvent<HTMLTextAreaElement>) => {
      setCaret(e.target.selectionStart);
      if (!fileQuery(e.target.value, e.target.selectionStart)) setDismissed(null);
    },
    onSelect: (e: SyntheticEvent<HTMLTextAreaElement>) => setCaret(e.currentTarget.selectionStart),
    onFocus: (e: ReactFocusEvent<HTMLTextAreaElement>) => {
      setFocused(true);
      setCaret(e.currentTarget.selectionStart);
    },
    onBlur: () => setFocused(false),
    aria: {
      'aria-autocomplete': 'list' as const,
      'aria-controls': open ? menuId : undefined,
      'aria-activedescendant': open ? optionId(menuId, active) : undefined,
    },
  };

  const menu = open ? { id: menuId, rows, active, onActive: moveTo, onPick: pick } : null;
  return { open, menu, onKey, textarea };
}

/** The `@` menu above a composer, or `below` one near the top of the page. Focus stays in the composer. */
export function FileMenu({
  id,
  rows,
  active,
  onActive,
  onPick,
  below,
}: {
  id: string;
  rows: FileMention[];
  active: number;
  onActive: (i: number) => void;
  onPick: (r: FileMention) => void;
  below?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active, rows]);
  return (
    <div
      ref={ref}
      id={id}
      role="listbox"
      aria-label="Files"
      // Keep focus (and the phone keyboard) in the composer.
      onMouseDown={(e) => e.preventDefault()}
      className={`fade-in scroll-thin absolute inset-x-0 z-20 max-h-[min(22rem,45vh)] overflow-y-auto rounded-[22px] bg-elev p-1.5 shadow-[var(--shadow-menu)] ${below ? 'top-full mt-2' : 'bottom-full mb-2'}`}
    >
      {rows.map((r, k) => (
        <div
          key={r.insert}
          id={optionId(id, k)}
          role="option"
          aria-selected={k === active}
          data-active={k === active || undefined}
          onMouseMove={() => k !== active && onActive(k)}
          onClick={() => onPick(r)}
          className="flex min-h-10 cursor-pointer items-center gap-2.5 rounded-2xl px-3 py-1.5 data-[active]:bg-[var(--wash)]"
        >
          <Icon name="file" size={14} className="shrink-0 text-fg-3" />
          <span className="flex min-w-0 flex-1 items-baseline gap-2">
            <span className="shrink-0 text-[13px] font-medium text-fg">{r.name}</span>
            <span className="truncate text-[11.5px] text-fg-4">{r.detail}</span>
          </span>
          {r.kind === 'artifact' && <span className="shrink-0 rounded-full bg-surface-2 px-2 py-px text-[11px] text-fg-3">artifact</span>}
        </div>
      ))}
    </div>
  );
}
