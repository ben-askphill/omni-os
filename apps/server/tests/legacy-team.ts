import { randomUUID } from 'node:crypto';
import type { startRunner } from './runner-boot.ts';

// A team as delegate_team made it before one-thread teams (ADR 0019, slice 6): a lead thread that waits, shown as
// running, with one member thread per part under it (source `team`, task id <lead>.<n>), and the lead's brief in its
// transcript. Nothing makes one any more. Teams already made keep their tree, and the runner still settles them
// (runner/queue.ts settleTeam), so the tests that cover that build one here, in a channel with no worktree.

type Runner = Awaited<ReturnType<typeof startRunner>>;

export interface LegacyTeamInput {
  channel: string;
  prompt: string;
  title?: string;
  parent_id?: string | null;
  task_id?: string | null;
  role?: string | null;
  tasks: { prompt: string; title?: string; role?: string | null }[];
}

export async function legacyTeam(H: Runner, input: LegacyTeamInput) {
  const { assembling, settleTeam } = await import('../runner/queue.ts');
  const { addEvent } = await import('../runner/state.ts');
  const channel = H.db.channels.get(input.channel)!;
  const id = randomUUID();
  const lead = H.db.threads.create({
    id,
    channel_id: channel.id,
    title: input.title ?? 'Team',
    status: 'running',
    role: input.role ?? null,
    model: 'sonnet',
    harness: 'claude-code',
    session_id: id,
    cwd: channel.base_dir!,
    branch: null,
    parent_id: input.parent_id ?? null,
    task_id: input.task_id ?? (input.parent_id ? `T-${id.slice(0, 4).toUpperCase()}` : null),
    source: 'conductor',
    automation: null,
  });
  addEvent(lead.id, 'user', { text: input.prompt, source: lead.source });
  // A member can finish before the last one is made; the lead settles once all of them exist.
  assembling.add(lead.id);
  const members = [];
  try {
    for (const [i, t] of input.tasks.entries()) {
      members.push(
        await H.runner.createThread({
          ...t,
          channel: lead.channel_id,
          role: t.role ?? input.role,
          parent_id: lead.id,
          task_id: lead.task_id ? `${lead.task_id}.${i + 1}` : null,
          source: 'team',
        }),
      );
    }
  } finally {
    assembling.delete(lead.id);
  }
  settleTeam(lead.id);
  return { lead: H.db.threads.get(lead.id)!, members };
}
