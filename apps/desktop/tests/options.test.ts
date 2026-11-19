import { describe, expect, it } from 'vitest';
import { launchRoute, linkRoute, parseOptions } from '../src/options.ts';

describe('omni:// links and a launch on a page', () => {
  it('turns a link into the hash route after the scheme', () => {
    expect(linkRoute('omni://t/0b1c2d3e-0000-4000-8000-000000000001')).toBe('#/t/0b1c2d3e-0000-4000-8000-000000000001');
    expect(linkRoute('OMNI://c/acme')).toBe('#/c/acme');
    expect(linkRoute('omni:///c/acme')).toBe('#/c/acme');
    expect(linkRoute('omni://')).toBe('#/');
  });

  it('opens the pairing link a remote agent\'s helper prints as the Connect an agent page, query and all', () => {
    const link = 'omni://connect-agent?url=http%3A%2F%2Fhermes.tail1.ts.net%3A8642&code=GB8Z-DP5J-0TGX-R608-WYSB-WV2T-G8SV&name=Hermes%20on%20box&pair=http%3A%2F%2Fhermes.tail1.ts.net%3A8643';
    expect(linkRoute(link)).toBe(`#/${link.slice('omni://'.length)}`);
    expect(launchRoute(['/Applications/Omni.app/Contents/MacOS/Omni', link])).toBe(`#/${link.slice('omni://'.length)}`);
  });

  it('refuses any other scheme and anything the Web UI would not route', () => {
    expect(linkRoute('https://example.com/#/t/x')).toBeNull();
    expect(linkRoute('omni://t/x"><script>')).toBeNull();
    expect(linkRoute('omni://t/x y')).toBeNull();
  });

  it('reads the page from a first launch: --route, --route=, or a link the OS passed', () => {
    expect(parseOptions(['--route=#/t/abc'])).toMatchObject({ route: '#/t/abc' });
    expect(parseOptions(['omni://c/acme'])).toMatchObject({ route: '#/c/acme' });
  });

  it('reads the page from a second launch’s argv as Chromium hands it over: switches first, everything else at the end', () => {
    // As seen on Linux for `electron apps/desktop --port 4791 --data-dir <d> --route=#/t/abc` (Electron 44).
    const seen = ['/x/electron', '--port', '--data-dir', '--user-data-dir=/u', '--route=#/t/abc', '--allow-file-access-from-files', '--ozone-platform=wayland', '/x/apps/desktop', '4791', '/d'];
    expect(launchRoute(seen)).toBe('#/t/abc');
    expect(launchRoute(['/opt/Omni/omni-os', '--route', '--no-sandbox', '#/c/acme'])).toBe('#/c/acme');
    expect(launchRoute(['/Applications/Omni.app/Contents/MacOS/Omni', 'omni://t/abc'])).toBe('#/t/abc');
    expect(launchRoute(['/opt/Omni/omni-os', '--no-sandbox'])).toBeNull();
    expect(launchRoute(['/opt/Omni/omni-os', '--route=#/t/x y'])).toBeNull();
  });
});
