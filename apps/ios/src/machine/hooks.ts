import { mayHandOff, takeoverShown, type Holding, type ThreadMachine } from '@omni/shared/thread-machine.ts';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';

import type { ThreadView } from '../live/hub';
import { useLiveHub } from '../live/react';
import { hubMachineApi } from './api';
import type { MachineCommand } from './command';
import { loadMachineFacts, machineOf, type MachineFacts } from './facts';
import { performMachineCommand } from './perform';
import { decidePick, errorFor, IDLE, machineReducer, type MachineUi } from './state';

/** Sync, the other machines and this one's name, loaded while `enabled` and kept (the last answer stays if a reload fails). */
export function useMachineFacts(enabled: boolean) {
  const hub = useLiveHub();
  const [facts, setFacts] = useState<MachineFacts | null>(null);
  const [round, reload] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    void loadMachineFacts(hubMachineApi(hub)).then((next) => alive && setFacts((prev) => next ?? prev));
    return () => {
      alive = false;
    };
  }, [hub, enabled, round]);
  return { facts, reload };
}

/** What a pick did, for the sheet that asked. */
export type PickResult = 'none' | 'done' | 'failed' | 'ask';

export interface ThreadMachineControl {
  /** Null when there is nothing to pick: one machine, still loading, or a handoff under way. */
  machine: ThreadMachine | null;
  ui: MachineUi;
  /** The error the hand off left, the Take over left, and the cancel left. */
  handOffError: string | null;
  takeOverError: string | null;
  cancelError: string | null;
  pick: (value: string) => Promise<PickResult>;
  takeOver: () => Promise<boolean>;
  cancel: () => Promise<boolean>;
  /** Opens the Take over confirm (the banner's button). */
  ask: () => void;
  closeAsk: () => void;
  dismissError: () => void;
  reload: () => void;
}

/**
 * The open thread's machine state: what to pick (loaded only while the thread is this machine's to give away), and the
 * three commands. The answer of each goes into the open thread through `hub.applyHandoff`.
 */
export function useThreadMachine(view: ThreadView | null): ThreadMachineControl {
  const hub = useLiveHub();
  const threadId = view?.threadId ?? null;
  const status = view?.thread?.status;
  const blocked = view?.blocked ?? null;
  const handoff = view?.handoff ?? null;
  const takeover = view?.takeover ?? null;
  const held = useMemo<Holding | null>(() => (threadId ? { status, blocked, handoff, takeover } : null), [threadId, status, blocked, handoff, takeover]);
  const { facts, reload } = useMachineFacts(!!held && mayHandOff(held));
  const machine = useMemo(() => (held ? machineOf(facts, held) : null), [facts, held]);
  const [ui, dispatch] = useReducer(machineReducer, IDLE);
  const busy = useRef(false);
  const canAsk = takeoverShown(takeover, handoff) !== null;
  const asking = ui.asking;
  useEffect(() => {
    // The thread moved on while the confirm was open (the other machine handed it over): it must not come back later.
    if (asking && !canAsk) dispatch({ type: 'closeAsk' });
  }, [asking, canAsk]);

  const run = useCallback(
    async (command: MachineCommand) => {
      if (!threadId || busy.current) return false;
      busy.current = true;
      const outcome = await performMachineCommand({ api: hubMachineApi(hub), apply: (t, h) => hub.applyHandoff(t, h), dispatch }, threadId, command);
      busy.current = false;
      // The machines or the thread changed under the list: read it again.
      if (!outcome.ok && (outcome.kind === 'offline' || outcome.kind === 'busy')) reload();
      return outcome.ok;
    },
    [hub, threadId, reload],
  );

  const pick = useCallback(
    async (value: string): Promise<PickResult> => {
      const decision = decidePick(machine, value);
      if (decision.type === 'none') return 'none';
      if (decision.type === 'ask') return 'ask';
      return (await run({ type: 'handOff', to: decision.to })) ? 'done' : 'failed';
    },
    [machine, run],
  );

  return {
    machine,
    ui,
    handOffError: errorFor(ui, 'handOff'),
    takeOverError: errorFor(ui, 'takeOver'),
    cancelError: errorFor(ui, 'cancel'),
    pick,
    takeOver: useCallback(() => run({ type: 'takeOver' }), [run]),
    cancel: useCallback(() => run({ type: 'cancel' }), [run]),
    ask: useCallback(() => dispatch({ type: 'ask' }), []),
    closeAsk: useCallback(() => dispatch({ type: 'closeAsk' }), []),
    dismissError: useCallback(() => dispatch({ type: 'dismiss' }), []),
    reload,
  };
}
