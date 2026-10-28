import { useState } from 'react';
import type { Device, HandoffView } from '@omni/shared/handoff.ts';
import { api, errorText, useApi, type SyncStatus, type Thread } from '../../api.ts';
import { handoffBanner, handoffTargets, mayHandOff, syncCarries, type Holding } from '../../handoff.ts';
import { Button, ErrorNote, Icon, Loader } from '../ui.tsx';

/** POST /api/threads/:id/handoff and /handoff/cancel answer with both. */
export type HandoffAnswer = { thread: Thread; handoff: HandoffView | null };

export const handOff = (threadId: string, to: string) => api.post<HandoffAnswer>(`/threads/${encodeURIComponent(threadId)}/handoff`, { to });

/** The other Macs a thread could go to, asked for only while it is this Mac's to give away. */
export function useHandoffTargets(thread: { status: string } | null | undefined, held: Omit<Holding, 'status'>) {
  const v = { ...held, status: thread?.status };
  const may = mayHandOff(v);
  const sync = useApi<SyncStatus>(may ? '/sync/status' : null);
  const devices = useApi<Device[]>(may && syncCarries(sync.data) ? '/devices' : null);
  return handoffTargets({ ...v, sync: sync.data, devices: devices.data });
}

/**
 * The thread's handoff in the transcript column: a card while it is under way or went wrong, with Cancel on the giving
 * Mac until the other one takes it, then one quiet line. The text comes from handoffText in packages/shared/handoff.ts.
 */
export function HandoffCard({
  thread,
  handoff,
  mobile,
  onChanged,
}: {
  thread: Thread;
  handoff: HandoffView | null;
  mobile?: boolean;
  onChanged: (a: HandoffAnswer) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const banner = handoffBanner(handoff, thread.status);
  if (!banner || !handoff) return null;

  if (banner.size === 'line') {
    return (
      <div role="status" className={`flex items-center gap-2 text-fg-3 ${mobile ? 'px-1 text-[13px]' : 'mt-5 text-[12.5px]'}`}>
        <Icon name={banner.tone === 'done' ? 'share' : 'x'} size={13} className="shrink-0 text-fg-4" />
        <span className="min-w-0">{banner.text}</span>
      </div>
    );
  }

  const alert = banner.tone === 'alert';
  const cancel = async () => {
    setBusy(true);
    setError(null);
    try {
      onChanged(await api.post<HandoffAnswer>(`/threads/${encodeURIComponent(thread.id)}/handoff/cancel`, {}));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      aria-label="Handoff"
      role={alert ? 'alert' : 'status'}
      className={`pop-in overflow-hidden bg-surface ${mobile ? 'rounded-[20px]' : 'mt-5 rounded-2xl border border-line'}`}
    >
      <div className="flex flex-wrap items-center gap-3 px-4 py-3">
        <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full ${alert ? 'bg-needs/12 text-needs' : 'bg-surface-2 text-fg-3'}`}>
          {banner.tone === 'working' ? <Loader size={14} /> : <Icon name={alert ? 'alert' : 'clock'} size={15} />}
        </span>
        <div className="min-w-0 flex-1 basis-56">
          <p className={`${mobile ? 'text-[14px]' : 'text-[13.5px]'} leading-[1.45] text-fg`}>{banner.text}</p>
          {handoff.leftBehind && <p className="mt-0.5 text-[12.5px] leading-[1.5] text-fg-3">{handoff.leftBehind}</p>}
        </div>
        {banner.cancel && (
          <Button size="sm" variant="secondary" icon="x" busy={busy} onClick={() => void cancel()} className="ml-auto shrink-0">
            {handoff.state.phase === 'requested' ? 'Cancel request' : 'Cancel handoff'}
          </Button>
        )}
      </div>
      {error && <ErrorNote className="mx-3 mb-3">{error}</ErrorNote>}
    </section>
  );
}
