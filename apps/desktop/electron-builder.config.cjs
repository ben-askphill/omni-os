// electron-builder's config for Omni. Run it through scripts/dist.ts, which builds dist/, stages build/omni for one
// platform and arch, and names that same arch here, so the targets below carry none of their own.
const { execFileSync } = require('node:child_process');

const env = process.env;

/** The GitHub repo releases go to, from this checkout's origin. */
function githubRepo() {
  try {
    const url = execFileSync('git', ['remote', 'get-url', 'origin'], { cwd: __dirname, encoding: 'utf8' }).trim();
    const match = url.match(/github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?\/?$/);
    return match ? { owner: match[1], repo: match[2] } : null;
  } catch {
    return null;
  }
}

/** electron-builder notarizes when one of Apple's credential sets is in the environment. Without one it skips. */
const notarize = Boolean(
  (env.APPLE_API_KEY && env.APPLE_API_KEY_ID && env.APPLE_API_ISSUER) ||
    (env.APPLE_ID && env.APPLE_APP_SPECIFIC_PASSWORD && env.APPLE_TEAM_ID) ||
    (env.APPLE_KEYCHAIN && env.APPLE_KEYCHAIN_PROFILE),
);

// Keychain auto-discovery finds only a "Developer ID Application" identity. scripts/build-desktop.sh names an
// "Apple Development" one here instead, so a local build keeps one signature from build to build, and macOS keeps
// its permissions. electron-builder still lays out every file's entitlements; only the identity changes.
const localIdentity = env.OMNI_MAC_IDENTITY || null;
const localSigning = localIdentity
  ? {
      identity: '-',
      sign: async (opts) => {
        const { signApp } = require('@electron/osx-sign');
        await signApp({ ...opts, identity: localIdentity });
      },
    }
  : {};

const repo = githubRepo();

/** @type {import('electron-builder').Configuration} */
module.exports = {
  appId: 'com.omni-os.desktop',
  productName: 'Omni',
  artifactName: 'Omni-${version}-${os}-${arch}.${ext}',
  directories: { output: 'release', buildResources: 'resources' },
  files: ['dist/**', 'package.json', 'resources/icon.png'],
  // The server, its MCP scripts, the Web UI and their node_modules: every file, outside the asar, so the
  // server runs them from disk on Electron's Node. electron-builder never copies a source's top node_modules,
  // so that one is a source of its own.
  extraResources: [
    { from: 'build/omni', to: 'omni', filter: ['**/*'] },
    { from: 'build/omni/node_modules', to: 'omni/node_modules', filter: ['**/*'] },
  ],
  asar: true,
  // dist/ is bundled and app.asar holds no native code. build/omni carries node-pty already built.
  npmRebuild: false,
  nodeGypRebuild: false,
  mac: {
    target: ['dmg', 'zip'],
    category: 'public.app-category.developer-tools',
    icon: 'resources/icon.icns',
    hardenedRuntime: true,
    entitlements: 'resources/entitlements.mac.plist',
    entitlementsInherit: 'resources/entitlements.mac.plist',
    minimumSystemVersion: '13.0',
    notarize,
    // A universal build stages both arches' prebuilds into both apps, so each one is the same file on both sides.
    // The merge keeps them as they are, and node-pty picks prebuilds/darwin-<arch> at run time.
    x64ArchFiles: 'Contents/Resources/omni/node_modules/**',
    ...localSigning,
  },
  dmg: {
    contents: [
      { x: 140, y: 190, type: 'file' },
      { x: 400, y: 190, type: 'link', path: '/Applications' },
    ],
  },
  linux: {
    target: ['AppImage'],
    category: 'Development',
    executableName: 'omni-os',
    icon: 'resources/icon.png',
    synopsis: 'Local agent workspace',
    desktop: { entry: { StartupWMClass: 'omni-os' } },
  },
  // The static AppImage runtime, so a host with only FUSE 3 runs it without libfuse2.
  toolsets: { appimage: '1.0.3' },
  // Writes app-update.yml into the app, which is what turns its updater on (src/updates.ts). dist.ts never publishes.
  // OMNI_UPDATE_URL points a build at a plain HTTP folder instead, to try an update end to end against a local one.
  publish: env.OMNI_UPDATE_URL
    ? [{ provider: 'generic', url: env.OMNI_UPDATE_URL }]
    : repo
      ? [{ provider: 'github', owner: repo.owner, repo: repo.repo }]
      : null,
};
