/** A path as a row shows it: relative to `cwd` when under it, `~/` for a macOS home, and at most its last three parts. */
export function shortPath(p: string, cwd?: string | null) {
  if (!p) return '';
  if (cwd && p.startsWith(cwd + '/')) return p.slice(cwd.length + 1);
  const home = p.match(/^\/Users\/[^/]+\//);
  const rel = home ? '~/' + p.slice(home[0].length) : p;
  const parts = rel.split('/');
  return parts.length > 4 ? '.../' + parts.slice(-3).join('/') : rel;
}
