// Masks secrets in Ben's own messages before the usage scan hands any of their text to a model (labels.ts, scan.ts).
// The patterns are those of Cloudroom's workflow-scan extractor (github.com/davidondrej/cloudroom,
// gui/plugins/automations/skills/workflow-scan/extract.py, Apache 2.0). On top, the exact values of the secrets in
// Omni's own store are masked: a value with no telltale shape (a password, a short API key) gets past every pattern.

export const MASK = '[masked]';

const PRIVATE_KEY = /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g;
const TOKEN = new RegExp(
  [
    'sk-[A-Za-z0-9_\\-]{16,}',
    'gh[pousr]_[A-Za-z0-9]{20,}',
    'github_pat_[A-Za-z0-9_]{20,}',
    'AKIA[0-9A-Z]{16}',
    'xox[abpr]-[A-Za-z0-9\\-]{10,}',
    'eyJ[A-Za-z0-9_\\-]{10,}\\.[A-Za-z0-9_\\-]{10,}\\.[A-Za-z0-9_\\-]{10,}',
    'AIza[0-9A-Za-z_\\-]{35}',
    '\\b[rsp]k_(?:live|test)_[0-9A-Za-z]{16,}',
    '\\bBearer\\s+[A-Za-z0-9._~+/\\-]{12,}=*',
    // Any long run of token characters: a hash, a key, a session id.
    '\\b[A-Za-z0-9_\\-]{40,}\\b',
  ].join('|'),
  'g',
);
/** The password in `scheme://user:password@host`. */
const URL_PASSWORD = /(\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:)[^\s@/]+(@)/gi;
/** The value after a key that names a secret: `password=…`, `api_key: …`, `TOKEN="…"`. */
const SECRET_VALUE =
  /(\b[\w.-]*(?:passw(?:or)?d|pwd|secret|token|api[_-]?key|access[_-]?key|auth|credential)s?[\w.-]*["']?\s*[:=]\s*["']?)(?!\[masked\])[^\s"'&,;]{6,}/gi;

/** Shorter values are left alone: masking every "1234" or "true" would mask ordinary words. */
export const MIN_EXACT = 6;

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * `text` with every secret replaced by `[masked]`, and how many it replaced. `exact` are values known to be secret
 * (Omni's secret store); they are masked wherever they appear, longest first, before the patterns run.
 */
export function maskSecrets(text: string, exact: readonly string[] = []): { text: string; masked: number } {
  let masked = 0;
  const count = () => (masked++, MASK);
  let out = text;
  const values = [...new Set(exact.filter((v) => v.length >= MIN_EXACT))].sort((a, b) => b.length - a.length);
  if (values.length) out = out.replace(new RegExp(values.map(escape).join('|'), 'g'), count);
  out = out.replace(PRIVATE_KEY, count).replace(TOKEN, count);
  out = out.replace(URL_PASSWORD, (_m, head: string, at: string) => `${head}${count()}${at}`);
  out = out.replace(SECRET_VALUE, (_m, head: string) => `${head}${count()}`);
  return { text: out, masked };
}
