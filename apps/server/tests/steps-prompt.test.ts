import { describe, expect, it } from 'vitest';
import { startRunner } from './runner-boot.ts';

// Every local thread is told to post its plan with set_steps, which the omni-steps server gives it. Hermes and Cursor
// cloud agents get no local servers, so they are not told, and their threads show the phases Omni groups calls into.
const r = await startRunner();
const { buildSystemPrompt } = await import('../runner/prompts.ts');
const { getCrew } = await import('../crew.ts');

const SECTION = '## Progress';

describe('the step line in the system prompt', () => {
  it('asks a local thread for 3 to 6 plain steps on a task with more than one stage, whatever its role', async () => {
    const t = await r.start('THINK:1', { role: 'builder' });
    await r.untilResults(t.id, 1);
    const thread = r.thread(t.id);
    const channel = r.db.channels.get('scratch')!;
    for (const prompt of [buildSystemPrompt(thread, channel), buildSystemPrompt(thread, channel, getCrew('builder')), buildSystemPrompt({ ...thread, harness: 'codex' }, channel)]) {
      expect(prompt).toContain(SECTION);
      expect(prompt).toContain('call set_steps before you start, with 3 to 6 steps');
    }
  });

  it('leaves it out for Hermes and Cursor cloud agents', async () => {
    const t = await r.start('THINK:1');
    await r.untilResults(t.id, 1);
    const thread = r.thread(t.id);
    const channel = r.db.channels.get('scratch')!;
    expect(buildSystemPrompt({ ...thread, harness: 'hermes' }, channel)).not.toContain(SECTION);
    expect(buildSystemPrompt({ ...thread, harness: 'cursor-cloud' }, channel)).not.toContain(SECTION);
  });
});
