// The security headers on the Web UI shell: the built index.html that app.ts serves for `/` and every client route.
// Only that page gets them. Artifacts, uploads and the design system stay under /api with their own sandbox CSP, and
// the Web UI frames them from the same origin, so a frame-ancestors guard on them would break those frames.
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';

/**
 * Where the shell's browser posts a CSP violation (csp-report-api.ts), by `report-uri`. Not `report-to` with
 * Reporting-Endpoints: Chromium and Electron never delivered those to http://127.0.0.1 (80 s and more in tests,
 * 2026-11-19), and with `report-to` in the policy Chromium skips `report-uri`, so nothing would arrive at all.
 */
export const CSP_REPORT_PATH = '/api/csp-report';

const INLINE_SCRIPT = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;

/** The `'sha256-…'` source of each inline script in `html`. A `<script src>` loads from 'self' and needs none. */
function inlineScriptHashes(html: string): string[] {
  const hashes: string[] = [];
  for (const [, attrs, body] of html.matchAll(INLINE_SCRIPT)) {
    if (/\bsrc\s*=/i.test(attrs)) continue;
    hashes.push(`'sha256-${createHash('sha256').update(body, 'utf8').digest('base64')}'`);
  }
  return hashes;
}

/**
 * The Trusted Types policies the Web UI may create (apps/web/src/trusted-html.ts): `omni-mermaid` for a diagram's SVG,
 * `default` for Mermaid's own writes while it draws, and `dompurify`, which DOMPurify creates for its parser.
 */
export const TRUSTED_TYPES_POLICIES = ['omni-mermaid', 'dompurify', 'default'] as const;

/**
 * The shell's policy. Scripts only from this origin and the inline theme script (by hash), no plugins, no `<base>`,
 * no framing. `style-src` stays open: React style attributes and Tailwind's arbitrary values need inline styles.
 * Trusted Types: a string written to a DOM sink (innerHTML, DOMParser, eval, a script's src) must come from one of the
 * named policies. Browsers without Trusted Types (iPhone Safari before 26) ignore both directives.
 */
function shellPolicy(hashes: string[]): string {
  return [
    `script-src 'self' ${[...hashes, "'report-sample'"].join(' ')}`,
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    "require-trusted-types-for 'script'",
    `trusted-types ${TRUSTED_TYPES_POLICIES.join(' ')}`,
    `report-uri ${CSP_REPORT_PATH}`,
  ].join('; ');
}

/**
 * Every header the shell gets. The full policy is report-only for now: violations reach /api/csp-report and the
 * console, and nothing is blocked. The clickjacking guard is enforced already, as frame-ancestors and as
 * X-Frame-Options for browsers that read only that, along with nosniff and the referrer policy.
 */
function shellHeaders(hashes: string[]): Record<string, string> {
  return {
    'Content-Security-Policy-Report-Only': shellPolicy(hashes),
    'Content-Security-Policy': "frame-ancestors 'none'",
    'X-Frame-Options': 'DENY',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
  };
}

type Shell = { html: string; headers: Record<string, string>; stamp: string };
let cached: Shell | null = null;

/**
 * The built index.html and its headers, read again when the file changes, so a rebuild's new inline script gets its
 * own hash without a restart and nobody keeps a hash constant in step by hand.
 */
export function webShell(file: string): Shell {
  const st = statSync(file);
  const stamp = `${file}:${st.mtimeMs}:${st.size}`;
  if (cached?.stamp !== stamp) {
    const html = readFileSync(file, 'utf8');
    cached = { html, headers: shellHeaders(inlineScriptHashes(html)), stamp };
  }
  return cached;
}
