import { describe, expect, it } from 'vitest';
import { Updater, type UpdateDeps } from '../update.ts';
import { CheckoutTrack } from '../update-tracks.ts';

const failingUpdater = () =>
  new Updater({
    root: '/nowhere',
    current: () => 'abc',
    supervised: () => true,
    bundled: false,
    enabled: () => false,
    runningTurns: () => 0,
    install: async () => 'Updating to main failed. dirty',
    restart: () => {},
    sleep: async () => {},
    changed: () => {},
  } satisfies UpdateDeps);

describe('a checkout track', () => {
  it('drops the last failure when it is asked again, so neither the row nor the sidebar still says failed', async () => {
    const updater = failingUpdater();
    const track = new CheckoutTrack(updater, () => {});
    updater.apply();
    await expect.poll(() => updater.view().phase).toBe('failed');
    expect(track.state()).toMatchObject({ phase: 'failed', error: 'Updating to main failed. dirty' });

    await track.check();
    expect(updater.view().phase).toBe('idle');
    expect(track.state()).toMatchObject({ phase: 'idle', error: null });
  });
});
