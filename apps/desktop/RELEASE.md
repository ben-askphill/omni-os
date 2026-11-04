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
| Publish | Checks that both feeds and all three downloads are attached, then publishes the release as the latest |

Installed apps see a release only once it is published, so a failed run never offers a half-built update. When a build job fails, fix the cause and choose **Re-run failed jobs** on the same run: the version, tag and draft stay, and the uploads replace what the failed attempt left. To abandon a release instead, delete the draft and its tag (`gh release delete v<version> --cleanup-tag`) and run the workflow again with the next version.

Any agent with `gh` can start a release the same way. Starting one is a deploy to every installed copy, so an agent asks first.

## Versions

`apps/desktop/package.json` holds the app's version, and only the release workflow changes it. Each release tag is `v<version>`. electron-updater installs only a higher version than the running one, so a release never goes back. To pull a bad release, publish a fixed higher version. Turning the bad release back into a draft stops new downloads but not the copies that already downloaded it.

A Mac build from `scripts/build-desktop.sh` carries the version in the checkout and names the same release feed, so it updates to the next published release like a downloaded copy. Squirrel.Mac installs an update only over an app signed by the same team, so a local build signed with an Apple Development or ad hoc identity cannot take one. With the Developer ID certificate in your keychain, `build-desktop.sh` signs with it and updates work.
