import { memo, useMemo, useState, type ReactNode } from 'react';
import { MAX_LINES, parseDiff, startsOpen, type DiffLine, type FileDiff } from '../diff.ts';
import { Icon } from './ui.tsx';

export const LINE_CLASS: Record<DiffLine['kind'], string> = {
  hunk: 'bg-surface text-fg-3',
  add: 'bg-[var(--diff-add)]',
  del: 'bg-[var(--diff-del)]',
  note: 'text-fg-4',
  context: 'text-fg-2',
};

/** Lines Ben can pick to send to the agent (components/thread/panel/LineSelection.tsx). */
export interface LineSelect {
  /** The picked lines as indexes into the file's lines, `to` maybe above `from`. Null when none are in this file. */
  range: { from: number; to: number } | null;
  press(i: number, extend: boolean): void;
}

// The numbers go a step darker: fg-4 on the mark tint is too faint in dark mode.
const PICKED = ' bg-[image:linear-gradient(var(--mark),var(--mark))] shadow-[inset_2px_0_0_var(--fg-3)] [&_[aria-hidden]]:text-fg-2';
const pickable = (l: DiffLine) => l.kind === 'add' || l.kind === 'del' || l.kind === 'context';

/**
 * One file of a diff: a header that opens and closes it, then its numbered lines. The PR page and a thread's
 * Changes panel both use it. `label` replaces the path in the header, `badge` sits before it, and `notice` says why
 * there are no lines (binary, too large). With `select`, a line's numbers pick it (shift extends); on a touch screen
 * the whole line does, and a tap in the same hunk extends.
 */
export const DiffFile = memo(function DiffFile({
  file,
  defaultOpen,
  label,
  badge,
  notice,
  select,
}: {
  file: FileDiff;
  defaultOpen: boolean;
  label?: ReactNode;
  badge?: ReactNode;
  notice?: string | null;
  select?: LineSelect;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [all, setAll] = useState(false);
  const shown = all ? file.lines : file.lines.slice(0, MAX_LINES);
  const numbered = file.lines.some((l) => l.old !== null || l.new !== null);
  const range = select?.range;
  const [lo, hi] = range ? [Math.min(range.from, range.to), Math.max(range.from, range.to)] : [-1, -1];
  const rowTap = !!select && (!numbered || (typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches));
  return (
    <div className="overflow-hidden rounded-[18px] shadow-[inset_0_0_0_1px_var(--line)]">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="sticky top-0 z-[1] flex h-10 w-full min-w-0 items-center gap-2 bg-surface px-3.5 text-left text-[12.5px] transition-colors hover:bg-surface-2"
      >
        <Icon name="chevronRight" size={12} className={`text-fg-3 transition-transform duration-300 [transition-timing-function:var(--ease-settle)] ${open ? 'rotate-90' : ''}`} />
        {badge}
        <span className="min-w-0 flex-1 truncate font-mono text-[12px]">{label ?? file.path}</span>
        <span className="shrink-0 font-num text-[11px] text-fg-2">+{file.add}</span>
        <span className="shrink-0 font-num text-[11px] text-fg-3">-{file.del}</span>
      </button>
      {open && (
        <div className="scroll-thin overflow-x-auto bg-bg">
          {(notice || (file.binary && notice === undefined)) && <div className="px-3 py-2 text-[12px] text-fg-3">{notice ?? 'Binary file'}</div>}
          {shown.length > 0 && (
            <pre className="min-w-max font-mono text-[11.5px] leading-[1.6]">
              {shown.map((l, i) => {
                const gutters = numbered && (
                  <>
                    <span className="w-10 shrink-0 pr-2 text-right font-num text-fg-4 select-none" aria-hidden>
                      {l.old ?? ''}
                    </span>
                    <span className="w-10 shrink-0 pr-2 text-right font-num text-fg-4 select-none" aria-hidden>
                      {l.new ?? ''}
                    </span>
                  </>
                );
                const text = <span className={numbered ? 'pr-3 pl-1' : 'px-3'}>{l.text || ' '}</span>;
                if (!select || !pickable(l)) {
                  return (
                    <div key={i} className={`flex ${LINE_CLASS[l.kind]}`}>
                      {gutters}
                      {text}
                    </div>
                  );
                }
                const picked = lo <= i && i <= hi;
                return (
                  <div
                    key={i}
                    data-picked={picked || undefined}
                    onClick={rowTap ? () => select.press(i, true) : undefined}
                    className={`flex ${LINE_CLASS[l.kind]}${picked ? PICKED : ''}`}
                  >
                    {numbered && (
                      // On a touch screen the line's own tap handler picks; the button is there for keyboards and screen readers.
                      <button
                        type="button"
                        aria-pressed={picked}
                        aria-label={l.kind === 'del' ? `Select removed line ${l.old}` : `Select line ${l.new}`}
                        onClick={
                          rowTap
                            ? undefined
                            : (e) => {
                                // Safari does not focus a clicked button; Esc in the panel needs the focus there.
                                e.currentTarget.focus();
                                select.press(i, e.shiftKey);
                              }
                        }
                        className="hov flex shrink-0"
                      >
                        {gutters}
                      </button>
                    )}
                    {text}
                  </div>
                );
              })}
            </pre>
          )}
          {!all && file.lines.length > MAX_LINES && (
            <button type="button" onClick={() => setAll(true)} className="h-9 w-full border-t border-line text-[12px] font-medium text-fg-3 transition-colors hover:bg-surface hover:text-fg">
              Show {file.lines.length - MAX_LINES} more lines
            </button>
          )}
        </div>
      )}
    </div>
  );
});

/** A whole unified diff, file by file, as `gh pr diff` prints it. */
export function DiffViewer({ diff }: { diff: string }) {
  const files = useMemo(() => parseDiff(diff), [diff]);
  if (!diff.trim()) return <div className="text-[13px] text-fg-3">No diff.</div>;
  if (!files.length) return <pre className="font-mono text-[12px] whitespace-pre-wrap">{diff}</pre>;
  return (
    <div className="space-y-2">
      {files.map((f, i) => (
        <DiffFile key={`${f.path}-${i}`} file={f} defaultOpen={startsOpen(f, files.length)} />
      ))}
    </div>
  );
}
