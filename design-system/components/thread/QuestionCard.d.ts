/**
 * Question card: what an agent asked with Omni's ask_user_question tool, in the thread where it asked. 1 to 4
 * questions, each 2 to 4 options plus a free-text Other the card always adds. Pending: a 22px surface card with a
 * surface-2 header (header tag, question, pager "1 of 4"), radio rows (checkbox rows when multiSelect), bold label
 * plus a one-line description, Other with a field, and Skip plus an ink Next (Send on the last page) with a ⌘↵ hint.
 * A vermilion "Needs your input" pill sits under it. Once Ben acts it collapses to a read-only summary.
 * Keyboard in the apps: ↑/↓ rows, Space toggles, ←/→ pages, ⌘↵ Next or Send.
 * @startingPoint section="Thread" subtitle="Agent asks you, pending and answered" viewport="760x560"
 */
export interface QuestionOption {
  label: string;
  description: string;
}
export interface Question {
  question: string;
  /** At most 12 characters. */
  header?: string;
  options: QuestionOption[];
  multiSelect: boolean;
}
/** One per question. Null: Ben skipped that one. */
export type Answer = { selected: string[]; other: string | null } | null;
export interface QuestionCardProps {
  questions: Question[];
  answers?: Answer[] | null;
  state?: 'pending' | 'answered' | 'skipped' | 'dismissed';
  /** Phone layout: 44px rows and buttons, no ⌘↵ hint. */
  touch?: boolean;
  onSend?: (answers: Answer[]) => void;
}
export function QuestionCard(props: QuestionCardProps): JSX.Element;
