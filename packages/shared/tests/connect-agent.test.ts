import { describe, expect, it } from 'vitest';
import { agentKeyName, connectPageHash, groupedCode, linkOfConnectPage, normalizeCode, pairHelperCommand, parseConnectInput, slugFrom } from '../connect-agent.ts';

const LINK = 'omni://connect-agent?url=http%3A%2F%2Fhermes.tail1.ts.net%3A8642&code=GB8Z-DP5J-0TGX-R608-WYSB-WV2T-G8SV&name=Hermes%20on%20box&pair=http%3A%2F%2Fhermes.tail1.ts.net%3A8643';
const READ = { url: 'http://hermes.tail1.ts.net:8642', pair: 'http://hermes.tail1.ts.net:8643', code: 'GB8Z-DP5J-0TGX-R608-WYSB-WV2T-G8SV', name: 'Hermes on box' };

describe('parseConnectInput', () => {
  it('reads the pairing link the helper prints, and the page the desktop app opens it as', () => {
    expect(parseConnectInput(LINK)).toEqual(READ);
    expect(parseConnectInput(`  ${LINK}\n`)).toEqual(READ);
    expect(parseConnectInput(`#/${LINK.slice('omni://'.length)}`)).toEqual(READ);
  });

  it('reads an Omni page that carries the link, as a phone or browser gets it', () => {
    expect(parseConnectInput(`https://mac.tail1.ts.net:4747/${connectPageHash(LINK)}`)).toEqual(READ);
    expect(parseConnectInput(`http://localhost:4747/#/connect-agent?${LINK.split('?')[1]}`)).toEqual(READ);
  });

  it('takes a bare address as the agent, adding https to a host typed without a scheme', () => {
    expect(parseConnectInput('https://agent.example.com')).toEqual({ url: 'https://agent.example.com' });
    expect(parseConnectInput('agent.example.com:8642')).toEqual({ url: 'https://agent.example.com:8642' });
  });

  it('takes a code typed alone as a code, which the server then asks an address for', () => {
    expect(parseConnectInput('gb8z dp5j 0tgx r608 wysb wv2t g8sv')).toEqual({ code: 'gb8z dp5j 0tgx r608 wysb wv2t g8sv' });
    expect(parseConnectInput('   ')).toBeNull();
  });
});

describe('pairing codes', () => {
  it('reads a code however it was typed, and refuses what is not one', () => {
    expect(normalizeCode('gb8z-dp5j 0tgx-r6o8-wysb-wv2t-g8sv')).toBe('GB8ZDP5J0TGXR608WYSBWV2TG8SV');
    expect(normalizeCode('il11-1111-1111-1111')).toBe('1111111111111111');
    expect(normalizeCode('short')).toBe('');
    expect(normalizeCode('UUUU-UUUU-UUUU-UUUU')).toBe('');
    expect(groupedCode('gb8zdp5j0tgxr608')).toBe('GB8Z-DP5J-0TGX-R608');
  });
});

describe('names', () => {
  it('makes a harness slug and its key secret from a name', () => {
    expect(slugFrom('Hermes on Hetzner')).toBe('hermes-on-hetzner');
    expect(slugFrom('  Ågent №1 ')).toBe('agent-no1');
    expect(slugFrom('!!!')).toBe('agent');
    expect(agentKeyName('hermes-on-hetzner')).toBe('AGENT_HERMES_ON_HETZNER_KEY');
  });

  it('round-trips the desktop page to the link', () => {
    expect(linkOfConnectPage(LINK.split('?')[1])).toBe(LINK);
  });

  it('pins the helper command to a repo and a ref', () => {
    expect(pairHelperCommand('acme/omni-os', 'v0.1.40')).toBe('curl -fsSL https://raw.githubusercontent.com/acme/omni-os/v0.1.40/scripts/omni-pair.sh | sh');
  });
});
