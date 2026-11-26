import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { startRunner } from './runner-boot.ts';

// The system prompt says each rule once and runs from static to per-thread, so a harness's prompt cache reuses the
// longest prefix across threads (#1013): the install's rules, the agent's, the thread's kind, the channel's, the thread's.
const r = await startRunner();
const { buildSystemPrompt } = await import('../runner/prompts.ts');
const { getCrew } = await import('../crew.ts');
const { config } = await import('../config.ts');
const { artifactsDir, browserOutDir } = await import('../config.ts');

const HARNESSES = ['claude-code', 'codex', 'cursor', 'cursor-cloud', 'hermes', 'antigravity', 'custom:eve'];

/** Two threads that share a harness and an agent and nothing else: another id, channel, task, branch and parent. */
async function twoThreads() {
  const a = await r.start('THINK:1', { role: 'builder' });
  const b = await r.start('THINK:1', { role: 'builder' });
  await r.untilResults(a.id, 1);
  await r.untilResults(b.id, 1);
  if (!r.db.channels.get('acme')) r.db.channels.create({ id: 'acme', name: 'Acme', kind: 'client', use_worktree: 0, github_repo: 'acme/shop', notes: 'Quote prices without VAT.' } as any);
  const first = { ...r.thread(a.id), task_id: 'T-1', branch: 'omni/aaaa', parent_id: null };
  const second = { ...r.thread(b.id), task_id: 'T-2', branch: 'omni/bbbb', parent_id: null };
  return { first, second, scratch: r.db.channels.get('scratch')!, acme: r.db.channels.get('acme')! };
}

const commonPrefix = (x: string, y: string) => {
  let i = 0;
  while (i < x.length && x[i] === y[i]) i++;
  return i;
};

describe('the system prompt order', () => {
  it('puts the per-thread lines after every static section, for every harness', async () => {
    const { first, scratch } = await twoThreads();
    for (const harness of HARNESSES) {
      const thread = { ...first, harness };
      const prompt = buildSystemPrompt(thread, scratch, getCrew('builder'));
      const tail = prompt.indexOf('\n## This thread\n');
      expect(tail, harness).toBeGreaterThan(0);
      // Nothing comes after the thread's own lines.
      expect(prompt.slice(tail + 1).match(/\n## /g), harness).toBeNull();
      // Every per-thread value sits in that last section.
      for (const value of [`- Thread: ${thread.id} (task T-1)`, `- Channel: #scratch`]) {
        expect(prompt.indexOf(value), `${harness}: ${value}`).toBeGreaterThan(tail);
      }
      for (const local of [artifactsDir(thread.id), browserOutDir(thread.id), 'branch omni/aaaa']) {
        const at = prompt.indexOf(local);
        // Remote harnesses have no local folders or worktree here; where a local one has them, they come last.
        if (at >= 0) expect(at, `${harness}: ${local}`).toBeGreaterThan(tail);
      }
      // The static sections come first.
      for (const heading of ['## Secrets', '## Reply', '## Your agent: Builder']) {
        expect(prompt.indexOf(heading), `${harness}: ${heading}`).toBeLessThan(tail);
      }
    }
  });

  it('gives two threads of one agent the same prompt up to the channel and thread lines, so the prefix caches', async () => {
    const { first, second, scratch, acme } = await twoThreads();
    for (const harness of HARNESSES) {
      const one = buildSystemPrompt({ ...first, harness }, scratch, getCrew('builder'));
      const two = buildSystemPrompt({ ...second, harness, channel_id: 'acme' }, acme, getCrew('builder'));
      const shared = commonPrefix(one, two);
      // Everything through the agent's charter is the same text: only the channel's and the thread's sections differ.
      const charterEnd = one.indexOf('## Your agent: Builder') + '## Your agent: Builder'.length + getCrew('builder')!.charter.length;
      expect(shared, harness).toBeGreaterThanOrEqual(charterEnd);
      expect(one.slice(0, shared), harness).not.toContain(first.id);
    }
  });

  it('carries the delegated task as static text, with its id on the thread line', async () => {
    const { first, scratch } = await twoThreads();
    const prompt = buildSystemPrompt({ ...first, parent_id: first.id }, scratch, getCrew('builder'));
    const delegated = prompt.indexOf('## Delegated task');
    expect(delegated).toBeGreaterThan(prompt.indexOf('## Your agent: Builder'));
    expect(delegated).toBeLessThan(prompt.indexOf('## This thread'));
    expect(prompt.slice(delegated, prompt.indexOf('## This thread'))).not.toContain('T-1');
    expect(prompt).toContain('(task T-1)');
  });
});

describe('the Conductor prompt', () => {
  /** The sentences of a prompt, normalized, that carry a rule (long enough not to be a heading or a fragment). */
  const sentences = (text: string) =>
    text
      .split(/\n|(?<=[.!?])\s+/)
      .map((s) => s.replace(/[`*_]/g, '').trim().toLowerCase())
      .filter((s) => s.length > 40);

  it('says each rule once: no sentence of the prompt builder repeats one of its charter', async () => {
    const t = await r.start('THINK:1');
    await r.untilResults(t.id, 1);
    const role = getCrew('conductor')!;
    const prompt = buildSystemPrompt(r.thread(t.id), r.db.channels.get('scratch')!, role);
    const seen = new Map<string, number>();
    for (const s of sentences(prompt)) seen.set(s, (seen.get(s) ?? 0) + 1);
    expect([...seen].filter(([, n]) => n > 1).map(([s]) => s)).toEqual([]);
    // The rules the builder used to restate: delegation, teams, seating and warmth are the charter's alone.
    expect(prompt).not.toContain('## Thread delegation');
    for (const rule of ['session.warm', 'wake_cold', 'delegate_team makes one thread', 'Goal, Done when and Proof back']) {
      expect(prompt.split(rule).length - 1, rule).toBeLessThanOrEqual(1);
    }
    expect(role.charter).toContain('`session.warm`');
    expect(role.charter).toContain('`wake_cold: true`');
  });

  it('keeps the delegation rules for a Conductor whose own charter replaces the shipped one', async () => {
    const t = await r.start('THINK:1');
    await r.untilResults(t.id, 1);
    const channel = r.db.channels.get('scratch')!;
    const shipped = getCrew('conductor')!;
    // An overlay that adds to the shipped charter still carries its rules; one that replaces it may predate them.
    const appended = buildSystemPrompt(r.thread(t.id), channel, { ...shipped, kind: 'edited', charterMode: 'append' });
    expect(appended).not.toContain('## Thread delegation');
    const replaced = buildSystemPrompt(r.thread(t.id), channel, { ...shipped, kind: 'edited', charterMode: 'replace', charter: 'Route work to the crew.' });
    expect(replaced).toContain('## Thread delegation');
    expect(replaced).toContain("check get_thread's session.warm");
    expect(replaced).toContain('delegate_team makes one thread in the channel');
  });

  it('leaves out the tool-failure policy, which a delegate-only agent has no shell or subagent to apply', async () => {
    const t = await r.start('THINK:1');
    await r.untilResults(t.id, 1);
    const thread = r.thread(t.id);
    const channel = r.db.channels.get('scratch')!;
    expect(buildSystemPrompt(thread, channel, getCrew('conductor'))).not.toContain('## Tool failures');
    const builder = buildSystemPrompt(thread, channel, getCrew('builder'));
    expect(builder.match(/## Tool failures\n/g)).toHaveLength(1);
  });

  it("does not load the workspace's CLAUDE.md on #conductor, and other channels still do", async () => {
    const conductor = await r.start('THINK:1', { channel: 'conductor', role: 'conductor' });
    const scratch = await r.start('THINK:1', { role: 'builder' });
    await r.untilResults(conductor.id, 1);
    await r.untilResults(scratch.id, 1);
    const settings = (args: string[]) => (args.includes('--settings') ? JSON.parse(args[args.indexOf('--settings') + 1]) : {});

    const routed: string[] = r.spawns(conductor.id)[0].args;
    expect(settings(routed).claudeMdExcludes).toEqual(expect.arrayContaining([join(config.brainDir, 'CLAUDE.md'), join(config.brainDir, '.claude', 'CLAUDE.md')]));
    expect(routed.filter((_, i) => routed[i - 1] === '--add-dir')).not.toContain(config.brainDir);
    // One --settings flag: the CLI keeps only one.
    expect(routed.filter((a) => a === '--settings')).toHaveLength(1);

    const work: string[] = r.spawns(scratch.id)[0].args;
    expect(settings(work).claudeMdExcludes).toBeUndefined();
  });
});
