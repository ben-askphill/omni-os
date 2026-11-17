import { describe, expect, it } from 'vitest';
import { channelRollup, channelRollupLabel, channelStack, channelStackLabel, STACK_CAP } from '../channel-stack.ts';

const kid = (channel_id: string, status = 'done', delegating = false) => ({ channel_id, status, delegating });
const ids = (s: { id: string }[]) => s.map((c) => c.id);

describe('channelStack', () => {
  it('is null for a thread that delegated nothing', () => {
    expect(channelStack([], 'conductor')).toBeNull();
  });

  it("is null when every delegated thread works in the thread's own channel", () => {
    expect(channelStack([kid('conductor'), kid('conductor', 'running')], 'conductor')).toBeNull();
  });

  it('shows each channel once, in the order the thread first delegated into it', () => {
    const s = channelStack([kid('omni-os'), kid('volero'), kid('omni-os', 'running'), kid('patta'), kid('volero')], 'conductor')!;
    expect(ids(s.shown)).toEqual(['omni-os', 'volero', 'patta']);
    expect(s.more).toBe(0);
    expect(s.channels.find((c) => c.id === 'omni-os')).toEqual({ id: 'omni-os', threads: 2, working: 1 });
  });

  it('keeps its own channel when a delegated thread also works there', () => {
    const s = channelStack([kid('conductor'), kid('omni-os')], 'conductor')!;
    expect(ids(s.shown)).toEqual(['conductor', 'omni-os']);
  });

  it('shows one channel on its own', () => {
    const s = channelStack([kid('omni-os')], 'conductor')!;
    expect(ids(s.shown)).toEqual(['omni-os']);
    expect(s.more).toBe(0);
  });

  it(`draws up to ${STACK_CAP} avatars, and past that the last disc is a +N chip`, () => {
    const four = channelStack(['a', 'b', 'c', 'd'].map((c) => kid(c)), 'conductor')!;
    expect(ids(four.shown)).toEqual(['a', 'b', 'c', 'd']);
    expect(four.more).toBe(0);
    const six = channelStack(['a', 'b', 'c', 'd', 'e', 'f', 'a'].map((c) => kid(c)), 'conductor')!;
    expect(ids(six.shown)).toEqual(['a', 'b', 'c']);
    expect(six.more).toBe(3);
    expect(six.channels).toHaveLength(6);
  });

  it('counts a thread waiting on its own delegates as working, and finished threads as not', () => {
    const s = channelStack([kid('omni-os', 'done', true), kid('omni-os', 'queued'), kid('omni-os', 'stopped')], 'conductor')!;
    expect(s.channels[0]).toEqual({ id: 'omni-os', threads: 3, working: 2 });
  });
});

describe('channelStackLabel', () => {
  it('names every channel, hidden ones too, with its thread count and how many work', () => {
    const s = channelStack([kid('omni-os', 'running'), kid('omni-os'), kid('volero'), kid('patta', 'running'), kid('acne'), kid('pink')], 'conductor')!;
    const names: Record<string, string> = { 'omni-os': 'omni-os', volero: 'Volero', patta: 'Patta', acne: 'Acne Studios', pink: 'Pink Gellac' };
    expect(channelStackLabel(s, (id) => names[id] ?? id)).toBe(
      'Delegated to 5 channels: #omni-os (2 threads, 1 working), #Volero, #Patta (working), #Acne Studios, #Pink Gellac',
    );
  });

  it('says channel for one', () => {
    expect(channelStackLabel(channelStack([kid('volero'), kid('volero')], 'conductor')!, (id) => id)).toBe('Delegated to 1 channel: #volero (2 threads)');
  });
});

describe('channelRollup', () => {
  const lead = { lead: true };
  const row = { lead: false };

  it('is null for a job that delegated nothing, or only into its own channel, so its card keeps its single avatar', () => {
    for (const opts of [lead, row]) {
      expect(channelRollup([], 'conductor', opts)).toBeNull();
      expect(channelRollup([kid('conductor'), kid('conductor', 'running')], 'conductor', opts)).toBeNull();
    }
  });

  it('puts its own channel first on the card, though no delegated thread works there', () => {
    const s = channelRollup([kid('acne')], 'conductor', lead)!;
    expect(ids(s.shown)).toEqual(['conductor', 'acne']);
    expect(s.channels[0]).toEqual({ id: 'conductor', threads: 0, working: 0 });
  });

  it('shows each channel once, in the order the job delegated into it, with its own channel first once', () => {
    const s = channelRollup([kid('volero'), kid('conductor', 'running'), kid('pink'), kid('volero', 'running'), kid('conductor')], 'conductor', lead)!;
    expect(ids(s.shown)).toEqual(['conductor', 'volero', 'pink']);
    expect(s.channels[0]).toEqual({ id: 'conductor', threads: 2, working: 1 });
    expect(s.channels[1]).toEqual({ id: 'volero', threads: 2, working: 1 });
  });

  it('leaves its own channel out on a row, even when a delegated thread works there', () => {
    const s = channelRollup([kid('conductor'), kid('acne'), kid('volero'), kid('acne')], 'conductor', row)!;
    expect(ids(s.shown)).toEqual(['acne', 'volero']);
    expect(s.channels.map((c) => c.id)).not.toContain('conductor');
  });

  it(`caps at ${STACK_CAP} discs: past that, three avatars and a +N chip, its own channel still first`, () => {
    const five = ['acne', 'volero', 'pink', 'kamera', 'patta'].map((c) => kid(c));
    const card = channelRollup(five, 'conductor', lead)!;
    expect(ids(card.shown)).toEqual(['conductor', 'acne', 'volero']);
    expect(card.more).toBe(3);
    expect(card.channels).toHaveLength(6);
    const rowStack = channelRollup(five, 'conductor', row)!;
    expect(ids(rowStack.shown)).toEqual(['acne', 'volero', 'pink']);
    expect(rowStack.more).toBe(2);
    const four = channelRollup(['acne', 'volero', 'pink'].map((c) => kid(c)), 'conductor', lead)!;
    expect(ids(four.shown)).toEqual(['conductor', 'acne', 'volero', 'pink']);
    expect(four.more).toBe(0);
  });
});

describe('channelRollupLabel', () => {
  const names: Record<string, string> = { conductor: 'Conductor', volero: 'Volero', pink: 'Pink Gellac' };
  const name = (id: string) => names[id] ?? id;

  it('names its own channel first, without counts when none of its threads work there', () => {
    const s = channelRollup([kid('volero'), kid('volero', 'running'), kid('pink')], 'conductor', { lead: true })!;
    expect(channelRollupLabel(s, name)).toBe('Works in 3 channels: #Conductor, #Volero (2 threads, 1 working), #Pink Gellac');
  });

  it('counts the threads that work in its own channel', () => {
    const s = channelRollup([kid('conductor', 'running'), kid('volero')], 'conductor', { lead: true })!;
    expect(channelRollupLabel(s, name)).toBe('Works in 2 channels: #Conductor (working), #Volero');
  });
});
