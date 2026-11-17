// The channel stack: one overlapping avatar per channel a job's delegated threads work in, so a Conductor job shows at
// a glance which channels it spans. The thread header draws it (channelStack), and so do the job's Inbox card, sidebar
// row and phone Activity row (channelRollup). apps/web/src/components/ChannelStack.tsx draws both.
import { isWorking, type WorkState } from './delegate-count.ts';

/** The parts of a delegated thread the stack reads. */
export interface StackThread extends WorkState {
  channel_id: string;
}

/** One channel in the stack: how many of the delegated threads work there, and how many of those are at work. */
export interface StackChannel {
  id: string;
  threads: number;
  working: number;
}

export interface ChannelStack {
  /** Every channel, in the order the thread first delegated into it. */
  channels: StackChannel[];
  /** The channels drawn as avatars. */
  shown: StackChannel[];
  /** How many channels the +N chip stands for; 0 when every channel has its avatar. */
  more: number;
}

/** The most discs the stack draws, the +N chip included. */
export const STACK_CAP = 4;

/** Past `cap` channels, the last disc is a +N chip for the rest. */
function capped(channels: StackChannel[], cap: number): ChannelStack {
  const shown = channels.length > cap ? channels.slice(0, Math.max(1, cap - 1)) : channels;
  return { channels, shown, more: channels.length - shown.length };
}

/** Each channel the threads work in, once, with its counts, in the order they first appear. */
function byChannel(threads: readonly StackThread[]): StackChannel[] {
  const by = new Map<string, StackChannel>();
  for (const t of threads) {
    let c = by.get(t.channel_id);
    if (!c) {
      c = { id: t.channel_id, threads: 0, working: 0 };
      by.set(t.channel_id, c);
    }
    c.threads++;
    if (isWorking(t)) c.working++;
  }
  return [...by.values()];
}

/**
 * The stack for a thread's delegated threads, or null when none of them works outside `own`, the thread's own channel.
 * Each channel shows once, finished threads included, so the stack keeps the job's span after it ends. Its own channel
 * is in the stack only when a delegated thread works there too. Past `cap` channels, the last disc is a +N chip.
 */
export function channelStack(threads: readonly StackThread[], own: string, cap = STACK_CAP): ChannelStack | null {
  const channels = byChannel(threads);
  if (!channels.some((c) => c.id !== own)) return null;
  return capped(channels, cap);
}

/**
 * The channels a job touches, for its Inbox card (`lead`) and its sidebar and phone rows. `lead`: its own channel comes
 * first whether or not a delegated thread works there, since the stack takes the place of that channel's avatar.
 * Without it, its own channel is left out, as the row already shows it. Null when nothing under the job works outside
 * `own`, so a job that stayed in its channel keeps its single avatar. Past `cap` channels, the last disc is a +N chip.
 */
export function channelRollup(threads: readonly StackThread[], own: string, { lead }: { lead: boolean }, cap = STACK_CAP): ChannelStack | null {
  const channels = byChannel(threads);
  const others = channels.filter((c) => c.id !== own);
  if (!others.length) return null;
  if (!lead) return capped(others, cap);
  return capped([channels.find((c) => c.id === own) ?? { id: own, threads: 0, working: 0 }, ...others], cap);
}

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

/** What one channel's entry in the label says beside its name. Nothing for the job's own channel with none of its threads. */
function detail(c: StackChannel): string {
  if (c.threads <= 1) return c.working ? ' (working)' : '';
  return c.working ? ` (${c.threads} threads, ${c.working} working)` : ` (${c.threads} threads)`;
}

const names = (stack: ChannelStack, name: (id: string) => string) => stack.channels.map((c) => `#${name(c.id)}${detail(c)}`).join(', ');

/** The stack's tooltip and label: every channel by name, with its thread count and how many are at work. */
export function channelStackLabel(stack: ChannelStack, name: (id: string) => string): string {
  return `Delegated to ${plural(stack.channels.length, 'channel')}: ${names(stack, name)}`;
}

/** The tooltip of a card's stack, its own channel first: every channel the job works in, with the same counts. */
export function channelRollupLabel(stack: ChannelStack, name: (id: string) => string): string {
  return `Works in ${plural(stack.channels.length, 'channel')}: ${names(stack, name)}`;
}
