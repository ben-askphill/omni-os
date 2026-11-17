// The Mac signing step electron-builder runs (electron-builder.config.cjs `mac.sign`). codesign --timestamp asks
// Apple's timestamp server for every file, and that server sometimes stops answering for minutes. codesign gives up
// on a silent server after 15 seconds ("A timestamp was expected but was not found"; "The timestamp service is not
// available" when it refuses or answers badly). electron-builder's own signing tries four times in about a minute,
// so 0.1.33's release failed twice on the first file it signs, playwright-core's codicon font (the deepest path).
// This keeps electron-builder's short retries for any signing error and waits much longer for the timestamp server.

/** Seconds before each new try after a timestamp error: about 18 minutes in all. */
const TIMESTAMP_RETRY_WAITS = [30, 60, 120, 240, 300, 300];
/** Seconds before each new try after any other error, as electron-builder's own sign waits. */
const OTHER_RETRY_WAITS = [5, 10, 15];

/** True for codesign's timestamp-server errors. Node's execFile error message carries codesign's stderr. */
function isTimestampError(error) {
  const message = String(error && error.message ? error.message : error);
  return /A timestamp was expected but was not found|The timestamp service is not available/.test(message);
}

/**
 * Signs the app with @electron/osx-sign, trying again as above. `identity` names the signing identity instead of
 * the one electron-builder found (scripts/build-desktop.sh's Apple Development one).
 */
async function signMac(opts, { identity, signApp, wait, log } = {}) {
  signApp ??= require('@electron/osx-sign').signApp;
  wait ??= (seconds) => new Promise((resolve) => setTimeout(resolve, seconds * 1000));
  log ??= (message) => console.warn(message);
  const signOptions = identity ? { ...opts, identity } : opts;
  let timestampTries = 0;
  let otherTries = 0;
  for (;;) {
    try {
      return await signApp(signOptions);
    } catch (error) {
      const timestamp = isTimestampError(error);
      const seconds = timestamp ? TIMESTAMP_RETRY_WAITS[timestampTries++] : OTHER_RETRY_WAITS[otherTries++];
      if (seconds === undefined) throw error;
      log(
        timestamp
          ? `  • the timestamp server did not answer; signing again in ${seconds}s`
          : `  • signing failed (${String(error && error.message ? error.message : error).split('\n').pop()}); signing again in ${seconds}s`,
      );
      await wait(seconds);
    }
  }
}

module.exports = { signMac, isTimestampError, TIMESTAMP_RETRY_WAITS, OTHER_RETRY_WAITS };
