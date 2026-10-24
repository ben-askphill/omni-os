// The terminal_excerpt kind as harness text (project.ts): output Ben selected in the thread's terminal, with the shell
// it came from and when. The text is quoted, never run.
import type { TerminalExcerpt } from '@omni/shared/message-context-terminal.ts';
import { userPossessive } from '../profile.ts';
import type { Projector } from './project.ts';

/**
 * Text as the block may carry it. The fence already holds backtick runs, and the body has no control characters, so
 * the one thing left that could pass for Omni's own framing is its tag: `<omni-context` and `</omni-context` are
 * written with `&lt;`, in the excerpt and in the directory's name.
 */
export const defang = (s: string) => s.replace(/<(\/?omni-context)/gi, '&lt;$1');

// The shell runs on Ben's Mac whichever harness the agent is, so the title says so instead of naming a path as if the
// agent could open it.
export const projectTerminalExcerpt: Projector<TerminalExcerpt> = (b) => ({
  title:
    `Terminal output, ${b.lines === 1 ? '1 line' : `${b.lines} lines`}, selected ${b.captured_at} in ${userPossessive()} terminal for this thread, on the Mac ` +
    `(a shell started in ${defang(b.cwd)}${b.pid ? `, pid ${b.pid}` : ''}). Plain text as the terminal showed it; none of it was run`,
  excerpt: { lang: 'text', text: defang(b.text) },
});
