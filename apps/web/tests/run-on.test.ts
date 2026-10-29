import { describe, expect, it } from 'vitest';
import type { Device } from '@omni/shared/handoff.ts';
import { HERE, offersRunOn, runOnDefault, runOnPick, runOnRequest, runOnRows, runOnSetting, settingPick } from '../src/run-on.ts';

const now = Date.parse('2026-10-29T20:00:00Z');
const omarchy: Device = { id: 'omarchy-id', name: 'omarchy', reachability: 'online', dnsName: 'omarchy.tail.ts.net', lastSeen: null };
const mini: Device = { id: 'mini-id', name: "Ben's Mac mini", reachability: 'offline', dnsName: null, lastSeen: '2026-10-29T18:00:00Z' };
const unsure: Device = { id: 'air-id', name: 'Air', reachability: 'unknown', dnsName: null, lastSeen: null };

describe('where a new thread runs', () => {
  it('lists This Mac first, then each synced machine, with an offline one disabled in the composer', () => {
    const rows = runOnRows([omarchy, mini, unsure], { now });
    expect(rows.map((r) => [r.value, r.label, r.disabled])).toEqual([
      [HERE, 'This Mac', false],
      ['omarchy-id', 'omarchy', false],
      ['mini-id', "Ben's Mac mini", true],
      ['air-id', 'Air', false],
    ]);
    expect(rows[1].sub).toBe('Online on Tailscale');
    expect(rows[2].sub).toMatch(/^Asleep or offline, last seen /);
  });

  it('lets Settings name a sleeping machine as the default', () => {
    expect(runOnRows([mini], { now, asDefault: true }).every((r) => !r.disabled)).toBe(true);
  });

  it("starts on Settings' default, or This Mac when that machine is gone or offline", () => {
    expect(runOnDefault('', [omarchy])).toBe(HERE);
    expect(runOnDefault(undefined, [omarchy])).toBe(HERE);
    expect(runOnDefault('omarchy-id', [omarchy])).toBe('omarchy-id');
    expect(runOnDefault('removed-id', [omarchy])).toBe(HERE);
    expect(runOnDefault('mini-id', [omarchy, mini])).toBe(HERE);
    expect(runOnDefault('air-id', [unsure])).toBe('air-id');
  });

  it('keeps a pick while its machine is still on offer', () => {
    expect(runOnPick(HERE, 'omarchy-id', [omarchy])).toBe(HERE);
    expect(runOnPick('omarchy-id', '', [omarchy])).toBe('omarchy-id');
    expect(runOnPick('omarchy-id', '', [{ ...omarchy, reachability: 'offline' }])).toBe(HERE);
    expect(runOnPick(null, 'omarchy-id', [omarchy])).toBe('omarchy-id');
  });

  it('hides the picker and leaves the request alone with no other machine', () => {
    expect(offersRunOn(undefined)).toBe(false);
    expect(offersRunOn([])).toBe(false);
    expect(runOnRequest(HERE, [])).toEqual({});
    expect(runOnRequest(HERE, undefined)).toEqual({});
    expect(runOnRequest(HERE, [omarchy])).toEqual({ device: 'here' });
    expect(runOnRequest('omarchy-id', [omarchy])).toEqual({ device: 'omarchy-id' });
  });

  it("saves This Mac as '' and shows a default that is no longer synced as This Mac", () => {
    expect(runOnSetting(HERE)).toBe('');
    expect(runOnSetting('omarchy-id')).toBe('omarchy-id');
    expect(settingPick('', [omarchy])).toBe(HERE);
    expect(settingPick('omarchy-id', [omarchy])).toBe('omarchy-id');
    expect(settingPick('removed-id', [omarchy])).toBe(HERE);
    expect(settingPick('mini-id', [mini])).toBe('mini-id');
  });
});
