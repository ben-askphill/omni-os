// Stdio MCP server every local thread gets (apps/server/sandbox.ts): ask_user_question, Omni's own AskUserQuestion,
// and request_secret, which asks the user for a credential the task needs. Each shows as a card in the thread and in
// Needs you; the call waits, polling the API, until the user acts. A secret's value goes from the card to Omni's
// secret store: it never comes through here, and the agent only ever gets the variable's name.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { setTimeout as sleep } from 'node:timers/promises';
import { z } from 'zod';
import { HEADER_MAX, OPTIONS_MAX, OPTIONS_MIN, QUESTIONS_MAX } from '@omni/shared/question.ts';
import { LABEL_MAX, REASON_MAX } from '@omni/shared/secret-request.ts';
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
      ({ id } = await call(`/threads/${SELF}/questions`, { method: 'POST', body: JSON.stringify({ questions }), signal: extra.signal }));
    } catch (err) {
      // A 400 says what to fix in the call.
      return refused((err as Error).message);
    }
    return text(await answerTo(`/threads/${SELF}/questions/${id}`, extra.signal));
  },
);

server.registerTool(
  'request_secret',
  {
    description:
      `Ask ${USER} for a secret your task needs and your environment does not have: an API key, a password, a token. ` +
      'Never ask for one in chat, and never have it pasted into the thread: the value would end up in the transcript. ' +
      `The request shows as a card in the thread and in Needs you, where ${USER} types the value. It goes into Omni's secret store ` +
      'under the env var `name`, and you never see it: the result names the variable, nothing more. ' +
      `Your turn waits on this call until ${USER} saves it, cancels, or sends a message instead, which can take hours. ` +
      'Once it is saved, end your turn with one short line: Omni starts your next turn in a fresh process with that variable set and tells you to go on. ' +
      'Use it as $NAME in commands, never print it. Check your environment first: a secret that is already set needs no request.',
    inputSchema: {
      name: z.string().describe("The env var the value goes into: UPPER_SNAKE_CASE, named for the service, like STRIPE_TEST_KEY. Not one of Omni's or the shell's own."),
      label: z.string().max(LABEL_MAX).describe(`What ${USER} is asked for, at most ${LABEL_MAX} characters, like "Stripe test secret key".`),
      scope: z.enum(['channel', 'global']).optional().describe("channel (the default): this channel's threads get it. global: every channel's threads do."),
      reason: z.string().max(REASON_MAX).optional().describe(`Why the task needs it, at most ${REASON_MAX} characters, shown on the card.`),
    },
  },
  async (input, extra) => {
    if (!SELF) return refused('Omni did not say which thread this is (OMNI_THREAD_ID is not set), so the request has nowhere to go.');
    let id: string;
    try {
      ({ id } = await call(`/threads/${SELF}/secret-requests`, { method: 'POST', body: JSON.stringify(input), signal: extra.signal }));
    } catch (err) {
      // A 400 says what to fix in the call: the name, the label, the scope.
      return refused((err as Error).message);
    }
    return text(await answerTo(`/threads/${SELF}/secret-requests/${id}`, extra.signal));
  },
);

const refused = (message: string) => ({ ...text(message), isError: true });

/** The text the agent reads once the user acts on the request at `path`. Polls until then; a call the harness cancels stops polling. */
async function answerTo(path: string, signal: AbortSignal): Promise<string> {
  for (;;) {
    try {
      const r = await call(`${path}?wait=${WAIT}`, { signal });
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
