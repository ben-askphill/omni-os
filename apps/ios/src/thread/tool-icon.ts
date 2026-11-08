import type { IconName } from '../ui/symbols';

/** Same tool categories as the web transcript. Status is shown separately. */
export function toolIcon(name: string): IconName {
  if (name === 'Bash' || name === 'BashOutput') return 'terminal';
  if (['Read', 'Edit', 'Write', 'MultiEdit', 'Glob', 'Grep'].includes(name)) return 'file';
  if (name === 'WebFetch' || name === 'WebSearch' || name.includes('browser')) return 'globe';
  if (name === 'Task' || name === 'Agent') return 'layers';
  return 'tool';
}
