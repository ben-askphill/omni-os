import type { ReactNode } from 'react';

/**
 * A transcript turn (web/src Transcript.tsx). role="user": right-aligned 22px bubble (top-right corner 8px) on
 * surface-2, meta line above (source · time). role="agent": markdown (.om-md, 14.5/1.62) with no bubble; an optional
 * caption meta line (crew mark · author · model · time). Agent output is a document, never a bubble.
 * @startingPoint section="Thread" subtitle="User bubble + agent markdown" viewport="760x260"
 */
export interface MessageProps {
  role?: 'user' | 'agent';
  author?: string;
  crew?: 'conductor' | 'researcher' | 'builder' | 'store-ops' | 'inbox';
  model?: string;
  time?: string;
  /** e.g. "from Conductor" on a crew thread's first message */
  source?: string;
  children?: ReactNode;
}
export function Message(props: MessageProps): JSX.Element;

/** End-of-turn rule: "DONE IN 3M 41S · 12 TURNS" between hairlines. */
export function ResultLine(props: { children?: ReactNode; ok?: boolean }): JSX.Element;

/**
 * A run switch between turns, in the result line's quiet rule: the refresh icon and the switch, with the handover's
 * progress under it. Copy comes from packages/shared/run-switch.ts (switchText, handoverNote):
 * - same harness: "Switched to effort high", "Switched to Sonnet 5.5, default effort" (no note)
 * - another harness: "Handing over from Claude Code (Opus 5.5) to Codex (GPT-6-Luna)", note "Codex reads the thread so
 *   far with your next message." until it runs, then "Handover complete. Codex read 11 entries into a new session."
 * - replaced before it ran: note "Replaced by a later switch."; back before anything ran: "Switched back to ..., which
 *   continues its own session"
 * Never a status pop: a switch is Ben's choice, not an agent's state.
 */
export function SwitchLine(props: {
  children?: ReactNode;
  /** The quiet line under it. */
  note?: ReactNode;
  /** A handover the running turn has not picked up yet: shows the loader. */
  pending?: boolean;
}): JSX.Element;
