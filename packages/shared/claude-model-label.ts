/** Claude Code can report release dates and context suffixes on model IDs. */
export const stripClaudeModelSuffixes = (id: string) =>
  id.trim().replace(/\[[^\]]*\]$/, '').replace(/-\d{8}$/, '');

/** Use a supplied display name when it adds information, otherwise label the Claude ID. */
export function claudeModelLabel(id: string, displayName?: string): string {
  const base = stripClaudeModelSuffixes(id);
  const name = displayName?.trim();
  if (name && stripClaudeModelSuffixes(name) !== base) return name;

  const match = /^claude-([a-z]+)-(\d+)(?:-(\d+))?$/.exec(base);
  if (!match) return name || id;
  const [, family, major, minor] = match;
  return `${family[0].toUpperCase()}${family.slice(1)} ${major}${minor ? `.${minor}` : ''}`;
}
