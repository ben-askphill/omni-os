import { describe, expect, it } from 'vitest';
import { resolveDelivery } from '../server/delivery.ts';

describe('resolveDelivery', () => {
  it('steers while running when caps.steer is true', () => {
    expect(resolveDelivery('steer', { steer: true }, 'running')).toBe('steer');
  });

  it('queues a steer when caps.steer is false', () => {
    expect(resolveDelivery('steer', { steer: false }, 'running')).toBe('queue');
    expect(resolveDelivery('steer', { steer: false }, 'startup')).toBe('queue');
  });

  it('interrupts while running when caps.steer is true', () => {
    expect(resolveDelivery('interrupt', { steer: true }, 'running')).toBe('interrupt');
  });

  it('kills when interrupt is asked and caps.steer is false', () => {
    expect(resolveDelivery('interrupt', { steer: false }, 'running')).toBe('kill');
  });

  it('interrupt during startup is stop-startup, the decision both call sites map to stopStartup', () => {
    expect(resolveDelivery('interrupt', { steer: true }, 'startup')).toBe('stop-startup');
    expect(resolveDelivery('interrupt', { steer: false }, 'startup')).toBe('stop-startup');
  });

  it('queues a queue-mode send during a live turn', () => {
    expect(resolveDelivery('queue', { steer: true }, 'running')).toBe('queue');
    expect(resolveDelivery('queue', { steer: false }, 'startup')).toBe('queue');
  });
});
