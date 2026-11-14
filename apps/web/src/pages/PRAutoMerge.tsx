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

/** The auto-merge row under the desktop merge card: on with its method, or a button that turns it on with `method`. */
export function PRAutoMerge({ channelId, n, p, method, onChanged }: { channelId: string; n: number; p: PRDetail; method: MergeMethod; onChanged: () => void }) {
  const a = useAutoMerge(channelId, n, p, onChanged);
  const { on, title, detail, by } = a.view;
  return (
    <div aria-label="Auto-merge" role="group" className="mt-4 border-t border-line pt-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Icon name="zap" size={16} className={`shrink-0 ${on ? 'text-live-text' : 'text-fg-3'}`} />
        <div className="min-w-0 flex-1">
          <div className="text-[length:var(--fs-ui)] font-medium text-fg">{title}</div>
          <div className="text-[length:var(--fs-small)] leading-[1.5] text-fg-3">{by ? `${detail}. ${by}.` : `${detail}.`}</div>
        </div>
        <Button size="sm" busy={a.busy} disabled={p.isDraft && !on} onClick={() => void a.set(!on, method).catch(() => {})}>
          {on ? AUTO_MERGE_COPY.disarm : AUTO_MERGE_COPY.arm}
        </Button>
      </div>
      {a.error && <ErrorNote className="mt-3">{a.error}</ErrorNote>}
    </div>
  );
}
