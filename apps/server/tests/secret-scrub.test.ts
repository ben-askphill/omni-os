import { describe, expect, it } from 'vitest';
import { forgetSecret, registerSecret, scrubSecrets, scrubText } from '../secret-scrub.ts';

// secret-scrub.ts: a value the server has read or written never comes out of what it stores (events.add, the synced
// event handler and tool-failure guidance call it). The end-to-end proof is in secret-requests.test.ts.

const VALUE = 'dummy-secret-value-0123456789';

describe('scrubSecrets', () => {
  it('replaces a registered value wherever it sits in a payload, and leaves everything else as it is', () => {
    registerSecret('channel:scratch/STRIPE_TEST_KEY', VALUE);
    const payload = { text: `token=${VALUE}`, nested: { list: [VALUE, 7, null, { deep: `x${VALUE}y${VALUE}` }] }, ok: true, n: 3 };
    expect(scrubSecrets(payload)).toEqual({
      text: 'token=[secret STRIPE_TEST_KEY]',
      nested: { list: ['[secret STRIPE_TEST_KEY]', 7, null, { deep: 'x[secret STRIPE_TEST_KEY]y[secret STRIPE_TEST_KEY]' }] },
      ok: true,
      n: 3,
    });
    forgetSecret('channel:scratch/STRIPE_TEST_KEY');
    expect(scrubText(`token=${VALUE}`)).toBe(`token=${VALUE}`);
  });

  it('replaces the longer of two overlapping values whole, and skips values too short to be a secret', () => {
    registerSecret('global/SHORT', 'abc12');
    registerSecret('global/OUTER', `${VALUE}-tail`);
    registerSecret('global/INNER', VALUE);
    expect(scrubText(`a ${VALUE}-tail b ${VALUE} c abc12`)).toBe('a [secret OUTER] b [secret INNER] c abc12');
    for (const a of ['global/SHORT', 'global/OUTER', 'global/INNER']) forgetSecret(a);
  });

  it('hands the same object back when nothing is registered', () => {
    const payload = { text: VALUE };
    expect(scrubSecrets(payload)).toBe(payload);
  });
});
