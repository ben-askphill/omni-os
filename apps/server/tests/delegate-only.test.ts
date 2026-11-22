import { describe, it, expect } from 'vitest';
import { startRunner } from './runner-boot.ts';

// The Conductor is delegate-only: it routes work to crew threads and has no tools to do it itself.
const r = await startRunner();
const { buildSystemPrompt } = await import('../runner/prompts.ts');
const { getCrew } = await import('../crew.ts');
const { userName } = await import('../profile.ts');

/** One `## <title>` section of a system prompt, up to the next one. */
const section = (prompt: string, title: string) => {
  const start = prompt.indexOf(`## ${title}\n`);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = prompt.indexOf('\n\n## ', start);
  return prompt.slice(start, end < 0 ? undefined : end);
};

describe('a delegate-only role', () => {
  it('runs Claude Code without the tools that do work', async () => {
    const t = await r.start('THINK:1', { role: 'conductor' });
    await r.untilResults(t.id, 1);
    const args: string[] = r.spawns(t.id)[0].args;
    const denied = args[args.indexOf('--disallowedTools') + 1].split(',');
    for (const tool of ['AskUserQuestion', 'Bash', 'Edit', 'Write', 'Agent', 'mcp__omni-browser']) expect(denied).toContain(tool);
    expect(denied).not.toContain('Read');
  });

  it('keeps every tool for a role that does the work', async () => {
    const t = await r.start('THINK:1', { role: 'builder' });
    await r.untilResults(t.id, 1);
    const args: string[] = r.spawns(t.id)[0].args;
    expect(args[args.indexOf('--disallowedTools') + 1]).toBe('AskUserQuestion');
  });

  it('answers quick asks itself, delegates real work, and gets no browser or artifact instructions', async () => {
    const t = await r.start('THINK:1');
    await r.untilResults(t.id, 1);
    const thread = r.thread(t.id);
    const channel = r.db.channels.get('scratch')!;
    const conductor = buildSystemPrompt(thread, channel, getCrew('conductor'));
    expect(conductor).toContain('Answer quick asks yourself, in this thread, and start no thread for them');
    expect(conductor).toContain('no brief, no folder question');
    // A report shows in place and wakes it only with follow_up.
    expect(conductor).toContain('a report wakes you only when you passed follow_up: true');
    expect(conductor).not.toContain('however small');
    expect(conductor).not.toContain('## Browser');
    expect(conductor).not.toContain('## Artifacts');
    expect(conductor).not.toContain('when the user asks you to hand work');

    const builder = buildSystemPrompt(thread, channel, getCrew('builder'));
    expect(builder).toContain('## Artifacts');
    expect(builder).not.toContain('Answer quick asks yourself');
    expect(builder).not.toContain('follow_up');

    // A usage scan's lead has the omni tools to save what Ben picks, but does its own analysis: no delegation rules.
    const scan = buildSystemPrompt(thread, channel, getCrew('usage-scan'));
    expect(scan).not.toContain('## Thread delegation');
    expect(scan).not.toContain('Answer quick asks yourself');
    expect(scan).toContain('never call delegate or delegate_team');
    expect(scan).not.toContain('## Browser');
  });

  it('seats an agent first for real work, as the Conductor charter says, and delegates only for its exceptions', async () => {
    const t = await r.start('THINK:1');
    await r.untilResults(t.id, 1);
    const thread = r.thread(t.id);
    const channel = r.db.channels.get('scratch')!;
    const name = userName();
    const conductorRole = getCrew('conductor')!;
    const conductor = buildSystemPrompt(thread, channel, conductorRole);
    const delegation = section(conductor, 'Thread delegation');

    expect(delegation).not.toContain("Delegate with Omni's delegate tool, before anything else");
    expect(delegation).toContain(
      'For real work your first action is seat_agents, not delegate: when the work writes or edits files, runs commands, browses at length, changes code, a store, an inbox, a calendar or Notion, or will clearly grow past a few lookups, seat the agent for it in this thread',
    );
    expect(delegation).toContain(
      `Use delegate or delegate_team directly, instead of seating, only for a review, research that a build depends on and the build after it, a team ${name} asked for, tasks on machines ${name} @mentioned, or when ${name} asks you to delegate.`,
    );
    // The same exceptions, in the same order, as the charter's own line.
    expect(conductorRole.charter).toContain(
      'Use `delegate` or `delegate_team` directly, instead of seating, only for a review (below), research that a build depends on and the build after it (above), a team the user asked for, tasks on machines the user @mentioned, or when the user asks you to delegate.',
    );
    expect(conductorRole.charter).toContain('Your first action is `seat_agents`');

    // What a Conductor thread's Claude Code actually starts with.
    const started = await r.start('THINK:1', { role: 'conductor' });
    await r.untilResults(started.id, 1);
    const args: string[] = r.spawns(started.id)[0].args;
    const sent = args[args.indexOf('--append-system-prompt') + 1];
    expect(sent).toContain('For real work your first action is seat_agents, not delegate');
    expect(sent).not.toContain("Delegate with Omni's delegate tool, before anything else");

    // Another delegate-only agent keeps the delegate-first rule, word for word.
    const router = buildSystemPrompt(thread, channel, { ...conductorRole, id: 'router', name: 'Router' });
    expect(section(router, 'Thread delegation')).toContain(
      `Answer quick asks yourself, in this thread, and start no thread for them: anything you can answer from the conversation, Omni's own state (the omni tools) or a light lookup with the tools you have (a fact you know, a page or doc read in a call or two, a connector read). Delegate with Omni's delegate tool, before anything else, when the work writes or edits files, runs commands, browses at length, changes code, a store, an inbox, a calendar or Notion, or will clearly grow past a few lookups. You have no shell, file editing, browser or subagent tools, by design: when a quick ask turns out to need them, delegate it instead of working around that. A plain question gets a plain answer: no brief, no folder question. Ask ${name} only for decisions that are theirs to make. First call list_crew`,
    );
    expect(router).not.toContain('first action is seat_agents');

    // An agent that does its own work, with the conductor tools turned on, keeps its delegation section as it was.
    const builder = buildSystemPrompt(thread, channel, { ...getCrew('builder')!, mcp: ['omni'] });
    expect(section(builder, 'Thread delegation')).toBe(
      [
        '## Thread delegation',
        `Use Omni's delegate tool when ${name} asks you to hand work to another agent. First call list_crew and list_channels when you need valid ids. Write each brief as Goal, Done when and Proof back; the delegated thread cannot see this conversation. Delegated threads appear in Omni as separate, linked threads, and their reports return here automatically; do not poll for them.`,
        'delegate_team makes one thread in the channel: its lead plans on your brief, then gives each member its part, the members work at once, and the lead reports once they have all finished. An agent with two parts gets one seat. You seat agents in your own #conductor thread with seat_agents, and in a thread you delegate with delegate_team, members on delegate, or agents on message_thread. Never in any other #conductor thread.',
        "Before you message a thread you already have, check get_thread's session.warm. A warm thread (running, or its model active within the hour) gets message_thread. A cold one you do not wake: open a new session with continue_thread on its own harness and a message that carries the follow-up, or delegate a fresh thread whose brief stands alone and links the old one, then say which thread replaced which. message_thread refuses a cold thread unless you pass wake_cold: true, which is only for when you were asked to resume that thread itself. Never wake a cold thread to ask how it went: read it with get_thread.",
      ].join('\n'),
    );
  });

  it('tells the Conductor and every crew role to render a "show me" answer, except where html_render is missing', async () => {
    const t = await r.start('THINK:1');
    await r.untilResults(t.id, 1);
    const thread = r.thread(t.id);
    const channel = r.db.channels.get('scratch')!;
    const rule = 'show the result with html_render';
    for (const role of ['conductor', 'builder', 'researcher', 'inbox']) {
      expect(buildSystemPrompt(thread, channel, getCrew(role))).toContain(rule);
    }
    expect(buildSystemPrompt({ ...thread, harness: 'hermes' }, channel)).not.toContain(rule);
  });
});
