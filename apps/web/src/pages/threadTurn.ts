import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, errorText, type HistoryEvent, type PendingMsg } from '../api.ts';
import type { InitP, ResultP } from '../components/thread/panel/DetailsTab.tsx';
import { parsePayload } from '@omni/shared/transcript-fold.ts';
import { betweenTurns } from '@omni/shared/opening.ts';

/** The id of the newest result row, 0 when there is none. */
export function lastResultIdOf(events: readonly HistoryEvent[]) {
  for (let k = events.length - 1; k >= 0; k--) if (events[k].kind === 'result') return events[k].id;
  return 0;
}

/** What the rows say about the turn: the init and result payloads, and whether the thread is between turns. */
export function useTurnState(events: readonly HistoryEvent[]) {
  const init = useMemo(() => {
    for (let k = events.length - 1; k >= 0; k--) if (events[k].kind === 'init') return parsePayload<InitP>(events[k]);
    return null;
  }, [events]);
  const lastResult = useMemo(() => {
    for (let k = events.length - 1; k >= 0; k--) if (events[k].kind === 'result') return parsePayload<ResultP>(events[k]);
    return null;
  }, [events]);
  const between = useMemo(() => betweenTurns(events), [events]);
  return { init, lastResult, betweenTurns: between };
}

/** The header's interrupt: stopping state until the turn ends, and the error when the stop is refused. */
export function useInterrupt(id: string, slotBusy: boolean, queued: readonly PendingMsg[], events: readonly HistoryEvent[]) {
  const [stopping, setStopping] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  // Also covers "Interrupt and send" while the server really interrupts: that message stays sent until the agent reads it.
  const interrupting = stopping || queued.some((m) => m.state === 'sent' && m.mode === 'interrupt' && !m.forwarded_to);

  const interrupt = useCallback(async () => {
    setStopping(true);
    setActionError(null);
    try {
      await api.post(`/threads/${encodeURIComponent(id)}/stop`);
    } catch (e) {
      setActionError(errorText(e));
      setStopping(false);
    }
  }, [id]);

  // "Interrupting" lasts until the turn ends. Queued steers can keep the thread running past the
  // interrupt, so a new result also clears it, and a timer covers a lost update.
  const lastResultId = useMemo(() => lastResultIdOf(events), [events]);
  useEffect(() => {
    if (!slotBusy) setStopping(false);
  }, [slotBusy]);
  useEffect(() => setStopping(false), [lastResultId]);
  useEffect(() => {
    if (!stopping) return;
    const t = setTimeout(() => setStopping(false), 15_000);
    return () => clearTimeout(t);
  }, [stopping]);

  return { interrupting, interrupt, actionError, setActionError };
}
