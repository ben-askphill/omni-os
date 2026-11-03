import { describe, expect, it } from 'vitest';
import { readAddress, SEARCH_URL } from '../address-bar.ts';

// One table for both address bars: the agent's Browser tab (apps/server) and the desktop app's Web tab (apps/web).
const page = (url: string) => ({ kind: 'page', url });
const search = (text: string) => ({ kind: 'search', url: SEARCH_URL + encodeURIComponent(text) });
const refused = { kind: 'refused' };

describe('readAddress', () => {
  it.each([
    ['https://example.com/a?b=1', page('https://example.com/a?b=1')],
    ['HTTP://Example.com', page('http://example.com/')],
    ['  example.com ', page('https://example.com/')],
    ['shop.example.com/products?a=1', page('https://shop.example.com/products?a=1')],
    ['shop.example.com:8443/x', page('https://shop.example.com:8443/x')],
    ['localhost:4748/#/', page('http://localhost:4748/#/')],
    ['localhost', page('http://localhost/')],
    ['app.localhost', page('http://app.localhost/')],
    ['myhost.local', page('http://myhost.local/')],
    ['127.0.0.1:3000', page('http://127.0.0.1:3000/')],
    ['192.168.1.5:3000', page('http://192.168.1.5:3000/')],
    ['[::1]:3000', page('http://[::1]:3000/')],
    ['about:blank', page('about:blank')],
    ['volero bikes', search('volero bikes')],
    ['amsterdam', search('amsterdam')],
    ['user@example.com', search('user@example.com')],
    ['file:///etc/passwd', refused],
    ['chrome://settings', refused],
    ['javascript:alert(1)', refused],
    ['data:text/html,hi', refused],
    ['vscode://file/x', refused],
    ['mailto:a@b.co', refused],
    ['about:config', refused],
  ])('%s', (text, expected) => {
    expect(readAddress(text)).toEqual(expected);
  });

  it('reads nothing into blank input', () => {
    expect(readAddress('')).toBeNull();
    expect(readAddress('   ')).toBeNull();
  });
});
