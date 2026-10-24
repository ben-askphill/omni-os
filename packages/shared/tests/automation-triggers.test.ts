import { readFileSync } from 'node:fs';
import { fixture } from '@omni/test-fixtures';
import { describe, expect, it } from 'vitest';
import { deliveryStages, isDeliveryAhead, isPendingDelivery, TRIGGER_DELIVERY_STATES, type TriggerDeliveryState } from '../automation-triggers.ts';

// The same cases run in apps/mac/OmniKit/Tests/OmniKitTests/DeliveryStagesTests.swift.
const cases = JSON.parse(readFileSync(fixture('delivery-stages.json'), 'utf8')) as { case: string; input: Parameters<typeof deliveryStages>[0]; expected: unknown }[];

describe('deliveryStages', () => {
  it.each(cases.map((c) => [c.case, c] as const))('%s', (_, c) => {
    expect(deliveryStages(c.input)).toEqual(c.expected);
  });
});

describe('isDeliveryAhead', () => {
  const at = (attempt: number, state: TriggerDeliveryState) => ({ attempt, state });

  it('within an attempt, only a higher state wins', () => {
    expect(isDeliveryAhead(at(1, 'started'), at(1, 'accepted'))).toBe(true);
    expect(isDeliveryAhead(at(1, 'accepted'), at(1, 'started'))).toBe(false);
    expect(isDeliveryAhead(at(1, 'accepted'), at(1, 'accepted'))).toBe(false);
    expect(isDeliveryAhead(at(1, 'queued'), at(1, 'accepted'))).toBe(false);
  });

  it('started beats a skip that raced it, and a skip beats a failure', () => {
    expect(isDeliveryAhead(at(1, 'started'), at(1, 'skipped'))).toBe(true);
    expect(isDeliveryAhead(at(1, 'skipped'), at(1, 'started'))).toBe(false);
    expect(isDeliveryAhead(at(1, 'skipped'), at(1, 'failed'))).toBe(true);
    expect(isDeliveryAhead(at(1, 'failed'), at(1, 'skipped'))).toBe(false);
  });

  it('a later attempt beats every state of an earlier one, so a stale failed copy never undoes a retry', () => {
    for (const s of TRIGGER_DELIVERY_STATES) {
      expect(isDeliveryAhead(at(2, 'queued'), at(1, s))).toBe(true);
      expect(isDeliveryAhead(at(1, s), at(2, 'queued'))).toBe(false);
    }
  });

  it('only received, accepted and queued are pending', () => {
    expect(TRIGGER_DELIVERY_STATES.filter(isPendingDelivery)).toEqual(['received', 'accepted', 'queued']);
  });
});
