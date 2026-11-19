// What a Conductor tool's device or to argument names: delegate, continue_thread, set_automations_machine and
// hand_off_thread all read it through pickDevice.
import { describe, expect, it } from 'vitest';
import { pickDevice } from '../device-pick.ts';

const others = [
  { id: 'air-1', name: "Ben's MacBook Air" },
  { id: 'pro-1', name: "Ben's MacBook Pro" },
];

describe('pickDevice', () => {
  it('takes an id, a whole name in any case, or here', () => {
    expect(pickDevice('pro-1', others, 'omarchy').id).toBe('pro-1');
    expect(pickDevice("ben's macbook air", others, 'omarchy').id).toBe('air-1');
    expect(pickDevice('HERE', others, 'omarchy').id).toBe('here');
  });

  it("reads this machine's own name as here, though list_devices leaves it out", () => {
    expect(pickDevice('omarchy', others, 'omarchy')).toEqual({ id: 'here', name: 'omarchy' });
    expect(pickDevice(' Omarchy ', others, 'omarchy').id).toBe('here');
  });

  it('takes a part of a name that one machine has', () => {
    expect(pickDevice('MacBook Pro', others, 'omarchy').id).toBe('pro-1');
    expect(pickDevice('air', others, null).id).toBe('air-1');
  });

  it('refuses a part two machines share, and a name none has, listing them', () => {
    expect(() => pickDevice('MacBook', others, 'omarchy')).toThrow(/2 machines match "MacBook".*Pass the id/);
    expect(() => pickDevice('studio', others, 'omarchy')).toThrow(/No synced machine is called "studio"\. Machines: Ben's MacBook Air \(air-1\), Ben's MacBook Pro \(pro-1\)\. This machine, omarchy, is "here"\./);
    expect(() => pickDevice('studio', [], null)).toThrow(/none, sync is off/);
  });
});
