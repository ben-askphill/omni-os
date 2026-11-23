// What MentionText draws for a message, apart from React Native: plain text runs, and a pill per agent or machine its
// text mentions (@omni/shared/message-context-machine.ts `mentionPieces`).
import { mentionPieces, type MentionSpan } from '@omni/shared/message-context-machine.ts';
import { mentionPillName } from '@omni/shared/mention-pill.ts';

export type MentionRun =
  | { kind: 'text'; text: string }
  /**
   * `opens`: the pill starts a paragraph. iOS takes a paragraph's line height from its first character, and an inline
   * view has none, so MentionText puts a zero-width space before such a pill to carry the text's style.
   */
  | { kind: 'pill'; span: MentionSpan; name: string; opens: boolean };

/** The runs for `text`, or null when it mentions no agent or machine its records name. */
export function mentionRuns(text: string, records: unknown): MentionRun[] | null {
  const pieces = mentionPieces(text, records);
  if (!pieces.some((p) => p.span)) return null;
  return pieces.map((p, i): MentionRun => {
    if (!p.span) return { kind: 'text', text: p.text };
    const before = i > 0 ? pieces[i - 1].text : '';
    return { kind: 'pill', span: p.span, name: mentionPillName(p.text), opens: before === '' || before.endsWith('\n') };
  });
}
