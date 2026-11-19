import { describe, expect, it } from 'vitest';
import { pickMachine, type PickCandidate } from '../machine-pick.ts';

const machine = (o: Partial<PickCandidate>): PickCandidate => ({ id: 'm', name: 'Machine', here: false, reachability: 'online', lastSeen: null, ...o });
const mac = machine({ id: 'mac-1', name: "Ben's MacBook Pro", here: true });
const box = machine({ id: 'box-1', name: 'omarchy' });

describe('pickMachine', () => {
  it('takes here, an id and a name in any case', () => {
    expect(pickMachine('here', [mac, box])).toEqual({ ok: true, pick: { device: 'here', id: 'mac-1', name: "Ben's MacBook Pro", here: true, via: 'here' } });
    expect(pickMachine('box-1', [mac, box])).toEqual({ ok: true, pick: { device: 'box-1', id: 'box-1', name: 'omarchy', here: false, via: 'id' } });
    expect(pickMachine(' OMARCHY ', [mac, box])).toMatchObject({ ok: true, pick: { device: 'box-1', via: 'name' } });
  });

  it("runs here for this machine's own id or name", () => {
    expect(pickMachine('mac-1', [mac, box])).toMatchObject({ ok: true, pick: { device: 'here', here: true, via: 'id' } });
    expect(pickMachine("ben's macbook pro", [mac, box])).toMatchObject({ ok: true, pick: { device: 'here', here: true, via: 'here' } });
  });

  it('refuses a name two machines share, and one no machine has', () => {
    const twin = machine({ id: 'box-2', name: 'omarchy' });
    expect(pickMachine('omarchy', [mac, box, twin])).toEqual({ ok: false, status: 400, error: '2 machines are called "omarchy". Pass the id instead: box-1, box-2.' });
    expect(pickMachine('studio', [mac, box])).toEqual({
      ok: false,
      status: 404,
      error: `No synced machine has the id or name "studio". Machines: Ben's MacBook Pro (mac-1, this machine), omarchy (box-1).`,
    });
  });

  it('takes a part of a name one machine has, and refuses one two machines share', () => {
    const air = machine({ id: 'air-1', name: "Ben's MacBook Air" });
    expect(pickMachine('macbook pro', [mac, box, air])).toMatchObject({ ok: true, pick: { device: 'here', here: true } });
    expect(pickMachine('Air', [mac, box, air])).toMatchObject({ ok: true, pick: { device: 'air-1', via: 'name' } });
    expect(pickMachine('MacBook', [mac, box, air])).toEqual({
      ok: false,
      status: 400,
      error: `2 machines match "MacBook": Ben's MacBook Pro (mac-1, this machine), Ben's MacBook Air (air-1). Pass the id instead.`,
    });
  });

  it('knows only this machine while sync is off', () => {
    const alone = machine({ id: null, name: 'omarchy', here: true });
    expect(pickMachine('', [alone])).toMatchObject({ ok: true, pick: { device: 'here' } });
    expect(pickMachine('omarchy', [alone])).toMatchObject({ ok: true, pick: { device: 'here' } });
  });
});
