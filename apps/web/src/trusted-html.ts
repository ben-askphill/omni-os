// The Web UI's Trusted Types policies. The shell's CSP (apps/server/web-headers.ts) asks for
// `require-trusted-types-for 'script'` and allows only the policy names below, so a plain string written to an HTML
// sink (innerHTML, DOMParser, …) is a violation the shell reports to /api/csp-report. It is report-only for now.
//
// A browser without Trusted Types (iPhone Safari before 26) gets the same sanitizing, with strings for TrustedHTML.
// TypeScript's DOM types do not have the API yet, so the little this file uses is typed here.

type Rules = { createHTML: (input: string) => string | null };
type Factory = { createPolicy(name: string, rules: Rules): { createHTML(input: string): TrustedHTML } };

const factory = (globalThis as { trustedTypes?: Factory }).trustedTypes;

/** The policies this file creates, as the CSP's `trusted-types` lists them. DOMPurify creates its own `dompurify`. */
export const POLICY_NAMES = ['omni-mermaid', 'default'] as const;

/** One named character reference, `&amp;`. Parsed as HTML it can only ever be text. */
const CHARACTER_REFERENCE = /^&[A-Za-z0-9]{1,31};$/;
let mermaidWrites = 0;

/**
 * The default policy: the browser asks it about every plain string that reaches an HTML sink. It lets through the
 * writes of two libraries that predate Trusted Types and answers null to everything else, which stays a violation:
 * - react-markdown's entity decoder (decode-named-character-reference) writes `&name;` into an <i> to read it back.
 * - Mermaid, while it draws (whileMermaidDraws), writes its style rules and d3's label HTML, each first run through its
 *   DOMPurify at securityLevel 'strict'.
 * Made when this module loads (main.tsx imports it first), before any Markdown renders.
 */
factory?.createPolicy('default', { createHTML: (input) => (mermaidWrites > 0 || CHARACTER_REFERENCE.test(input) ? input : null) });

/** Runs `render` with Mermaid's own writes let through. The SVG it hands back still goes through mermaidHtml. */
export async function whileMermaidDraws<T>(render: () => Promise<T>): Promise<T> {
  mermaidWrites += 1;
  try {
    return await render();
  } finally {
    mermaidWrites -= 1;
  }
}

/** The DOMPurify pass Mermaid runs on its own SVG at securityLevel 'strict' (mermaidAPI's render). */
const MERMAID_SVG = { ADD_TAGS: ['foreignobject'], ADD_ATTR: ['dominant-baseline'], HTML_INTEGRATION_POINTS: { foreignobject: true } };

type Purify = { sanitize(dirty: string, config: typeof MERMAID_SVG): string };
let mermaidPolicy: { createHTML(input: string): TrustedHTML | string } | null = null;

/** Mermaid's SVG sanitized once more by the omni-mermaid policy, as TrustedHTML for the diagram's innerHTML. */
export function mermaidHtml(svg: string, purify: Purify): TrustedHTML | string {
  const rules = { createHTML: (input: string) => purify.sanitize(input, MERMAID_SVG) };
  mermaidPolicy ??= factory ? factory.createPolicy('omni-mermaid', rules) : rules;
  return mermaidPolicy.createHTML(svg);
}

/** Parses HTML a policy made. DOMParser takes TrustedHTML; TypeScript's DOM types only know strings. */
export const parseTrusted = (html: TrustedHTML | string) => new DOMParser().parseFromString(html as string, 'text/html');
