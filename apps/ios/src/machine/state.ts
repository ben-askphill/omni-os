import { takeoverNote, type HandoffView } from '@omni/shared/handoff.ts';
import { HERE, type ThreadMachine } from '@omni/shared/thread-machine.ts';

import type { FailureKind } from '../failure';
import type { MachineCommand } from './command';

export type CommandType = MachineCommand['type'];

/** What a tap on a machine row asks for. */
export type PickDecision = { type: 'none' } | { type: 'handOff'; to: string } | { type: 'ask' };

/**
 * A pick of another machine while this one holds the thread hands it off at once, as the web does, with no confirm. A
 * pick of this machine while another holds it asks first (Take over cuts a turn there). The current holder, a disabled
 * row and anything the list does not have change nothing.
 */
export function decidePick(machine: ThreadMachine | null, value: string): PickDecision {
  if (!machine || value === machine.value) return { type: 'none' };
  const row = machine.rows.find((r) => r.value === value);
  if (!row || row.disabled) return { type: 'none' };
  if (machine.kind === 'held') return value === HERE ? { type: 'ask' } : { type: 'none' };
  return { type: 'handOff', to: value };
}

export const HOLDS_NOTE = 'Pick another machine to hand the thread off. Replies and Stop follow it there.';

/** The line under the machine list. */
export const machineNote = (m: ThreadMachine) => (m.kind === 'held' ? takeoverNote(m.takeover) : HOLDS_NOTE);

/** The thread menu row: "Runs on Studio". */
export const runsOnLabel = (m: ThreadMachine) => `Runs on ${m.rows.find((r) => r.value === m.value)?.label ?? 'another machine'}`;

/** A Take over that waits for the other machine is cancelled as a request, a handoff the other machine has not picked up as a handoff. */
export const cancelLabel = (h: Pick<HandoffView, 'state'>) => (h.state.phase === 'requested' ? 'Cancel request' : 'Cancel handoff');

export interface MachineError {
  command: CommandType;
  message: string;
  kind: FailureKind;
}

/** The request state around the picker, the banner and the Take over ask. One command is out at a time. */
export interface MachineUi {
  sending: CommandType | null;
  error: MachineError | null;
  /** The Take over confirm is open (from the banner). */
  asking: boolean;
}

export const IDLE: MachineUi = { sending: null, error: null, asking: false };

export type MachineEvent =
  | { type: 'send'; command: CommandType }
  | { type: 'settle' }
  | { type: 'fail'; error: MachineError }
  | { type: 'ask' }
  | { type: 'closeAsk' }
  | { type: 'dismiss' };

export function machineReducer(state: MachineUi, event: MachineEvent): MachineUi {
  switch (event.type) {
    case 'send':
      return state.sending ? state : { ...state, sending: event.command, error: null };
    case 'settle':
      return IDLE;
    case 'fail':
      return { ...state, sending: null, error: event.error };
    case 'ask':
      return { ...state, asking: true, error: state.error?.command === 'takeOver' ? null : state.error };
    case 'closeAsk':
      return { ...state, asking: false, error: state.error?.command === 'takeOver' ? null : state.error };
    case 'dismiss':
      return state.error ? { ...state, error: null } : state;
  }
}

/** The error a given command left, so each control shows only its own. */
export const errorFor = (ui: MachineUi, command: CommandType) => (ui.error?.command === command ? ui.error.message : null);
