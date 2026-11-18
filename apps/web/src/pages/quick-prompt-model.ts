// The Quick Prompt's rules: what is sent where, which keys send, and when Wispr Flow's
// words have landed. Pure, so tests pin each one. The panel's page is QuickPrompt.tsx.
import type { QuickAskKey } from '@omni/shared/quick-ask.ts';
export { quickAskKey as quickPromptKey } from '@omni/shared/quick-ask.ts';

export const CONDUCTOR = 'conductor';

/**
 * How the last send went. `finishing`: Wispr Flow was told to stop and its words have not landed yet. `answering`: a
 * quick ask answering in the panel (components/QuickAnswer.tsx).
 */
export type QuickPromptPhase =
  | { kind: 'editing' }
  | { kind: 'answering'; id: string }
  | { kind: 'finishing' }
  | { kind: 'sending' }
  | { kind: 'sent'; thread: { id: string; title: string } }
  | { kind: 'failed'; message: string };

export interface QuickPromptThread {
  channel: string;
  prompt: string;
  role?: string;
  source: 'capture';
}

/**
 * The thread to start, or null with nothing to send. In the Conductor channel it runs as the Conductor, as the
 * new-thread composer does. `capture` marks it typed by Ben outside Omni.
 */
export function quickPromptThread(text: string, channel: string): QuickPromptThread | null {
  const prompt = text.trim();
  if (!prompt) return null;
  return { channel, prompt, ...(channel === CONDUCTOR ? { role: CONDUCTOR } : {}), source: 'capture' };
}

/** A quick ask from the panel: answered in place, with read-only tools (packages/shared/quick-ask.ts). */
export function quickPromptAsk(text: string, channel: string) {
  const prompt = text.trim();
  return prompt ? { channel, prompt, quick: true as const, source: 'capture' as const } : null;
}

export function canSend(text: string, phase: QuickPromptPhase): boolean {
  return phase.kind !== 'sending' && phase.kind !== 'finishing' && text.trim() !== '';
}

/** What a key does in the panel (quickPromptKey, shared with the phone's New sheet): ask here, or start a task. */
export type QuickPromptKey = QuickAskKey;

export const DICTATION_QUIET_MS = 600;
export const DICTATION_TIMEOUT_MS = 5000;

/**
 * Wispr Flow pastes its words a moment after it stops. Done once the text has changed and then stayed the same for
 * `quiet`, or after `timeout` with no change.
 */
export function dictationSettled(input: { before: string; text: string; lastEdit: number; start: number; now: number; quiet?: number; timeout?: number }): boolean {
  const { quiet = DICTATION_QUIET_MS, timeout = DICTATION_TIMEOUT_MS } = input;
  if (input.now - input.start >= timeout) return true;
  return input.text !== input.before && input.now - input.lastEdit >= quiet;
}

/**
 * Back to a fresh prompt for the next open. A draft stays; after a send or an ask the target goes back to the
 * Conductor. An answered ask is found again under Recent asks.
 */
export function reopened(phase: QuickPromptPhase, channel: string): { phase: QuickPromptPhase; channel: string } {
  return { phase: { kind: 'editing' }, channel: phase.kind === 'sent' || phase.kind === 'answering' ? CONDUCTOR : channel };
}

export const sentLabel = (title: string) => (title.trim() ? `Started “${title.trim()}”` : 'Started a thread');

/** The keys the panel answers to, for its keyboard footer. */
export const quickPromptHints = (mac: boolean) =>
  [
    [['↵'], 'ask'],
    [['⇧', '↵'], 'make a task'],
    [[mac ? '⌘' : 'Ctrl', '↵'], 'task and open'],
    [['esc'], 'close'],
  ] as const;
