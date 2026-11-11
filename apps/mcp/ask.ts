// Stdio MCP server every local thread gets (apps/server/sandbox.ts): ask_user_question, Omni's own AskUserQuestion.
// The questions show as a card in the thread and in Needs you; the call waits, polling the API, until the user acts.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { setTimeout as sleep } from 'node:timers/promises';
import { z } from 'zod';
import { HEADER_MAX, OPTIONS_MAX, OPTIONS_MIN, QUESTIONS_MAX } from '@omni/shared/question.ts';
import { ApiError, call, SELF, text } from './api.ts';

/** Seconds each poll waits on the server. Under its 30s cap and under the 35s it counts a waiter as alive. */
const WAIT = 25;
/** Between polls that could not reach Omni. */
const RETRY_MS = 2000;

const USER = process.env.OMNI_USER || 'the user';

const option = z.object({
  label: z.string().describe('1 to 5 words, shown bold.'),
  description: z.string().describe('One line under the label: what this choice means or what follows from it.'),
});

const question = z.object({
  question: z.string().describe('The full question, ending with a question mark.'),
  header: z.string().max(HEADER_MAX).optional().describe(`A short tag shown with the question, at most ${HEADER_MAX} characters, like "Q4 focus".`),
  options: z
    .array(option)
    .min(OPTIONS_MIN)
    .max(OPTIONS_MAX)
    .describe(`${OPTIONS_MIN} to ${OPTIONS_MAX} distinct choices, the one you recommend first. Never add "Other": the card always offers it.`),
  multiSelect: z.boolean().optional().describe('true when more than one option can apply. Default false.'),
});

const server = new McpServer({ name: 'omni-ask', version: '0.1.0' });

server.registerTool(
  'ask_user_question',
  {
    description:
      `Ask ${USER} 1 to ${QUESTIONS_MAX} multiple-choice questions and wait for the answers. Use it at a real fork only ${USER} can settle: ` +
      'an ambiguous requirement, a choice between approaches with different tradeoffs, a preference, a go-ahead. ' +
      'Not for what you can find out by reading or running things, and not to ask permission for routine steps. ' +
      `The questions show as a card in the thread and in Needs you, where ${USER} can always type an answer of their own, so never offer "Other". ` +
      `Your turn waits on this call until ${USER} answers or skips, which can take hours. If they send a message instead, it tells you to read that message.`,
    inputSchema: { questions: z.array(question).min(1).max(QUESTIONS_MAX) },
  },
  async ({ questions }, extra) => {
    if (!SELF) return refused('Omni did not say which thread this is (OMNI_THREAD_ID is not set), so the questions have nowhere to go.');
    let id: string;
    try {
      ({ id } = await call<{ id: string }>(`/threads/${SELF}/questions`, { method: 'POST', body: JSON.stringify({ questions }), signal: extra.signal }));
    } catch (err) {
      // A 400 says what to fix in the call.
      return refused((err as Error).message);
    }
    return text(await answerTo(id, extra.signal));
  },
);

const refused = (message: string) => ({ ...text(message), isError: true });

/** The text the agent reads once the user acts. Polls until then; a call the harness cancels stops polling. */
async function answerTo(id: string, signal: AbortSignal): Promise<string> {
  for (;;) {
    try {
      const r = await call<{ state: string; text: string }>(`/threads/${SELF}/questions/${id}?wait=${WAIT}`, { signal });
      if (r.state !== 'pending') return r.text;
    } catch (err) {
      if (signal.aborted || (err instanceof ApiError && err.status < 500)) throw err;
      // Omni is restarting or busy: try again.
      await sleep(RETRY_MS, undefined, { signal });
    }
  }
}

// The harness closed our stdin: it is gone, so stop polling for it.
process.stdin.on('end', () => process.exit(0));

await server.connect(new StdioServerTransport());
