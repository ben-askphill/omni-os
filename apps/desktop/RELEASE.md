# Release the desktop app

A release is one GitHub Actions run: `.github/workflows/desktop-release.yml`. It sets the new version, builds the Mac app signed with your Developer ID and notarized by Apple, builds the Linux AppImage, and publishes them as a GitHub release. Every installed copy checks the latest published release at launch and every 4 hours, downloads it in the background and installs it on quit (see [Updates](README.md#updates)).

## One-time setup

You do these once, on the Mac that has your Apple account. An agent cannot do them.

1. **Create a Developer ID Application certificate.** Only the team's Account Holder can create one, and only on the paid team, not Xcode's free Personal Team (both can carry your name). The developer website is the most reliable way:
   1. In Keychain Access, choose Keychain Access, Certificate Assistant, **Request a Certificate From a Certificate Authority**. Enter your email, choose **Saved to disk**, and save the `.certSigningRequest`. This also creates the private key in your login keychain.
   2. At [developer.apple.com/account/resources/certificates/add](https://developer.apple.com/account/resources/certificates/add), choose **Developer ID Application**, the **G2 Sub-CA** profile, and upload the request. A greyed-out Developer ID option means this Apple ID is not the Account Holder of this team, or the team has an agreement to accept under Account, Agreements.
   3. Download the `.cer` and double-click it. Keychain Access lists it under My Certificates as `Developer ID Application: <name> (<TEAM ID>)`, with the private key under it.
2. **Export it with its private key.** In Keychain Access, under My Certificates, right-click that certificate (not the key under it) and choose Export. Save it as a `.p12` and give it a password.
3. **Create a notarization key.** In App Store Connect, open Users and Access, Integrations, App Store Connect API, Team Keys. Add a key with the **Developer** role. Download the `.p8` file (Apple offers it once), and note its Key ID and the Issuer ID at the top of the page.
4. **Save them as repository secrets.** From a checkout, signed in to `gh` as a repo admin:

   ```sh
   scripts/desktop-release-secrets.sh --p12 ~/Desktop/DeveloperID.p12 \
     --api-key ~/Downloads/AuthKey_ABC123XYZ.p8 --key-id ABC123XYZ --issuer 00000000-0000-0000-0000-000000000000
   ```

   It asks for the `.p12` password, checks that it opens the file, and saves the secrets the workflow reads: `MAC_CERTIFICATE_P12`, `MAC_CERTIFICATE_PASSWORD`, `APPLE_API_KEY_P8`, `APPLE_API_KEY_ID` and `APPLE_API_ISSUER`. To notarize with your Apple ID instead of a key, pass `--apple-id you@example.com --team-id <TEAM ID>`. It asks for an app-specific password from appleid.apple.com and saves `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID`.
5. **Delete the exported files.** The `.p12` and `.p8` now live in the repository's secrets and your keychain. Keep the `.p8` somewhere safe if you want to reuse it.

Linux needs no secrets.

## Release

```sh
gh workflow run desktop-release.yml -f bump=patch     # or minor, major, or an exact version: -f bump=0.2.0
gh run watch "$(gh run list -w desktop-release.yml -L 1 --json databaseId --jq '.[0].databaseId')"
```

Or open the Actions tab, choose **Desktop release** and **Run workflow**. A run takes about 20 minutes, most of it Apple's notarization.

| Job | Does |
| --- | --- |
| Version and draft release | Sets `apps/desktop/package.json` to the new version (`scripts/version.ts`), commits it to `main`, tags `v<version>` and drafts the release with notes generated from the merged PRs |
| Mac | Builds the universal app on a macOS runner, signs it with the Developer ID, notarizes and staples it, uploads the DMG, the zip and `latest-mac.yml`, then checks the signature, Gatekeeper's verdict and the staple |
| Linux | Builds the x64 AppImage, with node-pty compiled for glibc 2.28 in docker, and uploads it with `latest-linux.yml` |
| Publish | Checks that both feeds and all three downloads are attached, that every file a feed names is there and that the Mac feed points at the zip, then publishes the release as the latest |

Installed apps see a release only once it is published, so a failed run never offers a half-built update. When a build job fails for a cause outside the code, such as a secret or the runner, fix it and choose **Re-run failed jobs** on the same run: the version, tag and draft stay, and the uploads replace what the failed attempt left. The build jobs check out the tag, so a fix merged to `main` never reaches a re-run. For a cause in the code, and to abandon a release, delete the draft and its tag (`gh release delete v<version> --cleanup-tag`) and run the workflow again with the next version.

Any agent with `gh` can start a release the same way. Starting one is a deploy to every installed copy, so an agent asks first.

## Versions

`apps/desktop/package.json` holds the app's version, and only the release workflow changes it. Each release tag is `v<version>`. electron-updater installs only a higher version than the running one, so a release never goes back. To pull a bad release, publish a fixed higher version. Turning the bad release back into a draft stops new downloads but not the copies that already downloaded it.

A build from `scripts/build-desktop.sh` (what omni-reload runs) is an unpacked `--dir` build, and electron-builder writes no update feed into one. It does not update itself: Settings > Desktop app > Updates says it updates by rebuilding. To follow releases instead, install the DMG from a release. Squirrel.Mac installs an update only over an app signed like it (the same Developer ID team), so a release could not update a copy signed ad hoc or with an Apple Development identity anyway.

## Updates and the update feed

Installed apps read the latest published release's `latest-mac.yml` (or `latest-linux.yml`) and download the file it names. On a Mac that is the zip: Squirrel.Mac installs from it, checks that the new app is signed by the same team as the running one, and swaps the bundle. The Publish job refuses a release whose feeds name a file it does not have, or whose Mac feed does not point at the zip. The repo is public, so the app reads releases without a token; a private repo would need one built into every copy, which anyone with the app could read.

The release body is GitHub's generated notes. The app shows the first 8 items of the coming release as plain text in Settings > Desktop app > Updates, with a link to the release, so a PR title is what a user reads there.

## First update test

What CI and the tests cannot show: a signed, notarized release replacing an older signed, notarized release on a real Mac. Run this once on the Mac, after this change is merged. It uses its own folder, port and data, so your Omni keeps running.

**Test A: 0.1.1 updates to the next release.** 0.1.1 has the updater without the Updates card, so this proves the feed, the signature chain and the install.

1. Download the 0.1.1 DMG: `gh release download v0.1.1 -R ben-askphill/omni-os -p 'Omni-0.1.1-mac-universal.dmg' -D ~/Downloads`
2. Open it and, in Finder, drag Omni into a new folder `~/OmniUpdateTest`. Dragging in Finder matters: a copy made with `cp` or `ditto` keeps the quarantine flag, runs translocated and cannot update.
3. Open it on its own port, data and settings:
   `open -n ~/OmniUpdateTest/Omni.app --args --user-data-dir="$HOME/OmniUpdateTest/user-data" --port 4799 --data-dir "$HOME/OmniUpdateTest/data"`
   Skip setup. Settings > Desktop app > This app shows Version 0.1.1 and Updates "Up to date".
4. Release the next version: `gh workflow run desktop-release.yml -f bump=patch`, and wait until the run is green and the release is Latest.
5. In the test app, press Check for Updates. Expect "Downloading Omni 0.1.2", then "Omni 0.1.2 is ready" in Settings and the sidebar.
6. Press Relaunch to Update. The app quits and stops its server on 4799. Squirrel.Mac relaunches it without the arguments from step 3, so with your Omni open it hands over to that one and closes. That is expected here.
7. Check the install: `defaults read ~/OmniUpdateTest/Omni.app/Contents/Info.plist CFBundleShortVersionString` says 0.1.2, and `tail ~/Library/Caches/com.omni-os.desktop.ShipIt/ShipIt_stderr.log` ends with "Installation completed successfully". Open it again with the command from step 3: Settings shows Omni 0.1.2 and the Updates card.

**Test B: 0.1.2 updates to the one after.** This proves the Updates card against a real release.

1. In the test app (0.1.2), turn off Check automatically in Settings > Desktop app > Updates.
2. Release again (`-f bump=patch`). Merge at least one PR first, so the notes have a line.
3. Press Check for Updates. Expect "Omni 0.1.3 is available" with a Download button, and "What is new in 0.1.3" listing the merged PRs, with "All release notes" opening the release in the browser.
4. Press Download: ticks fill, then Relaunch to Update. Repeat steps 6 and 7 of Test A for 0.1.3.
5. Clean up: quit the test app, then move `~/OmniUpdateTest` and `~/Library/Caches/@omnidesktop-updater` to the Trash.

If a step fails, the updater's message shows in the Updates card (hover it in the sidebar). Squirrel.Mac's own log is `~/Library/Caches/com.omni-os.desktop.ShipIt/ShipIt_stderr.log`. To see the app's `[omni] update:` lines, start it from Terminal instead of `open`: `~/OmniUpdateTest/Omni.app/Contents/MacOS/Omni` with the same arguments.
