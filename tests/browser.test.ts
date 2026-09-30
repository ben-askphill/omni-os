import { describe, it, expect } from 'vitest';
import { normalizeUrl } from '../server/browser.ts';

describe('normalizeUrl: the address bar', () => {
  it('adds https to a bare host', () => {
    expect(normalizeUrl('example.com')).toBe('https://example.com/');
    expect(normalizeUrl('  shop.example.com/products?a=1 ')).toBe('https://shop.example.com/products?a=1');
    expect(normalizeUrl('shop.example.com:8443/x')).toBe('https://shop.example.com:8443/x');
  });

  it('keeps http for localhost', () => {
    expect(normalizeUrl('localhost:4748/#/')).toBe('http://localhost:4748/#/');
    expect(normalizeUrl('127.0.0.1:3000')).toBe('http://127.0.0.1:3000/');
  });

  it('searches for words', () => {
    expect(normalizeUrl('volero bikes')).toBe('https://www.google.com/search?q=volero%20bikes');
    expect(normalizeUrl('amsterdam')).toBe('https://www.google.com/search?q=amsterdam');
  });

  it('refuses anything but web pages', () => {
    for (const u of ['file:///etc/passwd', 'chrome://settings', 'javascript:alert(1)', 'data:text/html,hi', '']) expect(normalizeUrl(u)).toBeNull();
    expect(normalizeUrl('about:blank')).toBe('about:blank');
  });
});
