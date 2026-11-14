import { useState } from 'react';
import { AUTO_MERGE_COPY } from '@omni/shared/pr-auto-merge.ts';
import type { PRDetail } from '../api.ts';
import { Button, ErrorNote, Icon, SlideToConfirm } from '../components/ui.tsx';
import { useAutoMerge } from '../pages/PRAutoMerge.tsx';
import { MoGroup, MoListRow } from './parts.tsx';

/**
 * The phone PR screen's auto-merge row. Off: a tap shows the same slide to confirm as a merge, with the repo's merge
 * method, so Ben can arm a PR and walk away. On: its method and who turned it on, and Turn off. gh's refusal shows under it.
 */
export function MoAutoMerge({ channelId, n, p, onChanged }: { channelId: string; n: number; p: PRDetail; onChanged: () => void }) {
  const a = useAutoMerge(channelId, n, p, onChanged);
  const [arming, setArming] = useState(false);
  const { on, title, detail, by } = a.view;
  const icon = <Icon name="zap" size={18} className={on ? 'text-live-text' : ''} />;
  return (
    <div className="flex flex-col gap-2">
      {arming && !on ? (
        <div className="flex flex-col gap-2">
          <SlideToConfirm
            label={AUTO_MERGE_COPY.slide}
            busyLabel={AUTO_MERGE_COPY.busy}
            doneLabel={AUTO_MERGE_COPY.done}
            onConfirm={async () => {
              await a.set(true);
              setArming(false);
            }}
          />
          <Button variant="ghost" onClick={() => setArming(false)}>
            Cancel
          </Button>
        </div>
      ) : (
        <MoGroup>
          <MoListRow
            icon={icon}
            label={title}
            sub={by ? `${detail}. ${by}.` : detail}
            wrapSub
            right={
              on ? (
                <Button size="sm" busy={a.busy} onClick={() => void a.set(false).catch(() => {})}>
                  {AUTO_MERGE_COPY.disarm}
                </Button>
              ) : undefined
            }
            onClick={on || p.isDraft ? undefined : () => setArming(true)}
            disabled={!on && p.isDraft}
            last
          />
        </MoGroup>
      )}
      {a.error && <ErrorNote>{a.error}</ErrorNote>}
    </div>
  );
}
