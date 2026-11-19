import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { connectPage, errorPage, pageHeaders } from '../src/page.ts';

// The Connect page's CSP lets its one inline script run by hash, so no other script on the page could.

describe('the Connect page', () => {
  it("names its inline script by hash, with no 'unsafe-inline' for scripts", async () => {
    const csp = (await pageHeaders())['content-security-policy'];
    const script = /<script>([\s\S]*?)<\/script>/.exec(connectPage())?.[1] ?? '';
    expect(script).toContain("$('#signout')");
    const hash = createHash('sha256').update(script, 'utf8').digest('base64');
    const scriptSrc = csp.split('; ').find((d) => d.startsWith('script-src '));
    expect(scriptSrc).toBe(`script-src 'sha256-${hash}'`);
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("base-uri 'none'");
  });

  it('serves the error page with no script at all', () => {
    expect(errorPage('<b>nope</b>')).not.toContain('<script');
    expect(errorPage('<b>nope</b>')).toContain('&#60;b&#62;nope&#60;/b&#62;');
  });
});
