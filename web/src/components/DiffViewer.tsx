import { memo, useMemo, useState } from 'react';
import { Icon } from './ui.tsx';

interface FileDiff {
  path: string;
  header: string[];
  lines: string[];
  add: number;
  del: number;
  binary: boolean;
}

function parseDiff(src: string): FileDiff[] {
  const files: FileDiff[] = [];
  let cur: FileDiff | null = null;
  let inHunk = false;
  for (const line of src.split('\n')) {
    if (line.startsWith('diff --git ')) {
      const m = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
      cur = { path: m ? m[2] : line.slice(11), header: [line], lines: [], add: 0, del: 0, binary: false };
      files.push(cur);
      inHunk = false;
      continue;
    }
    if (!cur) {
      if (line.trim()) {
        cur = { path: '(diff)', header: [], lines: [], add: 0, del: 0, binary: false };
        files.push(cur);
      } else continue;
    }
    if (!inHunk && !line.startsWith('@@')) {
      if (line.startsWith('Binary files')) cur.binary = true;
      if (line.startsWith('rename to ')) cur.path = line.slice(10);
      cur.header.push(line);
      continue;
    }
    inHunk = true;
    cur.lines.push(line);
    if (line.startsWith('+')) cur.add++;
    else if (line.startsWith('-')) cur.del++;
  }
  return files;
}

const MAX_LINES = 1500;

const FileBlock = memo(function FileBlock({ f, defaultOpen }: { f: FileDiff; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const [all, setAll] = useState(false);
  const shown = all ? f.lines : f.lines.slice(0, MAX_LINES);
  return (
    <div className="overflow-hidden rounded-[18px] shadow-[inset_0_0_0_1px_var(--line)]">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="sticky top-0 z-[1] flex h-10 w-full min-w-0 items-center gap-2 bg-surface px-3.5 text-left text-[12.5px] transition-colors hover:bg-surface-2"
      >
        <Icon name="chevronRight" size={12} className={`text-fg-3 transition-transform duration-300 [transition-timing-function:var(--ease-settle)] ${open ? 'rotate-90' : ''}`} />
        <span className="min-w-0 flex-1 truncate font-mono text-[12px]">{f.path}</span>
        <span className="shrink-0 font-num text-[11px] text-ok">+{f.add}</span>
        <span className="shrink-0 font-num text-[11px] text-bad">-{f.del}</span>
      </button>
      {open && (
        <div className="scroll-thin overflow-x-auto bg-bg">
          {f.binary && <div className="px-3 py-2 text-[12px] text-fg-3">Binary file</div>}
          <pre className="min-w-max font-mono text-[11.5px] leading-[1.6]">
            {shown.map((l, i) => {
              const cls = l.startsWith('@@')
                ? 'bg-info-bg text-info'
                : l.startsWith('+')
                  ? 'bg-[var(--diff-add)]'
                  : l.startsWith('-')
                    ? 'bg-[var(--diff-del)]'
                    : l.startsWith('\\')
                      ? 'text-fg-4'
                      : 'text-fg-2';
              return (
                <div key={i} className={`px-3 ${cls}`}>
                  {l || ' '}
                </div>
              );
            })}
          </pre>
          {!all && f.lines.length > MAX_LINES && (
            <button type="button" onClick={() => setAll(true)} className="h-9 w-full border-t border-line text-[12px] font-medium text-fg-3 transition-colors hover:bg-surface hover:text-fg">
              Show {f.lines.length - MAX_LINES} more lines
            </button>
          )}
        </div>
      )}
    </div>
  );
});

export function DiffViewer({ diff }: { diff: string }) {
  const files = useMemo(() => parseDiff(diff), [diff]);
  if (!diff.trim()) return <div className="text-[13px] text-fg-3">No diff.</div>;
  if (!files.length) return <pre className="font-mono text-[12px] whitespace-pre-wrap">{diff}</pre>;
  const big = files.length > 12;
  return (
    <div className="space-y-2">
      {files.map((f, i) => (
        <FileBlock key={`${f.path}-${i}`} f={f} defaultOpen={!big || f.add + f.del < 200} />
      ))}
    </div>
  );
}
