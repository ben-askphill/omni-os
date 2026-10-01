import { buildItems, toolSummary, type Item, type Todo, type ToolCall, type TranscriptEvent } from '../web/src/transcript/fold.ts';

// The shape Swift's transcript tests read back from tests/fixtures/transcript/corpus.json.
// Dates and event ids on a call are left out: both clients key a row by the event id, and a call by its tool id.

interface FoldCall {
  id: string | null;
  name: string;
  parent: string | null;
  orphan: boolean;
  input: unknown;
  summary: string;
  result: { text: string; is_error: boolean; truncated: boolean } | null;
  children: FoldCall[];
}

function projectCall(c: ToolCall): FoldCall {
  return {
    id: typeof c.id === 'string' && c.id !== '' ? c.id : null,
    name: c.name,
    parent: typeof c.parent === 'string' ? c.parent : null,
    orphan: c.orphan,
    input: JSON.parse(JSON.stringify(c.input)) as unknown,
    summary: toolSummary(c),
    result: c.result ? { text: c.result.text, is_error: c.result.is_error, truncated: c.result.truncated } : null,
    children: c.children.map(projectCall),
  };
}

function projectItem(it: Item) {
  switch (it.type) {
    case 'user':
      return { type: 'user' as const, key: it.key, text: it.p.text ?? '' };
    case 'text':
      return { type: 'text' as const, key: it.key, text: it.p.text ?? '' };
    case 'tools':
      return { type: 'tools' as const, key: it.key, total: it.total, calls: it.calls.map(projectCall) };
    case 'result': {
      const row: { type: 'result'; key: number; ok: boolean; subtype: string; turns?: number } = {
        type: 'result',
        key: it.key,
        ok: it.p.ok,
        subtype: it.p.subtype,
      };
      if (it.p.turns != null) row.turns = it.p.turns;
      return row;
    }
    case 'error':
      return { type: 'error' as const, key: it.key, text: it.p.text ?? '' };
    case 'report': {
      const row: { type: 'report'; key: number; text: string; task_id?: string | null } = {
        type: 'report',
        key: it.key,
        text: it.p.text ?? '',
      };
      if (it.p.task_id != null) row.task_id = it.p.task_id;
      return row;
    }
    default: {
      const unreachable: never = it;
      return unreachable;
    }
  }
}

function projectTodo(t: Todo) {
  const o: { content?: string; activeForm?: string; status?: string } = {};
  if (t.content != null) o.content = t.content;
  if (t.activeForm != null) o.activeForm = t.activeForm;
  if (t.status != null) o.status = t.status;
  return o;
}

/** The fold's items, in the shape the checked-in corpus stores. */
export function projectFold(events: TranscriptEvent[]) {
  const { items, plan } = buildItems(events);
  return {
    items: items.map(projectItem),
    plan: plan ? { after: plan.after, todos: plan.todos.map(projectTodo) } : null,
  };
}
