import { describe, expect, it } from 'vitest';
import type { Device } from '../handoff.ts';
import {
  GROK_BOT,
  grokBotBlock,
  HERE,
  newThreadPick,
  newThreadRows,
  offersRunOn,
  runOnDefault,
  runOnPick,
  runOnPrefix,
  runOnRequest,
  runOnRows,
  runOnSetting,
  settingPick,
} from '../thread-machine.ts';

const now = Date.parse('2026-10-29T20:00:00Z');
const omarchy: Device = { id: 'omarchy-id', name: 'omarchy', reachability: 'online', dnsName: 'omarchy.tail.ts.net', lastSeen: null };
const mini: Device = { id: 'mini-id', name: "Ben's Mac mini", reachability: 'offline', dnsName: null, lastSeen: '2026-10-29T18:00:00Z' };
const unsure: Device = { id: 'air-id', name: 'Air', reachability: 'unknown', dnsName: null, lastSeen: null };

describe('where a new thread runs', () => {
  it('lists this machine first by its name, then each synced machine, with an offline one disabled in the composer', () => {
    const rows = runOnRows([omarchy, mini, unsure], { now, hereName: "Ben's MacBook Pro" });
    expect(rows.map((r) => [r.value, r.label, r.disabled])).toEqual([
      [HERE, "Ben's MacBook Pro", false],
      ['omarchy-id', 'omarchy', false],
      ['mini-id', "Ben's Mac mini", true],
      ['air-id', 'Air', false],
    ]);
    expect(rows[1].sub).toBe('Online on Tailscale');
    expect(rows[2].sub).toMatch(/^Asleep or offline, last seen /);
  });

  it('labels this machine Unnamed machine without a name, never This Mac or This machine', () => {
    expect(runOnRows([omarchy], { now })[0]!.label).toBe('Unnamed machine');
    expect(runOnRows([omarchy], { now, hereName: ' ' })[0]!.label).toBe('Unnamed machine');
    expect(runOnRows([omarchy], { now, hereName: 'omarchy-box' })[0]!.label).toBe('omarchy-box');
  });

  it('lets Settings name a sleeping machine as the default', () => {
    expect(runOnRows([mini], { now, asDefault: true }).every((r) => !r.disabled)).toBe(true);
  });

  it("starts on Settings' default, or This Mac when that machine is gone", () => {
    expect(runOnDefault('', [omarchy])).toBe(HERE);
    expect(runOnDefault(undefined, [omarchy])).toBe(HERE);
    expect(runOnDefault('omarchy-id', [omarchy])).toBe('omarchy-id');
    expect(runOnDefault('removed-id', [omarchy])).toBe(HERE);
    expect(runOnDefault('mini-id', [omarchy, mini])).toBe('mini-id');
    expect(runOnDefault('air-id', [unsure])).toBe('air-id');
  });

  it('keeps a pick while its machine is still on offer', () => {
    expect(runOnPick(HERE, 'omarchy-id', [omarchy])).toBe(HERE);
    expect(runOnPick('omarchy-id', '', [omarchy])).toBe('omarchy-id');
    expect(runOnPick('omarchy-id', '', [{ ...omarchy, reachability: 'offline' }])).toBe('omarchy-id');
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

describe('Grok Bot as a new thread target', () => {
  it('follows the machines with Grok Bot, offered while its webhook is set', () => {
    const rows = newThreadRows([omarchy], { grokBot: true, now, hereName: "Ben's MacBook Pro" })!;
    expect(rows.map((r) => [r.value, r.label, r.disabled])).toEqual([
      [HERE, "Ben's MacBook Pro", false],
      ['omarchy-id', 'omarchy', false],
      [GROK_BOT, 'Grok Bot', false],
    ]);
    expect(rows[2]).toMatchObject({ icon: 'grok', sub: 'Sends the text. No thread here' });
    expect(rows[0]!.icon).toBeUndefined();
  });

  it('shows the chip for Grok Bot alone when this is the only machine', () => {
    expect(newThreadRows([], { grokBot: true, now, hereName: 'omarchy' })!.map((r) => r.value)).toEqual([HERE, GROK_BOT]);
    expect(newThreadRows(undefined, { grokBot: true, now })!.map((r) => r.value)).toEqual([HERE, GROK_BOT]);
  });

  it('lists an unset Grok Bot disabled, naming this machine, when other machines show the chip anyway', () => {
    const row = newThreadRows([omarchy], { grokBot: false, now, hereName: 'omarchy' })!.at(-1)!;
    expect(row).toMatchObject({ value: GROK_BOT, disabled: true, sub: 'Not set up on omarchy' });
  });

  it('hides the chip with no other machine and no Grok Bot', () => {
    expect(newThreadRows([], { grokBot: false, now })).toBeNull();
    expect(newThreadRows(undefined, { grokBot: false, now })).toBeNull();
  });

  it('keeps Grok Bot picked while it is set up, and falls back to Settings default once it is not', () => {
    expect(newThreadPick(GROK_BOT, 'omarchy-id', [omarchy], true)).toBe(GROK_BOT);
    expect(newThreadPick(GROK_BOT, '', [], true)).toBe(GROK_BOT);
    expect(newThreadPick(GROK_BOT, 'omarchy-id', [omarchy], false)).toBe('omarchy-id');
    expect(newThreadPick(GROK_BOT, '', undefined, false)).toBe(HERE);
    expect(newThreadPick(null, 'omarchy-id', [omarchy], true)).toBe('omarchy-id');
    expect(newThreadPick('omarchy-id', '', [omarchy], true)).toBe('omarchy-id');
  });

  it('says To for Grok Bot and On for a machine', () => {
    expect(runOnPrefix(GROK_BOT)).toBe('To');
    expect(runOnPrefix(HERE)).toBe('On');
    expect(runOnPrefix('omarchy-id')).toBe('On');
  });

  it('stops a send with attachments instead of dropping them', () => {
    expect(grokBotBlock(0)).toBeNull();
    expect(grokBotBlock(1)).toBe('Grok Bot takes text only. Remove the attachment to send.');
    expect(grokBotBlock(3)).toBe('Grok Bot takes text only. Remove the 3 attachments to send.');
  });

  it('never names Grok Bot as a machine id or a default', () => {
    expect(runOnRows([omarchy], { now }).some((r) => r.value === GROK_BOT)).toBe(false);
    expect(runOnRows([omarchy], { now, asDefault: true }).some((r) => r.value === GROK_BOT)).toBe(false);
    expect(settingPick(GROK_BOT, [omarchy])).toBe(HERE);
  });
});
