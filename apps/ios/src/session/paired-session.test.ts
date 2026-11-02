import { describe, expect, it } from 'vitest';

import { pairedSession } from './paired-session';

const server = { id: 's1', origin: 'https://omni.example.com' };

describe('pairedSession', () => {
  it('serves the server origin and reads the token for each call', async () => {
    let token: string | null = 'one';
    const session = pairedSession(server, { getToken: async () => token, confirmSignedIn: async () => true });

    expect(session.serverUrl).toBe(server.origin);
    expect(await session.token()).toBe('one');
    token = 'two';
    expect(await session.token()).toBe('two');
  });

  it('has no token when the vault cannot be read', async () => {
    const session = pairedSession(server, {
      getToken: async () => {
        throw new Error('locked');
      },
      confirmSignedIn: async () => true,
    });
    expect(await session.token()).toBeNull();
  });

  it('asks the pairing layer about the same server after a 401', async () => {
    const asked: string[] = [];
    const session = pairedSession(server, {
      getToken: async () => 'tok',
      confirmSignedIn: async (id) => {
        asked.push(id);
        return false;
      },
    });
    expect(await session.refreshAuth()).toBe(false);
    expect(asked).toEqual(['s1']);
  });

  it('retries only when the server still accepts the phone', async () => {
    const accepts = pairedSession(server, { getToken: async () => 'tok', confirmSignedIn: async () => true });
    expect(await accepts.refreshAuth()).toBe(true);

    const fails = pairedSession(server, {
      getToken: async () => 'tok',
      confirmSignedIn: async () => {
        throw new Error('storage');
      },
    });
    expect(await fails.refreshAuth()).toBe(false);
  });
});
