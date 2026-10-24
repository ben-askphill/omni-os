// The diff_selection kind as harness text (project.ts): the rows Ben picked as a diff, and whether the file in the
// checkout still has them where he picked them.
import type { DiffRow, DiffSelection } from '@omni/shared/message-context-diff.ts';
import type { FileRead, Projection, Projector } from './project.ts';

const GROUP: Record<DiffSelection['source']['group'], string> = {
  committed: 'committed',
  staged: 'staged',
  unstaged: 'unstaged',
  untracked: 'untracked',
  turn: 'from one turn',
};
const MARK: Record<DiffRow['kind'], string> = { add: '+', del: '-', context: ' ' };
const NOT_CHECKED: Record<Exclude<Extract<FileRead, { ok: false }>['why'], 'missing'>, string> = {
  too_large: 'the file is over 1 MB',
  binary: 'the file is binary',
  outside: 'the path leads outside the working directory',
};

const lines = (a: number, b: number) => (a === b ? `line ${a}` : `lines ${a}-${b}`);

/**
 * Whether the checkout still has the selected new-side lines: where they were, moved (the first match nearest
 * where they were), or not at all. A cut row matches a line that starts with it. Removed lines alone are not checked:
 * the file has nothing left to compare them with.
 */
export function freshness(b: DiffSelection, file: FileRead): Projection['check'] {
  if (b.side === 'old') return undefined;
  if (!file.ok) return file.why === 'missing' ? { stale: true, text: 'the file is gone' } : { stale: false, text: `not checked: ${NOT_CHECKED[file.why]}` };
  const have = file.text.split('\n').map((l) => l.replace(/\r$/, ''));
  if (file.text.endsWith('\n')) have.pop();
  // Parse keeps a side's numbers contiguous, so these are lines start..end.
  const want = b.rows.filter((r) => r.new !== null);
  const at = (i: number) => want.every((r, k) => i + k < have.length && (r.cut ? have[i + k].startsWith(r.text) : have[i + k] === r.text));
  const from = b.start - 1;
  if (at(from)) return { stale: false, text: 'current' };
  let best = -1;
  for (let i = 0; i + want.length <= have.length; i++) if (at(i) && (best < 0 || Math.abs(i - from) < Math.abs(best - from))) best = i;
  if (best >= 0) return { stale: false, text: `moved to ${lines(best + 1, best + want.length)}` };
  return { stale: true, text: 'these lines changed since they were selected; read the file before acting' };
}

export const projectDiffSelection: Projector<DiffSelection> = (b, read) => ({
  title: `Diff selection in ${b.path}${b.old_path ? ` (was ${b.old_path})` : ''}, ${b.side} ${lines(b.start, b.end)} (${GROUP[b.source.group]})`,
  file: b.path,
  ...(read && { check: freshness(b, read(b.path)) }),
  excerpt: { lang: 'diff', text: b.rows.map((r) => `${MARK[r.kind]}${r.text}${r.cut ? ' (cut)' : ''}`).join('\n') },
});
