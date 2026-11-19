// The "Ask first" approval card: a tool call apps/server/access.ts says needs a yes becomes a question event with
// `approval` set, so it streams, syncs, alerts and shows on every client like any question card, and the harness's
// call waits here for the answer. Allow in this thread and Always allow for <role> are kept as grants in the synced
// kv, so the other machine honours them too. ADR 0015.
import { randomUUID } from 'node:crypto';
import { approvalGrant, approvalQuestion, type ApprovalRequest } from '@omni/shared/access.ts';
import { ANSWER_EVENT, QUESTION_EVENT, questionsIn, type AnswerPayload, type QuestionPayload } from '@omni/shared/question.ts';
import { bus } from '../bus.ts';
import { threadDir } from '../config.ts';
import { events, kv, threads, type Channel, type Thread } from '../db.ts';
import { getCrew, type CrewRole } from '../crew.ts';
import { notifyNeedsInput } from '../push-sender.ts';
import { channelAccess, grantKey, judge, unrestricted, type ChannelAccess } from '../access.ts';
import { polled, settled } from './question-polls.ts';

/** How the gate writes its card and answers: runner/state.ts addEvent, passed in so this file stays out of the runner's import cycle. */
type AddEvent = (threadId: string, kind: string, payload: unknown) => unknown;

export type Permit = { allow: true } | { allow: false; message: string };

/** One tool call as a harness asks about it. */
export interface PermissionCall {
  tool: string;
  input: Record<string, unknown>;
}

/** What a harness session asks before a tool runs, for a thread whose channel is not full access. */
export interface PermissionGate {
  access: ChannelAccess;
  check(call: PermissionCall): Promise<Permit>;
  /** The session ended: approvals still waiting are dismissed, and their calls refused. */
  end(): void;
}

/** A waiting approval keeps its question marked as waited on, so an answer goes to the call, not into the thread. */
const KEEPALIVE_MS = 20_000;

const threadKey = (threadId: string) => `access-grants.thread.${threadId}`;
const roleKey = (channelId: string, role: string) => `access-grants.role.${channelId}.${role}`;
const grants = (key: string) => kv.get<string[] | null>(key) ?? [];
function grant(key: string, tool: string) {
  const had = grants(key);
  if (!had.includes(tool)) kv.set(key, [...had, tool]);
}

/** The tools "Always allow for <role>" lets run in a channel, by role, with the role's name. For Channel settings. */
export function roleGrants(channelId: string): { role: string; name: string; tools: string[] }[] {
  const prefix = `access-grants.role.${channelId}.`;
  return kv
    .list<string[] | null>(prefix)
    .map(([k, tools]) => {
      const role = k.slice(prefix.length);
      return { role, name: getCrew(role)?.name || role, tools: tools ?? [] };
    })
    .filter((g) => g.tools.length);
}

/** Take one tool, or all of a role's, out of its grants. */
export function revokeRoleGrant(channelId: string, role: string, tool?: string) {
  const key = roleKey(channelId, role);
  kv.set(key, tool ? grants(key).filter((t) => t !== tool) : []);
}

const REFUSED = 'The user did not allow this. Do not try it another way; go on without it or ask what to do.';
const ENDED = 'The run ended before the user answered, so this was not allowed.';

/** The gate for a thread, or null when it runs with full access: the harness then runs exactly as before levels. */
export function gateFor(thread: Thread, channel: Channel, role: CrewRole | undefined, addEvent: AddEvent): PermissionGate | null {
  const access = channelAccess(channel, role?.access);
  if (unrestricted(access)) return null;
  const waiting = new Map<string, (p: Permit) => void>();
  const roleName = role ? role.name || role.id : null;

  const ask = (request: ApprovalRequest): Promise<Permit> => {
    const id = randomUUID();
    const question = approvalQuestion(request, roleName);
    addEvent(thread.id, QUESTION_EVENT, { id, questions: [question], approval: request } satisfies QuestionPayload);
    const home = threads.home(thread.id);
    if (home !== thread.id) threads.setDone(home, false);
    settled(thread.id);
    notifyNeedsInput(thread.id, question.question);
    polled.set(id, Date.now());
    return new Promise<Permit>((resolve) => {
      const keep = setInterval(() => polled.set(id, Date.now()), KEEPALIVE_MS);
      keep.unref();
      const done = (p: Permit) => {
        clearInterval(keep);
        bus.off(`thread:${thread.id}`, onEvent);
        waiting.delete(id);
        polled.delete(id);
        resolve(p);
      };
      const onEvent = (e: { kind?: string; payload?: unknown }) => {
        if (e?.kind !== ANSWER_EVENT || typeof e.payload !== 'string') return;
        const a = JSON.parse(e.payload) as AnswerPayload;
        if (a.id !== id) return;
        const answer = a.answers?.[0] ?? null;
        const kind = a.state === 'answered' ? approvalGrant(answer) : null;
        if (kind === 'thread') grant(threadKey(thread.id), grantKey(request));
        if (kind === 'role' && role) grant(roleKey(channel.id, role.id), grantKey(request));
        if (kind) return done({ allow: true });
        const note = answer?.other;
        done({ allow: false, message: note ? `The user did not allow this and said: "${note}". Do not try it another way.` : a.state === 'dismissed' ? 'The user moved on without allowing this. Read their message and do not try it another way.' : REFUSED });
      };
      bus.on(`thread:${thread.id}`, onEvent);
      waiting.set(id, done);
    });
  };

  return {
    access,
    async check(call) {
      const verdict = judge(access, { tool: call.tool, input: call.input, cwd: thread.cwd, threadDir: threadDir(thread.id) });
      if (verdict.decision === 'allow') return { allow: true };
      if (verdict.decision === 'deny') return { allow: false, message: verdict.reason };
      const key = grantKey(verdict.request);
      if (grants(threadKey(thread.id)).includes(key) || (role && grants(roleKey(channel.id, role.id)).includes(key))) return { allow: true };
      return ask({ ...verdict.request, ...(role && { role: role.id }) });
    },
    end() {
      const open = questionsIn(events.questions(thread.id)).filter((q) => q.state === 'pending' && q.approval && waiting.has(q.id));
      for (const q of open) addEvent(thread.id, ANSWER_EVENT, { id: q.id, state: 'dismissed', answers: null, via: 'tool' } satisfies AnswerPayload);
      for (const done of [...waiting.values()]) done({ allow: false, message: ENDED });
      if (open.length) settled(thread.id);
    },
  };
}
