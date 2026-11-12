import { stepOf, type PRStep } from '@omni/shared/thread-glance.ts';
import { useCallback, useEffect, useMemo, useState } from 'react';

import type { ThreadLive, ThreadView } from '../live/hub';
import { resumes, shownStep, stepState } from './step';

/** How long a press shows as working when the thread never lists the message (another client cleared it, a lost reply). */
const UNSEEN_MS = 15_000;

export type AskOutcome = { kind: 'sent' } | { kind: 'busy' } | { kind: 'failed'; message: string };

/**
 * The branch steps of one thread: which one the agent works on (`working`), a step prompt parked before the agent got
 * it, and `ask`, which sends a step prompt, or resumes the parked copy of the same one so the thread is not asked twice.
 */
export function usePRStep(live: ThreadLive | null, view: ThreadView | null) {
  const thread = view?.thread ?? null;
  const busy = thread?.status === 'running' || thread?.status === 'queued';
  const rows = view?.rows;
  const pending = view?.pending;
  const { underway, parked } = useMemo(() => stepState({ rows: rows ?? [], pending: pending ?? [], busy }), [rows, pending, busy]);
  const [asked, setAsked] = useState<{ step: PRStep; seen: boolean; at: number } | null>(null);

  useEffect(() => {
    if (!asked) return;
    if (underway === asked.step) {
      if (!asked.seen) setAsked({ ...asked, seen: true });
    } else if (asked.seen && !busy) setAsked(null);
  }, [asked, underway, busy]);
  useEffect(() => {
    if (!asked || asked.seen) return;
    const t = setTimeout(() => setAsked((a) => (a && !a.seen && a.at === asked.at ? null : a)), UNSEEN_MS);
    return () => clearTimeout(t);
  }, [asked]);

  const ask = useCallback(
    async (prompt: string): Promise<AskOutcome> => {
      if (!live || !thread) return { kind: 'failed', message: 'The thread is not loaded yet.' };
      const step = stepOf(prompt);
      if (resumes(parked, prompt) && parked) {
        if (step) setAsked({ step, seen: false, at: Date.now() });
        try {
          await live.act({ kind: 'resume', ids: [parked.uuid] });
          return { kind: 'sent' };
        } catch (e) {
          setAsked(null);
          return { kind: 'failed', message: e instanceof Error ? e.message : 'Could not resume the message.' };
        }
      }
      if (live.send.state.get().outbox.item) return { kind: 'busy' };
      if (step) setAsked({ step, seen: false, at: Date.now() });
      const sent = await live.send.submit(thread, prompt);
      if (sent) return { kind: 'sent' };
      setAsked(null);
      return { kind: 'failed', message: live.send.state.get().outbox.item?.phase === 'failed' ? 'The message did not send. It is kept in the thread.' : 'Could not send the message.' };
    },
    [live, thread, parked],
  );

  return { working: shownStep(asked, underway), parked: underway === null && !asked ? parked : null, ask };
}
