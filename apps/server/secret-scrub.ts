// The values of every secret this server process has read or written, so a value an agent prints later (into a tool
// result, a reply, an error) never lands in a stored event, a synced row or a tool-failure note. In memory only, keyed
// by store account (secrets.ts registers on read and write and forgets on delete), so nothing here outlives the
// process, and a row written before the process read the value is not covered. Values shorter than SCRUB_MIN are
// skipped, as the brain export's redactor skips them: too short to be a secret, and a match on every "abc".
const SCRUB_MIN = 6;

const known = new Map<string, string>();
/** The known values, longest first, so a value that contains another is replaced whole. Rebuilt when the map changes. */
let ordered: { value: string; label: string }[] = [];

function rebuild() {
  ordered = [...known]
    .filter(([, value]) => value.length >= SCRUB_MIN)
    .map(([account, value]) => ({ value, label: `[secret ${account.slice(account.indexOf('/') + 1)}]` }))
    .sort((a, b) => b.value.length - a.value.length);
}

/** A value the store holds under `account` (`scope/NAME`), read or written by this process. */
export function registerSecret(account: string, value: string) {
  if (known.get(account) === value) return;
  known.set(account, value);
  rebuild();
}

export function forgetSecret(account: string) {
  if (known.delete(account)) rebuild();
}

/** `s` with every known value replaced by `[secret NAME]`. */
export function scrubText(s: string): string {
  for (const { value, label } of ordered) if (s.includes(value)) s = s.split(value).join(label);
  return s;
}

/**
 * The payload with every string in it scrubbed, walked as an object rather than as JSON text: in the text, a value
 * with a quote or a backslash in it would be escaped and missed. The same object back when there is nothing to scrub.
 */
export function scrubSecrets<T>(payload: T): T {
  return ordered.length ? (walk(payload) as T) : payload;
}

function walk(v: unknown): unknown {
  if (typeof v === 'string') return scrubText(v);
  if (Array.isArray(v)) return v.map(walk);
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) out[k] = walk(x);
    return out;
  }
  return v;
}
