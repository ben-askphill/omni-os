import { useEffect, useRef, useState, type FormEvent } from 'react';
import { scopeWords, settledWords, valueProblem, VALUE_MAX, type SecretAsk, type ThreadSecretRequest } from '@omni/shared/secret-request.ts';
import { api, ApiError, errorText } from '../../api.ts';
import { Button, ErrorNote, StatusPill } from '../ui.tsx';
import { ASKING_LABEL } from './QuestionCard.tsx';
import { cancel, cancelled, refused, save, saved, START, typed, type Phase, type Settled } from './secret-request-state.ts';

/**
 * A secret the agent asked for with request_secret (packages/shared/secret-request.ts). Ben types it here, and the value
 * goes to the server's secret store and nowhere else: the thread never holds it and the agent only learns the env var's
 * name. Once saved, cancelled or dismissed the card folds to what became of it. `touch` gives the phone 44px targets.
 */
export function SecretRequestCard({ threadId, r, touch }: { threadId: string; r: ThreadSecretRequest; touch?: boolean }) {
  if (r.state !== 'pending') return <Summary ask={r.ask} state={r.state} replaced={r.replaced} />;
  return <Asking threadId={threadId} r={r} touch={touch} />;
}

function Summary({ ask, state, replaced }: { ask: SecretAsk; state: Settled; replaced: boolean }) {
  return (
    <section aria-label="Secret" className="w-full rounded-[22px] bg-surface px-4 pt-3 pb-3.5">
      <span className="caption">Secret</span>
      <dl className="mt-2">
        <dt className="text-[12.5px] leading-snug text-fg-3">{ask.label}</dt>
        <dd className="mt-0.5 text-[14px] leading-snug break-words text-fg">{settledWords({ ask, state, replaced })}</dd>
      </dl>
    </section>
  );
}

function Asking({ threadId, r, touch }: { threadId: string; r: ThreadSecretRequest; touch?: boolean }) {
  const { ask, exists } = r;
  const [phase, setPhase] = useState<Phase>(START);
  const field = useRef<HTMLInputElement>(null);
  const base = `/threads/${encodeURIComponent(threadId)}/secret-requests/${encodeURIComponent(r.id)}`;

  // The card takes focus when it appears, on a desktop. The phone keeps its keyboard down until Ben taps the field.
  useEffect(() => {
    if (!touch) field.current?.focus({ preventScroll: true });
  }, [touch]);

  const fail = (from: Phase, e: unknown): Phase => (e instanceof ApiError ? refused(from, e.status, e.body, e.message) : refused(from, 0, null, errorText(e)));

  const send = async (p: Extract<Phase, { at: 'sending' }>) => {
    try {
      const res = await api.post<{ state: 'saved'; replaced: boolean }>(`${base}/submit`, { value: p.value, replace: p.replace });
      setPhase(saved(res.replaced));
    } catch (e) {
      setPhase(fail(p, e));
    }
  };

  const call = (next: Phase) => {
    setPhase(next);
    if (next.at === 'sending') void send(next);
  };

  const decline = async () => {
    const next = cancel(phase);
    setPhase(next);
    if (next.at !== 'cancelling') return;
    try {
      await api.post(`${base}/cancel`);
      setPhase(cancelled);
    } catch (e) {
      setPhase(fail(next, e));
    }
  };

  if (phase.at === 'settled') return <Summary ask={ask} state={phase.state} replaced={phase.replaced} />;

  const value = phase.value;
  const busy = phase.at === 'sending' || phase.at === 'cancelling';
  const problem = valueProblem(value);
  const confirming = phase.at === 'confirmReplace' || (phase.at === 'sending' && phase.replace);
  const error = phase.at === 'editing' || phase.at === 'confirmReplace' ? phase.error : null;
  const size = touch ? 'lg' : 'sm';
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (problem === null) call(save(phase, exists));
  };

  return (
    <div className="flex w-full flex-col items-start gap-2">
      <section aria-label="Secret requested by the agent" className="pop-in w-full overflow-hidden rounded-[22px] bg-surface">
        <div className="bg-surface-2 px-4 py-3">
          <span className="caption">Secret</span>
          <h3 className="mt-1 text-[14px] leading-snug font-semibold text-pretty">{ask.label}</h3>
          <p className="mt-1 text-[12.5px] leading-snug text-fg-3">
            <span className="font-mono">{ask.name}</span> for {scopeWords(ask.scope)}
          </p>
          {ask.reason && <p className="mt-1.5 text-[13px] leading-snug text-pretty text-fg-2">{ask.reason}</p>}
        </div>
        <form onSubmit={submit} className="flex flex-col gap-2.5 px-4 py-3">
          <input
            ref={field}
            id={`secret-${r.id}`}
            type="password"
            autoComplete="new-password"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            data-1p-ignore
            data-lpignore="true"
            maxLength={VALUE_MAX}
            value={value}
            disabled={busy}
            onChange={(e) => setPhase(typed(phase, e.target.value))}
            aria-label={`Value for ${ask.name}`}
            placeholder="Paste the value"
            className={`field font-mono !text-[13px] ${touch ? '!min-h-11 !text-[16px]' : ''}`}
          />
          {(exists || confirming) && (
            <p role="status" className="text-[12.5px] leading-snug text-pretty text-fg-3">
              {confirming
                ? `This overwrites the value saved under ${ask.name} for ${scopeWords(ask.scope)}.`
                : `A value is already saved under ${ask.name} for ${scopeWords(ask.scope)}. Saving replaces it.`}
            </p>
          )}
          {error && <ErrorNote>{error}</ErrorNote>}
          <div className="flex items-center justify-end gap-2">
            <Button size={size} variant="secondary" disabled={busy} onClick={() => void decline()}>
              Cancel
            </Button>
            <Button type="submit" size={size} variant="primary" icon="key" busy={phase.at === 'sending'} disabled={busy || problem !== null}>
              {confirming ? 'Confirm replace' : exists ? 'Replace' : 'Save'}
            </Button>
          </div>
        </form>
      </section>
      <StatusPill status="needs" label={ASKING_LABEL} />
    </div>
  );
}
