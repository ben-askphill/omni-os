import { describe, expect, it } from 'vitest';

import { fileNavigationDecision, navigationDecision, PAGE_CSP, sandboxHtml, sandboxProps, STATIC_CSP, svgDocument, textDocument } from '../src/artifacts/sandbox';

const META = '<meta http-equiv="Content-Security-Policy"';
const colors = { bg: '#fff', fg: '#000', fg2: '#333', fg3: '#666', surface: '#eee', line: '#ddd' };

describe('what a page may do', () => {
  it('forbids calls out, frames, forms and a moved base, and allows https assets', () => {
    for (const rule of ["connect-src 'none'", "frame-src 'none'", "form-action 'none'", "base-uri 'none'", "object-src 'none'", "default-src 'none'"]) {
      expect(PAGE_CSP).toContain(rule);
    }
    expect(PAGE_CSP).toContain('img-src https:');
  });

  it('lets rendered text and drawings run no script', () => {
    expect(STATIC_CSP).not.toContain('script-src');
    expect(STATIC_CSP).toContain("default-src 'none'");
  });
});

describe('sandboxHtml', () => {
  it('puts the policy after the doctype and before any element', () => {
    const out = sandboxHtml('<!DOCTYPE html><html><head><script>1</script></head></html>');
    expect(out.startsWith(`<!DOCTYPE html>${META}`)).toBe(true);
    expect(out.indexOf(META)).toBeLessThan(out.indexOf('<script>'));
  });

  it('skips leading comments, and does not put the policy in one', () => {
    const out = sandboxHtml('<!-- <!doctype html> -->\n<!doctype html><script>1</script>');
    expect(out.indexOf(META)).toBeGreaterThan(out.indexOf('-->'));
    expect(out.indexOf(META)).toBeLessThan(out.indexOf('<script>'));
    expect(out.match(/<!--/g)).toHaveLength(1);
  });

  it('starts a fragment with the policy, and drops a byte order mark', () => {
    expect(sandboxHtml('﻿<h1>x</h1>').startsWith(META)).toBe(true);
    expect(sandboxHtml('')).toBe(`${META} content="${PAGE_CSP}">`);
  });

  it('keeps the page unchanged apart from the policy', () => {
    const page = '<!doctype html><title>t</title><p>hi</p>';
    expect(sandboxHtml(page).replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, '')).toBe(page);
  });
});

describe('svgDocument', () => {
  it('draws the file as an image, so its own script and links stay dead', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>';
    const out = svgDocument(svg, { bg: '#fff' });
    expect(out).toContain('<img');
    expect(out).toContain('data:image/svg+xml');
    expect(out).not.toContain('<script');
    expect(out).toContain(STATIC_CSP);
  });
});

describe('textDocument', () => {
  it('carries the static policy and the body', () => {
    const out = textDocument('<p>hi</p>', colors);
    expect(out).toContain(STATIC_CSP);
    expect(out).toContain('<p>hi</p>');
  });
});

describe('navigationDecision', () => {
  it('allows the first load of a document with no base URL', () => {
    expect(navigationDecision({ url: 'about:blank', navigationType: 'other' })).toBe('allow');
    expect(navigationDecision({ url: 'about:blank#top', navigationType: 'other' })).toBe('allow');
  });

  it('sends a tapped web link to the system browser', () => {
    expect(navigationDecision({ url: 'https://example.com/a', navigationType: 'click', isTopFrame: true })).toBe('external');
    expect(navigationDecision({ url: 'http://example.com/a', navigationType: 'click' })).toBe('external');
  });

  it('blocks everything a script or a redirect starts', () => {
    expect(navigationDecision({ url: 'https://example.com', navigationType: 'other' })).toBe('block');
    expect(navigationDecision({ url: 'http://omni.test/api/artifacts', navigationType: 'other' })).toBe('block');
    expect(navigationDecision({ url: 'https://example.com', navigationType: 'formsubmitted' })).toBe('block');
  });

  it('blocks frames and other schemes, even when tapped', () => {
    expect(navigationDecision({ url: 'https://example.com', navigationType: 'click', isTopFrame: false })).toBe('block');
    for (const url of ['javascript:alert(1)', 'file:///etc/passwd', 'data:text/html,hi', 'omni://x', 'tel:1', 'about:srcdoc']) {
      expect(navigationDecision({ url, navigationType: 'click' })).toBe('block');
    }
  });
});

describe('fileNavigationDecision', () => {
  const uri = 'file:///cache/omni-artifacts/3-v.pdf';
  it('allows only the file itself', () => {
    expect(fileNavigationDecision({ url: uri }, uri)).toBe('allow');
    expect(fileNavigationDecision({ url: `${uri}#page=2` }, uri)).toBe('allow');
    expect(fileNavigationDecision({ url: 'file:///cache/omni-artifacts/4-v.pdf' }, uri)).toBe('block');
    expect(fileNavigationDecision({ url: 'https://example.com', navigationType: 'click' }, uri)).toBe('block');
  });
});

describe('sandboxProps', () => {
  it('gives the page no way to talk to the app', () => {
    const props = sandboxProps({ scripts: true }) as Record<string, unknown>;
    for (const forbidden of ['onMessage', 'injectedJavaScript', 'injectedJavaScriptBeforeContentLoaded', 'injectedJavaScriptForMainFrameOnly', 'baseUrl', 'headers', 'source']) {
      expect(props).not.toHaveProperty(forbidden);
    }
  });

  it('keeps no state between pages and no access to files', () => {
    const props = sandboxProps({ scripts: true });
    expect(props).toMatchObject({
      incognito: true,
      cacheEnabled: false,
      sharedCookiesEnabled: false,
      thirdPartyCookiesEnabled: false,
      allowFileAccess: false,
      allowFileAccessFromFileURLs: false,
      allowUniversalAccessFromFileURLs: false,
      javaScriptCanOpenWindowsAutomatically: false,
    });
  });

  it('leaves the decision on every URL to the navigation callback', () => {
    expect(sandboxProps({ scripts: false }).originWhitelist).toEqual(['*']);
  });

  it('turns scripts on only when asked', () => {
    expect(sandboxProps({ scripts: true }).javaScriptEnabled).toBe(true);
    expect(sandboxProps({ scripts: false }).javaScriptEnabled).toBe(false);
  });
});
