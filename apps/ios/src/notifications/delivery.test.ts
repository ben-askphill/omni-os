import { describe, expect, it } from 'vitest';

import { deliveryNote } from './delivery';

describe('deliveryNote', () => {
  it('says nothing for a server that can send, or before it has answered', () => {
    expect(deliveryNote({ registration: true, delivery: true, problem: null })).toBeNull();
    expect(deliveryNote(null)).toBeNull();
  });

  it('names the missing secrets the server reports', () => {
    const note = deliveryNote({ registration: true, delivery: false, problem: 'missing APNS_KEY_ID, APNS_AUTH_KEY' });
    expect(note).toContain('cannot send alerts');
    expect(note).toContain('(missing APNS_KEY_ID, APNS_AUTH_KEY)');
    expect(note).toContain('Settings, then Secrets');
  });

  it('still warns a server too old to say why', () => {
    expect(deliveryNote({ registration: true, delivery: false })).toMatch(/^This server cannot send alerts yet: its APNs key is not set up\. /);
  });
});
