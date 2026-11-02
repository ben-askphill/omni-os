import { HERE } from '@omni/shared/thread-machine.ts';
import { describe, expect, it } from 'vitest';

import { machineOf } from '../../src/machine/facts';
import { cancelLabel, decidePick, errorFor, HOLDS_NOTE, IDLE, machineNote, machineReducer, runsOnLabel, type MachineUi } from '../../src/machine/state';
import { device, handoff, sync, takeover } from './fixtures';

const facts = { sync: sync(), devices: [device(), device({ id: 'm3', name: 'Mini', reachability: 'offline' })], hereName: 'Laptop' };
const holds = machineOf(facts, { status: 'done', blocked: null, handoff: null, takeover: null });
const held = machineOf(null, { status: 'done', blocked: null, handoff: null, takeover: takeover() });
const heldRefused = machineOf(null, { status: 'running', blocked: null, handoff: null, takeover: takeover({ running: true, refused: 'Studio is stopping a turn.' }) });

describe('decidePick', () => {
  it('hands off at once to another machine while this one holds the thread', () => {
    expect(decidePick(holds, 'm2')).toEqual({ type: 'handOff', to: 'm2' });
  });

  it('does nothing for the current holder, an offline machine or a machine the list lacks', () => {
    expect(decidePick(holds, HERE)).toEqual({ type: 'none' });
    expect(decidePick(holds, 'm3')).toEqual({ type: 'none' });
    expect(decidePick(holds, 'gone')).toEqual({ type: 'none' });
    expect(decidePick(null, 'm2')).toEqual({ type: 'none' });
  });

  it('asks before taking over when another machine holds the thread', () => {
    expect(decidePick(held, HERE)).toEqual({ type: 'ask' });
    expect(decidePick(held, 'm2')).toEqual({ type: 'none' });
  });

  it('does not ask when Take over is refused', () => {
    expect(decidePick(heldRefused, HERE)).toEqual({ type: 'none' });
  });
});

describe('labels', () => {
  it('names the holder on the menu row', () => {
    expect(runsOnLabel(holds!)).toBe('Runs on Laptop');
    expect(runsOnLabel(held!)).toBe('Runs on Studio');
  });

  it('puts the hand off hint under a holding machine and the Take over note under a held one', () => {
    expect(machineNote(holds!)).toBe(HOLDS_NOTE);
    expect(HOLDS_NOTE).toBe('Pick another machine to hand the thread off. Replies and Stop follow it there.');
    expect(machineNote(held!)).toBe('Last ran on Studio.');
    expect(machineNote(heldRefused!)).toBe('This thread is running on Studio.');
  });
});

describe('cancelLabel', () => {
  it('calls a waiting Take over a request and any other handoff a handoff', () => {
    expect(cancelLabel(handoff({ state: { phase: 'requested', stale: false } }))).toBe('Cancel request');
    expect(cancelLabel(handoff({ state: { phase: 'offered', stale: true } }))).toBe('Cancel handoff');
    expect(cancelLabel(handoff({ state: { phase: 'preparing', step: 'packing' } }))).toBe('Cancel handoff');
  });
});

describe('machineReducer', () => {
  const error = { command: 'handOff' as const, message: 'No.', kind: 'busy' as const };

  it('sends one command at a time and clears the last error when it starts', () => {
    const failed: MachineUi = { ...IDLE, error };
    const sending = machineReducer(failed, { type: 'send', command: 'handOff' });
    expect(sending).toEqual({ sending: 'handOff', error: null, asking: false });
    expect(machineReducer(sending, { type: 'send', command: 'cancel' })).toBe(sending);
  });

  it('settles to idle, which also closes the Take over ask', () => {
    const asking = machineReducer(IDLE, { type: 'ask' });
    const sending = machineReducer(asking, { type: 'send', command: 'takeOver' });
    expect(machineReducer(sending, { type: 'settle' })).toEqual(IDLE);
  });

  it('keeps the ask open on a refusal and shows the error with it', () => {
    const sending = machineReducer(machineReducer(IDLE, { type: 'ask' }), { type: 'send', command: 'takeOver' });
    const failed = machineReducer(sending, { type: 'fail', error: { ...error, command: 'takeOver' } });
    expect(failed).toMatchObject({ sending: null, asking: true });
    expect(errorFor(failed, 'takeOver')).toBe('No.');
    expect(errorFor(failed, 'handOff')).toBeNull();
  });

  it('drops a Take over error when the ask opens or closes again', () => {
    const failed: MachineUi = { sending: null, asking: true, error: { ...error, command: 'takeOver' } };
    expect(machineReducer(failed, { type: 'closeAsk' })).toEqual(IDLE);
    expect(machineReducer(failed, { type: 'ask' }).error).toBeNull();
  });

  it('dismisses an error and leaves other state alone', () => {
    expect(machineReducer({ ...IDLE, error }, { type: 'dismiss' })).toEqual(IDLE);
    expect(machineReducer(IDLE, { type: 'dismiss' })).toBe(IDLE);
  });
});
