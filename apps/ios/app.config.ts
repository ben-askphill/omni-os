import type { ConfigContext, ExpoConfig } from 'expo/config';

// expo-camera and expo-image-picker both write NSCameraUsageDescription, so they share one sentence for both uses.
const CAMERA = 'Omni OS uses the camera to scan the pairing code shown on your computer and to take photos you attach to a message.';

/**
 * The build variant: `production`, `preview` or `development`. Each EAS build profile sets APP_VARIANT in eas.json. The
 * EAS workflow sets it on its fingerprint and update jobs too, because they resolve this config outside a build, and a
 * different config there gives a different fingerprint, so the update would never match the build. A local
 * `expo run:ios` sets none.
 */
const VARIANT = process.env.APP_VARIANT;

/**
 * The APNs environment the build's `aps-environment` entitlement names. Only the development-client profiles talk to
 * Apple's sandbox. An internal-distribution (`preview`) or store build is signed for production, and the app registers
 * its token under the same name (`pushEnvironment` in src/notifications/environment.ts).
 */
export function apsEnvironment(variant: string | undefined): 'development' | 'production' {
  return variant === 'production' || variant === 'preview' ? 'production' : 'development';
}

/**
 * Whether the build carries the development client, which adds the Metro launcher. A local `expo run:ios` has no
 * variant and gets the client. Store and internal test builds run the app alone.
 */
export function usesDevClient(variant: string | undefined): boolean {
  return variant !== 'production' && variant !== 'preview';
}

export const appConfig: ExpoConfig = {
  name: 'Omni',
  slug: 'omni-os-ios',
  version: '0.1.0',
  scheme: 'omni-os',
  orientation: 'portrait',
  userInterfaceStyle: 'automatic',
  icon: './assets/icon.png',
  ios: {
    bundleIdentifier: 'app.omni-os.ios',
    supportsTablet: false,
    infoPlist: {
      NSAppTransportSecurity: { NSAllowsLocalNetworking: true },
      NSLocalNetworkUsageDescription: 'Omni OS connects to your Omni server on your local network.',
      // Standard HTTPS and OS crypto only, which is exempt.
      ITSAppUsesNonExemptEncryption: false,
    },
    privacyManifests: {
      NSPrivacyTracking: false,
      NSPrivacyTrackingDomains: [],
      // The app sends its data to the user's own server, not to the developer, and includes no analytics or crash SDK.
      NSPrivacyCollectedDataTypes: [],
      // Required-reason APIs the app binary and its bundled React Native and Expo code call. Verified by nm on the
      // unsigned Release archive. DiskSpace is declared by ExpoFileSystem's own manifest, so it is not repeated here.
      NSPrivacyAccessedAPITypes: [
        { NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryUserDefaults', NSPrivacyAccessedAPITypeReasons: ['CA92.1'] },
        { NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryFileTimestamp', NSPrivacyAccessedAPITypeReasons: ['C617.1'] },
        { NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategorySystemBootTime', NSPrivacyAccessedAPITypeReasons: ['35F9.1'] },
      ],
    },
  },
  plugins: [
    ...(usesDevClient(VARIANT) ? ['expo-dev-client'] : []),
    ['expo-build-properties', { ios: { deploymentTarget: '18.0' } }],
    // The scanner reads QR codes only: no video and no microphone.
    ['expo-camera', { cameraPermission: CAMERA, microphonePermission: false }],
    ['expo-notifications', { mode: apsEnvironment(VARIANT) }],
    // Photos only: no video, so no microphone.
    ['expo-image-picker', { photosPermission: 'Omni OS reads the photos you pick so you can attach them to a message.', cameraPermission: CAMERA, microphonePermission: false }],
    [
      'expo-splash-screen',
      {
        image: './assets/icon.png',
        resizeMode: 'contain',
        imageWidth: 200,
        backgroundColor: '#ffffff',
        dark: { backgroundColor: '#121316' },
      },
    ],
  ],
  // EAS Update: a published update reaches only builds whose native code it was made for. The fingerprint hashes the
  // native dependencies and this config, so adding a native module or a plugin option needs a new build.
  runtimeVersion: { policy: 'fingerprint' },
  experiments: { reactCompiler: true },
};

/** Where expo-updates asks for new JavaScript. EAS Update serves each project from its own URL. */
export function updatesUrl(projectId: string | undefined): string | undefined {
  return projectId ? `https://u.expo.dev/${projectId}` : undefined;
}

/**
 * `eas init` saves the EAS project id, and the account when it differs, in app.json. Expo passes app.json in as
 * `config`, so keeping it in the merge lets EAS write the id itself. With a plain object export it stops and asks for
 * a hand edit. The updates URL comes from the same id.
 */
export default ({ config }: ConfigContext): ExpoConfig => {
  const url = updatesUrl(config.extra?.eas?.projectId);
  return { ...config, ...appConfig, ...(url ? { updates: { url } } : {}) };
};
