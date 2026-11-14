// A channel's own worktree lists, for a repo that cannot take a committed .worktreeinclude: what to copy into each
// new thread worktree (gitignore patterns, merged with the repo's file) and what to share from the main checkout
// instead of installing again (folders such as node_modules, linked). Stored one entry per line, as typed.

/** The most entries one list holds, and the longest entry. */
export const WORKTREE_LIST_MAX = { lines: 100, length: 300 };

/** The entries of a stored list: one per line, trimmed, blanks and # comments dropped, each once. */
export function listLines(text: string | null | undefined): string[] {
  const out: string[] = [];
  for (const raw of (text ?? '').split(/\r?\n/)) {
    const line = raw.trim();
    if (line && !line.startsWith('#') && !out.includes(line)) out.push(line);
  }
  return out;
}

/** A shared folder as a path from the repo's top: no leading or trailing slash. */
export const sharedPath = (line: string) => line.replace(/^\/+|\/+$/g, '');

/** Why one shared directory entry is refused, or null. A literal path inside the repo, never a pattern. */
export function sharedDirProblem(line: string): string | null {
  const p = sharedPath(line);
  if (!p) return `"${line}" names the repo itself.`;
  if (/[*?[\]\\]/.test(p) || p.startsWith('!')) return `"${line}" is a pattern. List each shared folder by its path, such as node_modules.`;
  if (p.split('/').some((part) => part === '..' || part === '.' || part === '' || part === '.git')) return `"${line}" must stay inside the repo, outside .git.`;
  return null;
}

/** Why a list cannot be saved, or null. `shared`: the shared directories, which take paths only. */
export function worktreeListProblem(text: string | null | undefined, opts: { shared?: boolean } = {}): string | null {
  const lines = listLines(text);
  const what = opts.shared ? 'Shared directories' : 'Copy into new worktrees';
  if (lines.length > WORKTREE_LIST_MAX.lines) return `${what} takes at most ${WORKTREE_LIST_MAX.lines} entries.`;
  const long = lines.find((l) => l.length > WORKTREE_LIST_MAX.length);
  if (long) return `${what}: keep each entry under ${WORKTREE_LIST_MAX.length} characters.`;
  if (opts.shared) for (const l of lines) {
    const problem = sharedDirProblem(l);
    if (problem) return `${what}: ${problem}`;
  }
  return null;
}

/** A list as stored: its entries one per line, or null when there are none. */
export const storedList = (text: string | null | undefined): string | null => listLines(text).join('\n') || null;
