// The Quick Prompt's rules (OmniKit's QuickPromptModel): what is sent where, which keys send, and when Wispr Flow's
// words have landed. Pure, so tests pin each one. The panel's page is QuickPrompt.tsx.

export const CONDUCTOR = 'conductor';

/** How the last send went. `finishing`: Wispr Flow was told to stop and its words have not landed yet. */
export type QuickPromptPhase =
  | { kind: 'editing' }
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

export function canSend(text: string, phase: QuickPromptPhase): boolean {
  return phase.kind !== 'sending' && phase.kind !== 'finishing' && text.trim() !== '';
}

/** Return sends, Cmd-Return (Ctrl-Return off the Mac) sends and opens the thread, Shift-Return is a new line. */
export function quickPromptKey(e: { key: string; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; isComposing?: boolean; keyCode?: number }): 'send' | 'send-open' | null {
  if (e.key !== 'Enter' || e.isComposing || e.keyCode === 229 || e.altKey || e.shiftKey) return null;
  return e.metaKey || e.ctrlKey ? 'send-open' : 'send';
}

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

/** Back to a fresh prompt for the next open. A draft stays; after a send the target goes back to the Conductor. */
export function reopened(phase: QuickPromptPhase, channel: string): { phase: QuickPromptPhase; channel: string } {
  return { phase: { kind: 'editing' }, channel: phase.kind === 'sent' ? CONDUCTOR : channel };
}

export const sentLabel = (title: string) => (title.trim() ? `Started “${title.trim()}”` : 'Started a thread');

export const editingHint = (mac: boolean) => `Return to send, ${mac ? '⌘Return' : 'Ctrl+Return'} to send and open, Esc to close`;
