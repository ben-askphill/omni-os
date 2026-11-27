export { duration } from '@omni/shared/format.ts';

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

const HARNESS: Record<string, string> = {
  'claude-code': 'Claude Code',
  codex: 'Codex',
  cursor: 'Cursor',
  hermes: 'Hermes',
  'cursor-cloud': 'Cursor Cloud',
  antigravity: 'Antigravity',
  opencode: 'OpenCode',
};

export const harnessLabel = (harness: string): string => HARNESS[harness] ?? harness;
