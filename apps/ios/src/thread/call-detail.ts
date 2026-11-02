import { str, type ToolCall } from '@omni/shared/transcript-fold.ts';

export interface DetailLine {
  text: string;
  tone?: 'add' | 'del';
}

const SHOWN = 14;

const lines = (s: string, tone?: DetailLine['tone']): DetailLine[] => {
  const all = s.split('\n');
  const shown = all.slice(0, SHOWN).map((text) => (tone ? { text, tone } : { text }));
  return all.length > SHOWN ? [...shown, { text: `… ${all.length - SHOWN} more lines` }] : shown;
};

export function callDetail(call: Pick<ToolCall, 'name' | 'input'>): DetailLine[] {
  const i = call.input;
  switch (call.name) {
    case 'Bash':
      return lines(str(i.command));
    case 'Edit':
      return [...lines(str(i.old_string), 'del'), ...lines(str(i.new_string), 'add')];
    case 'MultiEdit': {
      const edits = Array.isArray(i.edits) ? (i.edits as { old_string?: unknown; new_string?: unknown }[]) : [];
      return edits.flatMap((e) => [...lines(str(e.old_string), 'del'), ...lines(str(e.new_string), 'add')]);
    }
    case 'Write':
      return lines(str(i.content), 'add');
    case 'Read':
    case 'Glob':
    case 'Grep':
    case 'WebFetch':
    case 'WebSearch':
    case 'Task':
    case 'Agent':
    case 'TodoWrite':
      return [];
    default: {
      const json = JSON.stringify(i, null, 2);
      return json === '{}' ? [] : lines(json.length > 1200 ? `${json.slice(0, 1200)}…` : json);
    }
  }
}
