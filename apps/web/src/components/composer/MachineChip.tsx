import { useMemo, useState } from 'react';
import type { HandoffView, Takeover } from '@omni/shared/handoff.ts';
import { takeoverNote } from '@omni/shared/handoff.ts';
import { errorText, type Thread } from '../../api.ts';
import { HERE, threadMachine, type RunOnRow } from '../../run-on.ts';
import { handOff, useHandoffTargets, type HandoffAnswer } from '../thread/Handoff.tsx';
import { TakeoverConfirm } from '../thread/Takeover.tsx';
import { Picker, type PickerOption } from '../ui.tsx';

// The Machine chip: one control for where a thread runs, next to the model pill on both composers. On a new thread it
// picks where the thread starts (Run on); on an open thread it names the machine that holds it and hands the thread
// off or takes it over. Hidden while there is one machine. RunOnPicker.swift is the Mac's; the phone opens its
// RunOnSheet from a chip.

export const machineOptions = (rows: RunOnRow[]): PickerOption<string>[] =>
  rows.map((r) => ({ value: r.value, label: r.label, sub: r.sub, icon: 'monitor', avatar: false, disabled: r.disabled }));

/** "On This Mac" or "On omarchy", with the rows to pick from. Renders nothing without rows: one machine. */
export function MachineChip({ rows, value, onChange, disabled, title }: { rows: RunOnRow[] | null; value: string; onChange: (pick: string) => void; disabled?: boolean; title?: string }) {
  const options = useMemo(() => (rows ? machineOptions(rows) : []), [rows]);
  if (!rows) return null;
  return (
    <span title={title} className="inline-flex max-w-full">
      <Picker label="Run on" prefix="On" value={value} options={options} onChange={onChange} disabled={disabled} />
    </span>
  );
}

/** What the open thread's chip needs from the thread page: the server's block and the thread's handoff state. */
export interface MachineHeld {
  blocked: string | null | undefined;
  handoff: HandoffView | null | undefined;
  takeover: Takeover | null | undefined;
  /** The answer to a hand off or a Take over, for the page to apply. */
  onChanged: (a: HandoffAnswer) => void;
}

/**
 * The open thread's chip, for the desktop composer and the phone's chip row: its rows (null with one machine), what
 * a pick does (hand off to that machine, or ask before taking the thread over), and the ask while it shows.
 */
export function useThreadMachine(thread: { id: string; status?: Thread['status'] }, held: MachineHeld, onError?: (text: string | null) => void) {
  const targets = useHandoffTargets(thread.status ? { status: thread.status } : null, held);
  const running = thread.status === 'running' || thread.status === 'queued';
  const machine = useMemo(() => threadMachine({ targets, takeover: held.takeover, handoff: held.handoff, running }), [targets, held.takeover, held.handoff, running]);
  const [sending, setSending] = useState(false);
  const [asking, setAsking] = useState(false);
  const pick = async (value: string) => {
    if (!machine || value === machine.value || sending) return;
    if (machine.kind === 'held') {
      if (value === HERE) setAsking(true);
      return;
    }
    setSending(true);
    onError?.(null);
    try {
      held.onChanged(await handOff(thread.id, value));
    } catch (e) {
      onError?.(errorText(e));
    } finally {
      setSending(false);
    }
  };
  const title = machine?.kind === 'held' ? takeoverNote(machine.takeover) : machine ? 'Where this thread runs. Pick another machine to hand it off.' : undefined;
  return { machine, pick, sending, asking, closeAsk: () => setAsking(false), title };
}

/** The desktop composer's chip, with Take over's confirm. */
export function ThreadMachineChip({ thread, held, disabled, onError }: { thread: Thread; held: MachineHeld; disabled?: boolean; onError: (text: string | null) => void }) {
  const { machine, pick, sending, asking, closeAsk, title } = useThreadMachine(thread, held, onError);
  if (!machine) return null;
  return (
    <>
      <MachineChip rows={machine.rows} value={machine.value} onChange={(v) => void pick(v)} disabled={disabled || sending} title={title} />
      {asking && machine.kind === 'held' && <TakeoverConfirm threadId={thread.id} takeover={machine.takeover} onClose={closeAsk} onChanged={held.onChanged} />}
    </>
  );
}
