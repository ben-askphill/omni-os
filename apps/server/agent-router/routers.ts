// The two routers the shadow log compares with the Conductor (agent-router/shadow.ts): Jev, TypeSafe's decision
// model, and Haiku. Each gets one message and the agents on offer, and answers with its picks, most likely first.
// The prompts are the ones the routing research measured on Omni's own history: Jev's "variant B" (one yes/no
// question per agent, with true and false criteria) and Haiku's zero-shot pick with a stated confidence.

/** An agent a router may pick: what list_crew shows the Conductor. */
export interface RouterAgent {
  id: string;
  name: string;
  description: string;
}

/** The pick that leaves the message to the Conductor: it answers itself and delegates nothing. */
export const SELF = 'conductor-self';

/** The longest message either router reads, as the research measured them. */
const MAX_CHARS = 800;

/** Haiku's answer, or Jev's: the picks in order, how sure it is of the first, and what the call cost. */
export interface RouterAnswer {
  model: string;
  picks: string[];
  confidence: number | null;
  /** Jev's yes probability per question (agent ids and SELF). */
  scores?: Record<string, number>;
  tokens?: number;
  costUsd?: number;
}

const SELF_CRITERIA =
  'A quick question, what is running, a thread or PR status, a fact, a light lookup, a short follow-up, a yes/no, a go-ahead or an acknowledgement in an ongoing chat.';
const WORKSPACE =
  'Omni OS, an agent workspace. The user sends messages to the Conductor, a front agent that answers quick questions itself and delegates real work to other agents, each in its own thread.';

export const JEV_MODEL = 'jev-1.14.0';
/** A Jev pick besides the first one: an agent it says yes to this surely. */
const JEV_ALSO = 0.7;

/** One Jev yes/no question, with what counts as yes and as no. */
interface JevQuestion {
  type: 'noul';
  instructions: string;
  criteria: { true: string; false: string };
}

/** Jev's questions, by the answer they stand for: whether the Conductor answers itself, then one per agent. */
export function jevQuestions(agents: RouterAgent[]): Record<string, JevQuestion> {
  return {
    [SELF]: {
      type: 'noul',
      instructions: 'Should the Conductor answer this `message` itself, without delegating it to another agent?',
      criteria: { true: SELF_CRITERIA, false: 'Real work that needs its own thread: writing code, research, admin, store work, a review or design work.' },
    },
    ...Object.fromEntries(
      agents.map((a) => [
        a.id,
        {
          type: 'noul',
          instructions: `Should this \`message\` be delegated to the ${a.name} agent, in a thread of its own?`,
          criteria: {
            true: `The message asks for work this agent does: ${a.description || a.name}`,
            false: 'A quick question or follow-up the Conductor can answer itself, or work that fits another kind of agent better.',
          },
        },
      ]),
    ),
  };
}

/**
 * Jev's picks from its yes probabilities: the most likely answer first (SELF included), then any other agent it says
 * yes to at JEV_ALSO or above. The first one's probability is the confidence.
 */
export function jevPicks(scores: Record<string, number>): { picks: string[]; confidence: number | null } {
  const order = Object.keys(scores).sort((a, b) => scores[b] - scores[a]);
  const top = order[0];
  if (!top) return { picks: [], confidence: null };
  const also = order.filter((k) => k !== top && k !== SELF && scores[k] >= JEV_ALSO);
  return { picks: [top, ...also], confidence: scores[top] };
}

/** An error's text for the log, without `secret` and cut short. */
export function scrubbed(text: string, secret?: string | null): string {
  const clean = secret ? text.split(secret).join('[redacted]') : text;
  return clean.replace(/\s+/g, ' ').trim().slice(0, 300);
}

/** One Jev call. Throws on a failed request or an answer without every question; the message says why. */
export async function askJev(
  text: string,
  agents: RouterAgent[],
  key: string,
  opts: { url: string; timeoutMs: number; fetch?: typeof fetch },
): Promise<RouterAnswer> {
  const questions = jevQuestions(agents);
  const res = await (opts.fetch ?? fetch)(`${opts.url.replace(/\/$/, '')}/v1/systemone`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: JEV_MODEL, state: { workspace: WORKSPACE, message: text.slice(0, MAX_CHARS) }, questions }),
    signal: AbortSignal.timeout(opts.timeoutMs),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
  const body = (await res.json()) as { model?: string; answers?: Record<string, { noul?: unknown }>; usage?: { input_tokens?: number } };
  const scores: Record<string, number> = {};
  for (const id of Object.keys(questions)) {
    const p = body.answers?.[id]?.noul;
    if (typeof p !== 'number') throw new Error(`no answer for "${id}"`);
    scores[id] = p;
  }
  return { model: body.model ?? JEV_MODEL, ...jevPicks(scores), scores, tokens: body.usage?.input_tokens };
}

export const HAIKU_MODEL = 'claude-haiku-5-5';

/** Haiku's system prompt: the agents with their descriptions, the Conductor answering itself first. */
export function haikuSystem(agents: RouterAgent[]): string {
  const lines = [
    `- ${SELF}: The Conductor answers itself, starts no thread: quick questions, what is running, a thread or PR status, a fact, a light lookup, a short follow-up, yes/no or acknowledgement in an ongoing chat.`,
    ...agents.map((a) => `- ${a.id}: ${a.name}. ${a.description}`.trimEnd()),
  ];
  return (
    'You route messages a user sends to the Conductor of an agent workspace. Pick the agent(s) that should handle the message, most important first. ' +
    `Pick several only when the message clearly needs several kinds of work. Agents:\n${lines.join('\n')}`
  );
}

export function haikuSchema(agents: RouterAgent[]) {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['agents', 'confidence'],
    properties: {
      agents: { type: 'array', items: { type: 'string', enum: [SELF, ...agents.map((a) => a.id)] } },
      confidence: { type: 'number', description: 'Probability from 0 to 1 that the first agent is the right pick' },
    },
  };
}

export const haikuPrompt = (text: string) => `<message>\n${text.slice(0, MAX_CHARS)}\n</message>`;

/**
 * Haiku's picks from the CLI's JSON result (aux.ts askClaude with a schema): `structured_output`, else its `result`
 * text as JSON. Agents the offer did not have are dropped. Throws when there is no usable answer.
 */
export function haikuAnswer(out: string | null, agents: RouterAgent[]): RouterAnswer {
  if (out == null) throw new Error('the Haiku call failed or timed out');
  let env: { is_error?: boolean; result?: string; structured_output?: unknown; total_cost_usd?: number };
  try {
    env = JSON.parse(out);
  } catch {
    throw new Error('the Haiku call answered no JSON');
  }
  if (env.is_error) throw new Error(`the Haiku call failed: ${String(env.result ?? '').slice(0, 200)}`);
  let answer = env.structured_output as { agents?: unknown; confidence?: unknown } | undefined;
  if (!answer && typeof env.result === 'string') {
    try {
      answer = JSON.parse(env.result);
    } catch {
      answer = undefined;
    }
  }
  const known = new Set([SELF, ...agents.map((a) => a.id)]);
  const picks = Array.isArray(answer?.agents) ? [...new Set(answer.agents.filter((a): a is string => typeof a === 'string' && known.has(a)))] : [];
  if (!picks.length) throw new Error('the Haiku call picked no agent');
  const c = answer?.confidence;
  return {
    model: HAIKU_MODEL,
    picks,
    confidence: typeof c === 'number' && Number.isFinite(c) ? Math.min(1, Math.max(0, c)) : null,
    costUsd: typeof env.total_cost_usd === 'number' ? env.total_cost_usd : undefined,
  };
}
