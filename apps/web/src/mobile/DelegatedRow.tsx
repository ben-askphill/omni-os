// A Conductor thread's row on the phone with its DelegateCount, the phone's copy of the sidebar's: the threads it
// delegated get no row of their own. Tapping the count opens the thread's Details screen, which lists them first.
import type { ThreadStub } from '../api.ts';
import { DelegateCount, DelegateCountSpace, delegatesHref, useDelegateSummary } from '../components/DelegateCount.tsx';
import { MoRow } from './parts.tsx';
import type { RowItem } from './rows.ts';
import { useShell } from './shell.tsx';

export function MoDelegatedRow({
  it,
  delegated,
  last,
  onOpen,
}: {
  it: RowItem;
  delegated: readonly ThreadStub[] | undefined;
  last?: boolean;
  onOpen: () => void;
}) {
  const shell = useShell();
  const summary = useDelegateSummary(delegated);
  if (!summary) return <MoRow it={it} last={last} onOpen={onOpen} />;
  return (
    <div className="relative">
      <MoRow it={it} last={last} onOpen={onOpen} trailing={<DelegateCountSpace summary={summary} size={13} />} />
      <DelegateCount summary={summary} size={13} onOpen={() => shell.open(delegatesHref(it.id))} className="absolute right-0 bottom-2.5" />
    </div>
  );
}
