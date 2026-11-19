// The Mac signing step electron-builder runs (electron-builder.config.cjs `mac.sign`): @electron/osx-sign, tried again
// as scripts/codesign-retry.cjs says, so a timestamp server that stops answering for minutes does not fail the build.
const { retrySigning, isTimestampError, TIMESTAMP_RETRY_WAITS, OTHER_RETRY_WAITS } = require('./codesign-retry.cjs');

/**
 * Signs the app with @electron/osx-sign, trying again as above. `identity` names the signing identity instead of
 * the one electron-builder found (scripts/build-desktop.sh's Apple Development one).
 */
async function signMac(opts, { identity, signApp, wait, log } = {}) {
  signApp ??= require('@electron/osx-sign').signApp;
  const signOptions = identity ? { ...opts, identity } : opts;
  return retrySigning(() => signApp(signOptions), { wait, log });
}

module.exports = { signMac, isTimestampError, TIMESTAMP_RETRY_WAITS, OTHER_RETRY_WAITS };
