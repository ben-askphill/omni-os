import { memo, useMemo, useState, type ReactNode } from 'react';
import { MAX_LINES, parseDiff, startsOpen, type DiffLine, type FileDiff } from '../diff.ts';
import { Icon } from './ui.tsx';

const LINE_CLASS: Record<DiffLine['kind'], string> = {
  hunk: 'bg-surface text-fg-3',
  add: 'bg-[var(--diff-add)]',
  del: 'bg-[var(--diff-del)]',
  note: 'text-fg-4',
  context: 'text-fg-2',
};

/**
 * One file of a diff: a header that opens and closes it, then its numbered lines. The PR page and a thread's
 * Changes panel both use it. `label` replaces the path in the header, `badge` sits before it, and `notice` says why
 * there are no lines (binary, too large).
 */
export const DiffFile = memo(function DiffFile({
  file,
  defaultOpen,
  label,
  badge,
  notice,
}: {
  file: FileDiff;
  defaultOpen: boolean;
  label?: ReactNode;
  badge?: ReactNode;
  notice?: string | null;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [all, setAll] = useState(false);
  const shown = all ? file.lines : file.lines.slice(0, MAX_LINES);
  const numbered = file.lines.some((l) => l.old !== null || l.new !== null);
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
              {shown.map((l, i) => (
                <div key={i} className={`flex ${LINE_CLASS[l.kind]}`}>
                  {numbered && (
                    <>
                      <span className="w-10 shrink-0 pr-2 text-right font-num text-fg-4 select-none" aria-hidden>
                        {l.old ?? ''}
                      </span>
                      <span className="w-10 shrink-0 pr-2 text-right font-num text-fg-4 select-none" aria-hidden>
                        {l.new ?? ''}
                      </span>
                    </>
                  )}
                  <span className={numbered ? 'pr-3 pl-1' : 'px-3'}>{l.text || ' '}</span>
                </div>
              ))}
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
