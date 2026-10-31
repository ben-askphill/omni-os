import { useState } from 'react';
import { takeoverConfirm, type Takeover } from '@omni/shared/handoff.ts';
import { api, errorText } from '../../api.ts';
import { MoSheet } from '../../mobile/parts.tsx';
import { ConfirmDialog, ErrorNote, SlideToConfirm } from '../ui.tsx';
import type { HandoffAnswer } from './Handoff.tsx';

/** Asks the Mac that holds the thread to hand it to this one. Answers like a handoff, with the request as the handoff. */
export const takeOver = (threadId: string) => api.post<HandoffAnswer>(`/threads/${encodeURIComponent(threadId)}/takeover`);

/**
 * What Take over asks before it goes ahead, in takeoverConfirm's words: a dialog on the desktop, a sheet with a slider
 * on a phone. The Machine chip opens it (composer/MachineChip.tsx). Mounted only while it shows, so each opening
 * starts clean. A refusal stays in it, under the question.
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
