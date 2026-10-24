import { describe, expect, it } from 'vitest';
import type { RunName, SwitchP } from '@omni/shared/run-switch.ts';
import { buildCarryover, type CarryoverP } from '../carryover.ts';
import type { EventRow } from '../db.ts';
import { buildHandover, type HandoverInput } from '../runner/handover.ts';

const claude: RunName = { harness: 'claude-code', model: 'opus', effort: 'high', harnessName: 'Claude Code', modelLabel: 'Opus 5.5' };
const codex: RunName = { harness: 'codex', model: 'gpt-5.6-sol', effort: '', harnessName: 'Codex', modelLabel: 'GPT-5.6 Sol' };

let id = 0;
const ev = (kind: string, p: unknown): EventRow => ({ id: ++id, thread_id: 't', kind, payload: JSON.stringify(p), created_at: '' });

const input = (events: EventRow[], over: Partial<HandoverInput> = {}): HandoverInput => ({
  from: claude,
  to: codex,
  session: 'fresh',
  user: 'Ben',
  thread: { title: 'Fix the cart', cwd: '/w/acme', branch: 'omni/cart' },
  artifacts: [],
  uploadsDir: '/this-mac/threads/t/uploads',
  events,
  ...over,
});

describe('buildHandover', () => {
  it('keeps attachment references at this Mac\'s upload paths, including image-only messages', () => {
    const h = buildHandover(input([
      ev('user', {
        text: '',
        attachments: [{ name: 'cart.png', path: '/other-mac/threads/t/uploads/cart.png', mime: 'image/png', image: true }],
      }),
      ev('user', { text: 'Check this brief', attachments: [{ name: 'brief.pdf', path: '/other-mac/brief.pdf' }] }),
    ]));
    expect(h.text).toContain('Attachment: cart.png, read from /this-mac/threads/t/uploads/cart.png');
    expect(h.text).toContain('Attachment: brief.pdf, read from /this-mac/threads/t/uploads/brief.pdf');
    expect(h.text).not.toContain('/other-mac');
  });

  it('carries the thread facts and every entry, with Ben’s message to follow', () => {
    const h = buildHandover(
      input(
        [
          ev('user', { text: 'remember the word PAPAYA' }),
          ev('init', { model: 'opus' }),
          ev('assistant_text', { text: 'Noted: PAPAYA.' }),
          ev('result', { ok: true }),
        ],
        { artifacts: ['report.md', 'plan.md'] },
      ),
    );
    expect(h.text).toContain('Claude Code (Opus 5.5)');
    expect(h.text).toContain('Codex (GPT-5.6 Sol)');
    expect(h.text).toContain('Thread: Fix the cart');
    expect(h.text).toContain('Working directory: /w/acme (branch omni/cart)');
    expect(h.text).toContain('Artifacts: report.md, plan.md');
    expect(h.text).toContain('[Ben] remember the word PAPAYA');
    expect(h.text).toContain('[Claude Code] Noted: PAPAYA.');
    expect(h.text.endsWith("Ben's message:\n")).toBe(true);
    expect(h).toMatchObject({ entries: 2, omitted: 0, chars: h.text.length });
  });

  it('skips dropped messages and run bookkeeping', () => {
    const h = buildHandover(input([ev('user', { text: 'first' }), ev('user', { text: 'never sent', dropped: true }), ev('task', { task_id: 'x' }), ev('status', { text: 'compacting' })]));
    expect(h.text).not.toContain('never sent');
    expect(h.text).not.toContain('compacting');
    expect(h.entries).toBe(1);
  });

  it('shows tool calls with the result of a failed one', () => {
    const h = buildHandover(
      input([
        ev('user', { text: 'run the tests' }),
        ev('tool_use', { id: 'a', name: 'Bash', input: { command: 'npm test' } }),
        ev('tool_result', { tool_use_id: 'a', text: '3 failing: cart.test.ts', is_error: true }),
      ]),
    );
    expect(h.text).toContain('  - Bash: npm test');
    expect(h.text).toContain('Failed: 3 failing: cart.test.ts');
  });

  it('names who wrote each reply across switches', () => {
    const away: SwitchP = { from: claude, to: codex, mode: 'handover' };
    const back: SwitchP = { from: codex, to: claude, mode: 'handover' };
    const h = buildHandover(
      input(
        [ev('switch', away), ev('user', { text: 'what word?' }), ev('assistant_text', { text: 'PAPAYA' }), ev('switch', back)],
        { from: codex, to: claude, session: 'resumed' },
      ),
    );
    expect(h.text).toContain('You ran this thread earlier. While it ran on Codex (GPT-5.6 Sol)');
    expect(h.text).toContain('[Omni] Handing over from Claude Code (Opus 5.5) to Codex (GPT-5.6 Sol)');
    expect(h.text).toContain('[Codex] PAPAYA');
  });

  it('lists the open todos for a fresh session', () => {
    const todos = [
      { content: 'Scaffold', status: 'completed' },
      { content: 'Wire adapter', status: 'in_progress' },
    ];
    const events = [ev('user', { text: 'go' }), ev('tool_use', { id: 'p', name: 'TodoWrite', input: { todos } })];
    const fresh = buildHandover(input(events)).text;
    expect(fresh).toContain('Open todos:\n  - Wire adapter (in_progress)');
    expect(fresh).not.toContain('Scaffold (completed)');
    expect(buildHandover(input(events, { session: 'resumed' })).text).not.toContain('Open todos');
  });

  it('cuts to the budget: keeps the first message and the newest entries whole, and says how many it left out', () => {
    const events = [
      ev('user', { text: 'THE TASK' }),
      ...Array.from({ length: 30 }, (_, i) => ev('assistant_text', { text: `reply ${i} ${'x'.repeat(80)}` })),
    ];
    const h = buildHandover(input(events, { budget: 1000 }));
    expect(h.text).toContain('[Ben] THE TASK');
    expect(h.text).toContain('reply 29');
    expect(h.text).not.toContain('reply 0 ');
    expect(h.entries + h.omitted).toBe(31);
    expect(h.omitted).toBeGreaterThan(0);
    expect(h.text).toContain(`[... ${h.omitted} earlier entries left out ...]`);
    // The marker sits between the task and what was kept.
    expect(h.text.indexOf('THE TASK')).toBeLessThan(h.text.indexOf('left out'));
    expect(h.text.indexOf('left out')).toBeLessThan(h.text.indexOf('reply 29'));
  });

  it('does not force the first message into a resumed catch-up', () => {
    const events = [ev('user', { text: 'OLD' }), ...Array.from({ length: 20 }, (_, i) => ev('assistant_text', { text: `r${i} ${'y'.repeat(80)}` }))];
    expect(buildHandover(input(events, { session: 'resumed', budget: 500 })).text).not.toContain('OLD');
  });

  it('caps one long message and keeps its head', () => {
    const h = buildHandover(input([ev('user', { text: `HEAD ${'z'.repeat(10_000)}` })]));
    expect(h.text).toContain('[Ben] HEAD');
    expect(h.text).toContain('(cut)');
    expect(h.chars).toBeLessThan(5_000);
  });

  it('gives the same text for the same input', () => {
    const events = [ev('user', { text: 'a' }), ev('assistant_text', { text: 'b' })];
    expect(buildHandover(input(events)).text).toBe(buildHandover(input(events)).text);
  });
});

describe('a continued thread', () => {
  /** A Carryover previewed for Codex, as its `carryover` event keeps it. */
  const carried = () => {
    const { carryover: c, body } = buildCarryover({
      source: { id: 'src', title: 'Fix the cart', channel: 'acme', run: claude },
      to: codex,
      user: 'Ben',
      role: null,
      events: [ev('user', { text: 'remember the word PAPAYA' }), ev('assistant_text', { text: 'Noted.' })],
      uid: (n) => `uid-${n}`,
      workspace: { kind: 'folder', cwd: '/w/acme' },
      files: null,
      skipped: [],
      uncommitted: [],
      parked: [],
    });
    const p: CarryoverP = { source: c.source, goal: c.goal, text: body, entries: c.recent.length, condensed: 0, omitted: 0, chars: c.chars, budget: c.budget, files: 0 };
    return { c, p };
  };

  it('gives its first session the Carryover exactly as previewed', () => {
    const { c, p } = carried();
    const h = buildHandover(input([ev('carryover', p)], { from: claude, to: codex }));
    expect(h.text).toBe(c.text);
    expect(h).toMatchObject({ entries: 2, omitted: 0, chars: c.text.length });
  });

  it('addresses the Carryover to the run that reads it after a switch before the first turn', () => {
    const { p } = carried();
    const away: SwitchP = { from: codex, to: claude, mode: 'handover' };
    const h = buildHandover(input([ev('carryover', p), ev('switch', away), ev('user', { text: 'lost', dropped: true })], { from: claude, to: claude }));
    expect(h.text.startsWith('<omni-carryover>')).toBe(true);
    expect(h.text).toContain('Ben started this one on Claude Code (Opus 5.5)');
    expect(h.text).toContain(p.text);
    expect(h.text.endsWith("Ben's message:\n")).toBe(true);
  });

  it('hands the Carryover over as one entry once the thread has run, kept like a first message', () => {
    const { p } = carried();
    const events = [
      ev('carryover', p),
      ev('user', { text: 'now the tests' }),
      ...Array.from({ length: 30 }, (_, i) => ev('assistant_text', { text: `reply ${i} ${'x'.repeat(80)}` })),
    ];
    const h = buildHandover(input(events, { from: codex, to: claude, budget: 2_500 }));
    expect(h.text.startsWith('<omni-handover>')).toBe(true);
    expect(h.text).toContain('[Carried over from "Fix the cart" on Claude Code (Opus 5.5)] Goal, the message the work started from:\nremember the word PAPAYA');
    expect(h.text).toContain('reply 29');
    expect(h.omitted).toBeGreaterThan(0);
    expect(h.text).not.toContain('<omni-carryover>');
  });
});
