import { describe, expect, it } from 'vitest';

import { deliveryNote } from './delivery';

describe('deliveryNote', () => {
  it('says nothing when the server can send alerts, or when its capabilities could not be read', () => {
    expect(deliveryNote({ registration: true, delivery: true, problem: null })).toBeNull();
    expect(deliveryNote(null)).toBeNull();
  });

  it('says the server cannot send alerts, why, and what to do on the computer', () => {
    expect(deliveryNote({ registration: true, delivery: false, problem: 'missing APNS_KEY_ID, APNS_TEAM_ID, APNS_AUTH_KEY' })).toBe(
      "This server cannot send alerts yet because it has no working APNs key (missing APNS_KEY_ID, APNS_TEAM_ID, APNS_AUTH_KEY). Add the key in Omni's Settings on that computer, then restart Omni.",
    );
  });

  it('still says so for an older server that does not report why', () => {
    expect(deliveryNote({ registration: true, delivery: false })).toBe(
      "This server cannot send alerts yet because it has no working APNs key. Add the key in Omni's Settings on that computer, then restart Omni.",
    );
  });
});
