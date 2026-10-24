// How the Web UI shows a terminal_excerpt (packages/shared/message-context-terminal.ts): which shell the text came
// from, when Ben selected it, and the text as it was then.
import type { TerminalExcerpt } from '@omni/shared/message-context-terminal.ts';
import { fullDate, plural, shortPath } from '../format.ts';
import type { ContextView } from './views.ts';

function TerminalExcerptDetail({ body: b }: { body: TerminalExcerpt }) {
  return (
    <div className="min-w-0">
      <div className="truncate font-mono text-[12px] text-fg" title={b.cwd}>
        {shortPath(b.cwd)}
      </div>
      <div className="mt-0.5 text-[11.5px] text-fg-2">
        {plural(b.lines, 'line')} selected {fullDate(b.captured_at)}
      </div>
      {b.pid && <div className="truncate font-mono text-[11px] text-fg-4">shell pid {b.pid}</div>}
      <div className="scroll-thin mt-2 max-h-64 overflow-auto rounded-xl bg-[#141518] shadow-[inset_0_0_0_1px_var(--line)]">
        <pre className="min-w-max px-3 py-2 font-mono text-[11.5px] leading-[1.6] text-[#eceae5]">{b.text}</pre>
      </div>
    </div>
  );
}

export const terminalExcerptView: ContextView<TerminalExcerpt> = { icon: 'terminal', Detail: TerminalExcerptDetail };
