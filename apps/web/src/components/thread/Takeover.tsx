import { useState } from 'react';
import { takeoverConfirm, takeoverNote, type HandoffView, type Takeover } from '@omni/shared/handoff.ts';
import { api, errorText } from '../../api.ts';
import { takeoverShown } from '../../handoff.ts';
import { MoSheet } from '../../mobile/parts.tsx';
import { Button, ConfirmDialog, ErrorNote, SlideToConfirm, StatusDot } from '../ui.tsx';
import type { HandoffAnswer } from './Handoff.tsx';

/** Asks the Mac that holds the thread to hand it to this one. Answers like a handoff, with the request as the handoff. */
export const takeOver = (threadId: string) => api.post<HandoffAnswer>(`/threads/${encodeURIComponent(threadId)}/takeover`);

/**
 * What Take over asks before it goes ahead, in takeoverConfirm's words: a dialog on the desktop, a sheet with a slider
 * on a phone. Mounted only while it shows, so each opening starts clean. A refusal stays in it, under the question.
 */
export function TakeoverConfirm({
  threadId,
  takeover,
  mobile,
  onClose,
  onChanged,
}: {
  threadId: string;
  takeover: Takeover;
  mobile?: boolean;
  onClose: () => void;
  onChanged: (a: HandoffAnswer) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { title, body } = takeoverConfirm(takeover);
  // Throws on a refusal so the slider springs back.
  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      onChanged(await takeOver(threadId));
      onClose();
    } catch (e) {
      setError(errorText(e));
      throw e;
    } finally {
      setBusy(false);
    }
  };

  if (mobile) {
    return (
      <MoSheet onClose={onClose} label="Take over">
        <div className="px-5 pt-2.5 pb-1 text-[15px] leading-[1.3] font-medium">{title}</div>
        <p className="px-5 pb-3 text-[13.5px] leading-[1.45] text-fg-3">{body}</p>
        <div className="flex flex-col gap-2.5 px-4 pt-1">
          {error && <ErrorNote>{error}</ErrorNote>}
          <SlideToConfirm label={`Slide to run on ${takeover.to.name}`} busyLabel="Asking" doneLabel="Asked" onConfirm={confirm} />
        </div>
      </MoSheet>
    );
  }
  return (
    <ConfirmDialog open title={title} confirmLabel="Take over" busy={busy} error={error} onConfirm={() => void confirm().catch(() => {})} onCancel={onClose}>
      <p>{body}</p>
    </ConfirmDialog>
  );
}

/**
 * Over the reply box while another Mac holds the thread: where it runs or last ran, and Take over, or why it cannot be
 * taken over now. Out of the way while a handoff or a Take over is under way, which the handoff card shows.
 */
export function TakeoverNote({
  threadId,
  takeover,
  handoff,
  mobile,
  onChanged,
}: {
  threadId: string;
  takeover: Takeover | null;
  handoff: HandoffView | null;
  mobile?: boolean;
  onChanged: (a: HandoffAnswer) => void;
}) {
  const [asking, setAsking] = useState(false);
  const t = takeoverShown(takeover, handoff);
  if (!t) return null;
  return (
    <>
      <section aria-label="Take over" className={`flex items-start gap-2.5 rounded-2xl bg-surface px-4 py-2.5 text-[13px] text-fg ${mobile ? 'mx-3 mb-1' : 'mb-2'}`}>
        <StatusDot status={t.running ? 'running' : 'idle'} size={8} className="mt-[5px]" />
        <div className="min-w-0 flex-1">
          <p className="leading-[1.45]">{takeoverNote(t)}</p>
          {t.refused && <p className="mt-0.5 text-[12.5px] leading-[1.5] text-fg-3">{t.refused}</p>}
        </div>
        {!t.refused && (
          <Button size="sm" variant="secondary" icon="download" onClick={() => setAsking(true)} className="-my-0.5 shrink-0 self-center">
            Take over
          </Button>
        )}
      </section>
      {asking && <TakeoverConfirm threadId={threadId} takeover={t} mobile={mobile} onClose={() => setAsking(false)} onChanged={onChanged} />}
    </>
  );
}
