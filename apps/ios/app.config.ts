import type { ExpoConfig } from 'expo/config';

// expo-camera and expo-image-picker both write NSCameraUsageDescription, so they share one sentence for both uses.
const CAMERA = 'Omni OS uses the camera to scan the pairing code shown on your computer and to take photos you attach to a message.';

/**
 * The APNs environment the build's `aps-environment` entitlement names. Only the development-client profiles talk to
 * Apple's sandbox. An internal-distribution (`preview`) or store build is signed for production, and the app registers
 * its token under the same name (`pushEnvironment` in src/notifications/environment.ts).
 */
export function apsEnvironment(easProfile: string | undefined): 'development' | 'production' {
  return easProfile === 'production' || easProfile === 'preview' ? 'production' : 'development';
}

/**
 * Whether the build carries the development client, which adds the Metro launcher. EAS sets EAS_BUILD_PROFILE. A local
 * `expo run:ios` has none and gets the client. Store and internal test builds run the app alone.
 */
export function usesDevClient(easProfile: string | undefined): boolean {
  return easProfile !== 'production' && easProfile !== 'preview';
}

const config: ExpoConfig = {
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
    ...(usesDevClient(process.env.EAS_BUILD_PROFILE) ? ['expo-dev-client'] : []),
    ['expo-build-properties', { ios: { deploymentTarget: '18.0' } }],
    // The scanner reads QR codes only: no video and no microphone.
    ['expo-camera', { cameraPermission: CAMERA, microphonePermission: false }],
    ['expo-notifications', { mode: apsEnvironment(process.env.EAS_BUILD_PROFILE) }],
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
  experiments: { reactCompiler: true },
};

export default config;
