// The channel stack in a thread's header: one overlapping avatar per channel its delegated threads work in, so a
// Conductor job shows at a glance which channels it spans. The web header and the phone header draw it
// (apps/web/src/components/ChannelStack.tsx).
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

/**
 * The stack for a thread's delegated threads, or null when none of them works outside `own`, the thread's own channel.
 * Each channel shows once, finished threads included, so the stack keeps the job's span after it ends. Its own channel
 * is in the stack only when a delegated thread works there too. Past `cap` channels, the last disc is a +N chip.
 */
export function channelStack(threads: readonly StackThread[], own: string, cap = STACK_CAP): ChannelStack | null {
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
  const channels = [...by.values()];
  if (!channels.some((c) => c.id !== own)) return null;
  const shown = channels.length > cap ? channels.slice(0, Math.max(1, cap - 1)) : channels;
  return { channels, shown, more: channels.length - shown.length };
}

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

/** What one channel's entry in the label says beside its name. */
function detail(c: StackChannel): string {
  if (c.threads === 1) return c.working ? ' (working)' : '';
  return c.working ? ` (${c.threads} threads, ${c.working} working)` : ` (${c.threads} threads)`;
}

/** The stack's tooltip and label: every channel by name, with its thread count and how many are at work. */
export function channelStackLabel(stack: ChannelStack, name: (id: string) => string): string {
  const list = stack.channels.map((c) => `#${name(c.id)}${detail(c)}`).join(', ');
  return `Delegated to ${plural(stack.channels.length, 'channel')}: ${list}`;
}
