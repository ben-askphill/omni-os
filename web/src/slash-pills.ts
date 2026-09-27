// A user message as the transcript shows it: plain runs of text, and a pill for each command it names.
import type { SlashHit, SlashRecord } from '../../shared/slash.ts';

export interface Piece {
  text: string;
  /** The command this piece names, shown as a pill. */
  hit?: SlashHit;
}

/**
 * The first `visible` characters of `text`, split at the commands `slash` names: the one it starts
 * with and its Mentions. Only a span that still points at a `/name` in what is shown becomes a pill.
 */
export function slashPieces(text: string, slash: SlashRecord | undefined, visible = text.length): Piece[] {
  const end = Math.min(visible, text.length);
  const hits = [...(slash?.command ? [slash.command] : []), ...(slash?.mentions ?? [])]
    .filter((h) => text[h.start] === '/' && h.start < h.end && h.end <= end)
    .sort((a, b) => a.start - b.start);
  const pieces: Piece[] = [];
  let at = 0;
  for (const h of hits) {
    if (h.start < at) continue;
    if (h.start > at) pieces.push({ text: text.slice(at, h.start) });
    pieces.push({ text: text.slice(h.start, h.end), hit: h });
    at = h.end;
  }
  if (at < end) pieces.push({ text: text.slice(at, end) });
  return pieces;
}
