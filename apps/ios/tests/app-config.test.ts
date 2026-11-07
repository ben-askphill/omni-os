import { describe, expect, it } from 'vitest';

import config, { apsEnvironment, appConfig, usesDevClient } from '../app.config';

describe('apsEnvironment', () => {
  it('signs distribution profiles for production APNs and everything else for the sandbox', () => {
    expect(apsEnvironment('production')).toBe('production');
    expect(apsEnvironment('preview')).toBe('production');
    expect(apsEnvironment('development')).toBe('development');
    expect(apsEnvironment('development-simulator')).toBe('development');
    expect(apsEnvironment(undefined)).toBe('development');
  });
});

describe('usesDevClient', () => {
  it('leaves the development client out of store and internal test builds', () => {
    expect(usesDevClient('production')).toBe(false);
    expect(usesDevClient('preview')).toBe(false);
  });

  it('keeps it in development builds and in a local run, which has no profile', () => {
    expect(usesDevClient('development')).toBe(true);
    expect(usesDevClient('development-simulator')).toBe(true);
    expect(usesDevClient(undefined)).toBe(true);
  });
});

describe('app config', () => {
  it('adds the notifications plugin that writes the push entitlement', () => {
    const plugin = appConfig.plugins?.find((entry) => Array.isArray(entry) && entry[0] === 'expo-notifications');
    expect(plugin).toBeDefined();
  });

  it('keeps the bundle id the server\'s alerts are addressed to', () => {
    expect(appConfig.ios?.bundleIdentifier).toBe('app.omni-os.ios');
  });

  it('ships on iPhone only', () => {
    expect(appConfig.ios?.supportsTablet).toBe(false);
  });

  it('declares no non-exempt encryption, so App Store Connect skips the export question', () => {
    expect(appConfig.ios?.infoPlist?.ITSAppUsesNonExemptEncryption).toBe(false);
  });

  it('has a local network usage string, since the app connects to a server on the LAN', () => {
    expect(appConfig.ios?.infoPlist?.NSLocalNetworkUsageDescription).toBeDefined();
  });

  it('declares no tracking and no collected data, because the data goes to the user\'s own server', () => {
    expect(appConfig.ios?.privacyManifests?.NSPrivacyTracking).toBe(false);
    expect(appConfig.ios?.privacyManifests?.NSPrivacyCollectedDataTypes).toEqual([]);
  });

  it('declares the required-reason APIs the release binary calls', () => {
    const reasons = appConfig.ios?.privacyManifests?.NSPrivacyAccessedAPITypes?.map((entry) => [
      entry.NSPrivacyAccessedAPIType,
      entry.NSPrivacyAccessedAPITypeReasons,
    ]);
    expect(reasons).toEqual([
      ['NSPrivacyAccessedAPICategoryUserDefaults', ['CA92.1']],
      ['NSPrivacyAccessedAPICategoryFileTimestamp', ['C617.1']],
      ['NSPrivacyAccessedAPICategorySystemBootTime', ['35F9.1']],
    ]);
  });

  it('keeps the EAS project id that eas init saves in app.json', () => {
    const merged = config({
      projectRoot: '.',
      staticConfigPath: 'app.json',
      packageJsonPath: 'package.json',
      config: { extra: { eas: { projectId: 'project-id' } } },
    });
    expect(merged.extra?.eas?.projectId).toBe('project-id');
    expect(merged.ios?.bundleIdentifier).toBe('app.omni-os.ios');
  });
});
