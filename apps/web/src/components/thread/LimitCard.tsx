import { useState } from 'react';
import { api, errorText, type HarnessWithRunning, type PendingMsg, type Thread } from '../../api.ts';
import { LIMIT_ACTION as ACTION, limitView, pickModelFor, type LimitAction } from '../../limits.ts';
import { goneModel } from '@omni/shared/model-visibility.ts';
import { useNow } from '../../store.tsx';
import { harnessLabel } from '../brand.tsx';
import { Button, ErrorNote, Icon } from '../ui.tsx';

/**
 * A turn the harness stopped at the plan's usage limit (apps/server/runner/limits.ts). With the reset time it reported,
 * Ben can have Omni continue the thread then, once, or cancel that; without one, or any time, he resumes it now.
 */
export function LimitCard({ thread, onChanged }: { thread: Thread; onChanged: (t: Thread, pending: PendingMsg[]) => void }) {
  const now = useNow(60_000);
  const [busy, setBusy] = useState<LimitAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const view = limitView(thread, harnessLabel(thread.harness), now);
  if (!view) return null;
  const scheduled = thread.limit_state === 'scheduled';

  const act = async (a: LimitAction) => {
    // Another model: the composer's picker opens, and nothing is posted until a model is picked there.
    if (a === 'switch') return pickModelFor(thread.id);
    setBusy(a);
    setError(null);
    try {
      const res = await api.post<{ thread: Thread; pending: PendingMsg[] }>(`/threads/${encodeURIComponent(thread.id)}/limit/${ACTION[a].path}`, {});
      onChanged(res.thread, res.pending);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section aria-label={view.title} role="status" className="pop-in mt-5 overflow-hidden rounded-2xl border border-line bg-surface">
      <div className="flex items-start gap-3 px-4 py-3.5">
        <span className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-surface-2 ${scheduled ? 'text-fg-2' : 'text-warn'}`}>
          <Icon name={scheduled ? 'clock' : 'gauge'} size={15} />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-[14px] leading-snug font-medium">{view.title}</h3>
          <p className="mt-0.5 text-[12.5px] leading-[1.5] text-pretty text-fg-3">{view.body}</p>
          {view.actions.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              {view.actions.map((a, i) => (
                <Button
                  key={a}
                  size="sm"
                  variant={i === 0 ? 'primary' : 'secondary'}
                  icon={ACTION[a].icon}
                  busy={busy === a}
                  disabled={!!busy}
                  onClick={() => void act(a)}
                >
                  {ACTION[a].label}
                </Button>
              ))}
            </div>
          )}
        </div>
      </div>
      {error && <ErrorNote className="mx-3 mb-3">{error}</ErrorNote>}
    </section>
  );
}

/**
 * The thread's model is no longer offered by its harness (OpenCode Zen's free models are free "for a limited time"):
 * the run waits for a pick, and nothing switches on its own. Null while the model is listed.
 */
export function ModelGoneCard({ thread, harnesses }: { thread: Thread; harnesses: HarnessWithRunning[] | null | undefined }) {
  const harness = harnesses?.find((h) => h.id === thread.harness);
  const gone = goneModel(harness, thread.model);
  if (!harness || !gone) return null;
  const title = `${gone.label} is gone`;
  return (
    <section aria-label={title} role="status" className="pop-in mt-5 overflow-hidden rounded-2xl border border-line bg-surface">
      <div className="flex items-start gap-3 px-4 py-3.5">
        <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-surface-2 text-needs">
          <Icon name="alert" size={15} />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-[14px] leading-snug font-medium">{title}</h3>
          <p className="mt-0.5 text-[12.5px] leading-[1.5] text-pretty text-fg-3">
            {harness.name} no longer offers this model. Pick another, then send your message again. Nothing switches on its own.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <Button size="sm" variant="primary" icon="sliders" onClick={() => pickModelFor(thread.id)}>
              Pick a model
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
