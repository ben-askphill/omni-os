// The two letters a channel, role or person shows in place of an icon: the rail's discs, avatars in headers and rows,
// on the web, the phone layout and the iOS app. Pure.

const words = (name: string) =>
  name
    .trim()
    .split(/[\s_-]+/)
    .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter(Boolean);

/**
 * Two uppercase letters: the first letters of the first two words ("Acne Studios" AS), a short acronym that follows
 * the name ("Omni OS" OS), else the first two letters ("Patta" PA). One letter for a one-letter name, "?" for none.
 */
export function monogram(name: string): string {
  const w = words(name);
  if (w.length === 2 && /^[A-Z]{2,3}$/.test(w[1])) return w[1].slice(0, 2);
  if (w.length >= 2) return (w[0][0] + w[1][0]).toUpperCase();
  return (w[0] ?? '?').slice(0, 2).toUpperCase();
}

/**
 * Every channel's monogram, unique across the set. Channels keep their own monogram in id order; a later one that
 * would repeat an earlier one keeps its first letter and takes the next letter of its name that frees it ("Central
 * Brain" CB, then "Client Bureau" CL), else a digit. The same set gives the same letters whatever order it comes in.
 * Keyed by id and by name, so a caller holding either finds it.
 */
export function monograms(items: readonly { id: string; name: string }[]): Map<string, string> {
  const out = new Map<string, string>();
  const taken = new Set<string>();
  for (const it of [...items].sort((a, b) => a.id.localeCompare(b.id))) {
    let m = monogram(it.name);
    if (taken.has(m)) {
      const first = m[0];
      const rest = words(it.name).join('').toUpperCase().slice(1);
      m = [...rest, '2', '3', '4', '5', '6', '7', '8', '9'].map((c) => first + c).find((c) => !taken.has(c)) ?? m;
    }
    taken.add(m);
    out.set(it.id, m);
    if (!out.has(it.name)) out.set(it.name, m);
  }
  return out;
}
