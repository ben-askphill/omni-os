import { describe, it, expect } from 'vitest';
import { startRunner } from './runner-boot.ts';

// The Conductor is delegate-only: it routes work to crew threads and has no tools to do it itself.
const r = await startRunner();
const { buildSystemPrompt } = await import('../runner/prompts.ts');
const { getCrew } = await import('../crew.ts');

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

  it('is told to delegate first, and gets no browser or artifact instructions', async () => {
    const t = await r.start('THINK:1');
    await r.untilResults(t.id, 1);
    const thread = r.thread(t.id);
    const channel = r.db.channels.get('scratch')!;
    const conductor = buildSystemPrompt(thread, channel, getCrew('conductor'));
    expect(conductor).toContain('You route work; you never do it.');
    expect(conductor).not.toContain('## Browser');
    expect(conductor).not.toContain('## Artifacts');
    expect(conductor).not.toContain('when the user asks you to hand work');

    const builder = buildSystemPrompt(thread, channel, getCrew('builder'));
    expect(builder).toContain('## Artifacts');
    expect(builder).not.toContain('You route work');
  });
});
