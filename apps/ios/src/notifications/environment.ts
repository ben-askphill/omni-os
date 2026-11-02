import type { AppPushTokenRequest } from '@omni/shared/app-pairing.ts';

export const BUNDLE_ID = 'app.omni-os.ios';

export type PushEnvironment = AppPushTokenRequest['environment'];

/**
 * Which APNs the build's tokens belong to. A development client (`__DEV__`) built on a Mac with a development profile
 * gets sandbox tokens. Store, TestFlight and internal-distribution builds are signed for production. A token sent under
 * the wrong name makes Apple answer BadDeviceToken, and the server drops the registration.
 *
 * An EAS `development` build is the exception: internal distribution signs it ad hoc, which means production tokens
 * even though `__DEV__` is true. `override` (the `EXPO_PUBLIC_PUSH_ENVIRONMENT` variable Metro was started with) names
 * the environment for that case. Anything but `sandbox` or `production` is ignored.
 */
export function pushEnvironment(isDev: boolean, override?: string): PushEnvironment {
  if (override === 'sandbox' || override === 'production') return override;
  return isDev ? 'sandbox' : 'production';
}
