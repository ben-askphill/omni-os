// How the Web UI shows a diff_selection (packages/shared/message-context-diff.ts): which lines of which file, where
// they came from, and the rows as Ben saw them.
import type { DiffSelection } from '@omni/shared/message-context-diff.ts';
import { GROUP_TITLE, shortSha } from '../changes.ts';
import { LINE_CLASS } from '../components/DiffViewer.tsx';
import type { ContextView } from './views.ts';

const SIGN = { add: '+', del: '-', context: ' ' } as const;

/** "new lines 41–43", "removed line 12". */
export const rangeText = (b: Pick<DiffSelection, 'side' | 'start' | 'end'>) =>
  `${b.side === 'old' ? 'removed' : 'new'} ${b.start === b.end ? `line ${b.start}` : `lines ${b.start}–${b.end}`}`;

/** "Unstaged · HEAD 3f2a1c9 · blob a042389", or for a turn "Turn · 9f2c1e4→3f2a1c9". */
export function sourceText({ source: s, side }: Pick<DiffSelection, 'source' | 'side'>) {
  if (s.group === 'turn') return `Turn · ${shortSha(s.from)}→${shortSha(s.to)}`;
  const blob = side === 'old' ? s.blob_old : s.blob_new;
  return [GROUP_TITLE[s.group], `HEAD ${shortSha(s.to)}`, blob && `blob ${shortSha(blob)}`].filter(Boolean).join(' · ');
}

function DiffSelectionDetail({ body: b }: { body: DiffSelection }) {
  const where = b.old_path ? `${b.old_path} → ${b.path}` : b.path;
  return (
    <div className="min-w-0">
      <div className="truncate font-mono text-[12px] text-fg" title={where}>
        {where}
      </div>
      <div className="mt-0.5 text-[11.5px] text-fg-2">{rangeText(b)}</div>
      <div className="truncate font-mono text-[11px] text-fg-4">{sourceText(b)}</div>
      <div className="scroll-thin mt-2 max-h-64 overflow-auto rounded-xl bg-bg shadow-[inset_0_0_0_1px_var(--line)]">
        <pre className="min-w-max py-1 font-mono text-[11.5px] leading-[1.6]">
          {b.rows.map((r, i) => (
            <div key={i} className={`flex ${LINE_CLASS[r.kind]}`}>
              <span className="w-9 shrink-0 pr-2 text-right font-num text-fg-4 select-none" aria-hidden>
                {r.old ?? ''}
              </span>
              <span className="w-9 shrink-0 pr-2 text-right font-num text-fg-4 select-none" aria-hidden>
                {r.new ?? ''}
              </span>
              <span className="pr-3 pl-1">
                {SIGN[r.kind]}
                {r.text}
                {r.cut && <span className="text-fg-4">…</span>}
              </span>
            </div>
          ))}
        </pre>
      </div>
    </div>
  );
}

export const diffSelectionView: ContextView<DiffSelection> = { icon: 'diff', Detail: DiffSelectionDetail };
