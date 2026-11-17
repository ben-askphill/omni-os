import { useState } from 'react';
import { AUTO_MERGE_COPY, autoMergeView } from '@omni/shared/pr-auto-merge.ts';
import { api, errorText, type PRDetail } from '../api.ts';
import { Button, ErrorNote, Icon } from '../components/ui.tsx';

type MergeMethod = 'squash' | 'merge' | 'rebase';

/**
 * Auto-merge for one PR: its state as the PR view read it, and turning it on or off. `set` throws on a refusal (a repo
 * with auto-merge off) so a slider springs back; the error keeps gh's words. `onChanged` reloads the PR.
 */
export function useAutoMerge(channelId: string | undefined, n: number | undefined, p: Pick<PRDetail, 'autoMergeRequest'>, onChanged: () => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = async (enabled: boolean, method?: MergeMethod) => {
    if (!channelId || !n) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/channels/${encodeURIComponent(channelId)}/prs/${n}/auto-merge`, enabled ? { enabled, method, confirm: true } : { enabled });
      onChanged();
    } catch (e) {
      setError(errorText(e));
      throw e;
    } finally {
      setBusy(false);
    }
  };
  return { view: autoMergeView(p.autoMergeRequest), busy, error, set };
}

/**
 * Auto-merge on the desktop merge card's control row: a button that turns it on with `method`, or, while it is on, a
 * live mark and a button that turns it off. The card's note says what it does and who turned it on. gh's refusal shows
 * under the row.
 */
export function PRAutoMerge({ channelId, n, p, method, onChanged, className = '' }: { channelId: string; n: number; p: PRDetail; method: MergeMethod; onChanged: () => void; className?: string }) {
  const a = useAutoMerge(channelId, n, p, onChanged);
  const { on, title, detail, by } = a.view;
  const says = by ? `${detail}. ${by}.` : `${detail}.`;
  return (
    <div aria-label="Auto-merge" role="group" className={`flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 ${className}`}>
      {on && (
        <span className="inline-flex min-w-0 items-center gap-1.5 text-[length:var(--fs-ui)] font-medium text-live-text" title={says}>
          <Icon name="zap" size={14} className="shrink-0" />
          {title}
        </span>
      )}
      <Button size="sm" variant={on ? 'ghost' : 'secondary'} icon={on ? undefined : 'zap'} busy={a.busy} disabled={p.isDraft && !on} title={says} onClick={() => void a.set(!on, method).catch(() => {})}>
        {on ? AUTO_MERGE_COPY.disarm : AUTO_MERGE_COPY.arm}
      </Button>
      {a.error && <ErrorNote className="basis-full">{a.error}</ErrorNote>}
    </div>
  );
}
