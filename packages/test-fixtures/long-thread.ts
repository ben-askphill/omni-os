// A long thread's events, deterministic, shaped like the largest real threads (#223): about 80 turns and 3,500
// events, with plans, nested sub-agent calls, a background agent whose calls land in later turns, a question, a kind
// no client knows yet, and a few rows far over any row budget.
// The server's history budget tests seed it; the Web UI's fold timing reads the same rows.

export interface FixtureEvent {
  kind: string;
  payload: Record<string, unknown>;
}

export interface LongThreadOptions {
  turns?: number;
  /** Bytes of the one very large tool result, in the last turn. */
  hugeResult?: number;
  /** Bytes of the very large Write call's content, a few turns back. */
  hugeWrite?: number;
}

/** Ids every test can look for. */
export const LONG_THREAD = {
  hugeResultCall: 'call-huge-result',
  hugeWriteCall: 'call-huge-write',
  /** The text only one old user message contains, for search. */
  oldNeedle: 'pelican-needle',
  unknownKind: 'context_record',
  /** A background agent started in turn 70; its calls land in turns 71 and 72, its result in turn 73. */
  backgroundCall: 'call-bg-70',
  questionId: 'q-20',
} as const;

const words = 'the agent reads files runs commands and writes code while ben steers it from the web ui or the mac app'.split(' ');

/** `n` characters of readable filler, the same every run. */
export function filler(n: number, seed = 0): string {
  let s = '';
  for (let i = seed; s.length < n; i++) s += `${words[i % words.length]} `;
  return s.slice(0, n);
}

export function longThread({ turns = 80, hugeResult = 4_000_000, hugeWrite = 1_500_000 }: LongThreadOptions = {}): FixtureEvent[] {
  const out: FixtureEvent[] = [];
  const add = (kind: string, payload: Record<string, unknown>) => out.push({ kind, payload });
  let call = 0;
  const tool = (name: string, input: Record<string, unknown>, result: string, parent?: string, id = `call-${++call}`) => {
    add('tool_use', { id, name, input, ...(parent && { parent }) });
    add('tool_result', { tool_use_id: id, text: result, is_error: false, truncated: false });
    return id;
  };

  for (let t = 0; t < turns; t++) {
    const last = t === turns - 1;
    add('user', { text: t === 3 ? `Find the ${LONG_THREAD.oldNeedle} in the old logs` : `Turn ${t}: ${filler(120, t)}`, source: 'ben' });
    if (t % 10 === 0) add('init', { model: 'claude-opus', cwd: '/repo', tools: 40, mcp: [] });
    add('status', { text: 'Thinking' });
    if (t % 4 === 0) {
      const todos = [0, 1, 2, 3].map((k) => ({ content: `Step ${k} of turn ${t}`, activeForm: `Doing step ${k}`, status: k < 2 ? 'completed' : 'pending' }));
      tool('TodoWrite', { todos }, 'Todos updated');
    }
    for (let k = 0; k < 18; k++) {
      const kind = k % 4;
      if (kind === 0) tool('Read', { file_path: `/repo/src/file-${t}-${k}.ts` }, filler(2400, k));
      else if (kind === 1) tool('Bash', { command: `npm test -- part-${k}`, description: 'Run the tests' }, filler(1600, k));
      else if (kind === 2) tool('Grep', { pattern: `needle${k}`, path: '/repo/src' }, filler(600, k));
      else tool('Edit', { file_path: `/repo/src/file-${t}-${k}.ts`, old_string: filler(200, k), new_string: filler(240, k + 1) }, 'Edited');
    }
    if (t % 7 === 0) {
      const agent = `call-agent-${t}`;
      add('tool_use', { id: agent, name: 'Agent', input: { description: `Explore part ${t}`, subagent_type: 'Explore', prompt: filler(400, t) } });
      add('task', { task_id: `task-${t}`, event: 'started', tool_use_id: agent });
      for (let k = 0; k < 6; k++) tool('Read', { file_path: `/repo/docs/part-${t}-${k}.md` }, filler(1800, k), agent);
      add('task', { task_id: `task-${t}`, event: 'ended', status: 'completed', tool_uses: 6 });
      add('tool_result', { tool_use_id: agent, text: filler(900, t), is_error: false, truncated: false });
    }
    if (t === 70) {
      add('tool_use', { id: LONG_THREAD.backgroundCall, name: 'Agent', input: { description: 'Watch the build', subagent_type: 'general-purpose', run_in_background: true } });
      add('task', { task_id: 'task-bg', event: 'started', tool_use_id: LONG_THREAD.backgroundCall, background: true });
    }
    if (t === 71 || t === 72) for (let k = 0; k < 3; k++) tool('Bash', { command: `tail build-${t}-${k}.log` }, filler(500, k), LONG_THREAD.backgroundCall);
    if (t === 73) {
      add('task', { task_id: 'task-bg', event: 'ended', status: 'completed', tool_uses: 6 });
      add('tool_result', { tool_use_id: LONG_THREAD.backgroundCall, text: 'The build passed.', is_error: false, truncated: false });
    }
    if (t === 20) {
      const questions = [{ question: 'Ship it?', header: 'Ship', options: [{ label: 'Yes', description: 'Ship now' }, { label: 'No', description: 'Wait' }], multiSelect: false }];
      add('question', { id: LONG_THREAD.questionId, questions });
      add('question_answer', { id: LONG_THREAD.questionId, state: 'answered', answers: [{ selected: ['Yes'], other: null }] });
    }
    if (t % 9 === 0) add(LONG_THREAD.unknownKind, { id: `ctx-${t}`, source: 'note', text: filler(300, t) });
    if (t === 41) add('user', { text: `Pasted log:\n${filler(160_000, t)}`, source: 'ben' });
    if (t === turns - 3) tool('Write', { file_path: '/repo/big.json', content: filler(hugeWrite, 7) }, 'Wrote', undefined, LONG_THREAD.hugeWriteCall);
    if (last) tool('Bash', { command: 'cat build.log' }, filler(hugeResult, 3), undefined, LONG_THREAD.hugeResultCall);
    add('assistant_text', { text: `Done with turn ${t}. ${filler(700, t)}` });
    add('result', { ok: true, subtype: 'success', turns: 30, duration_ms: 60_000, cost_usd: 0.5 });
  }
  return out;
}
