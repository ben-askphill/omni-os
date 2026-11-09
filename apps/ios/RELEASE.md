# Release Omni OS for iPhone

This guide covers the setup you do once with Apple and Expo, the commands that build and submit a release, how to add TestFlight testers, and the text and privacy answers for App Store Connect. Run all EAS commands from `apps/ios`.

## One-time setup

The first build runs in your own terminal, because EAS asks for your Apple ID and a two-factor code. It registers the app with Apple, creates the signing files and the App Store Connect record, and sends the build to TestFlight. Later builds run without prompts.

1. **Make an Expo account** at expo.dev if you have none. The free plan builds iOS apps.
2. **Sign in to EAS and run the first build.** From `apps/ios`:

   ```sh
   npx eas-cli@latest login
   npx eas-cli@latest build --platform ios --profile production --auto-submit --no-wait
   ```

   Answer yes to each prompt:
   - Create the EAS project. EAS saves the project id in `app.json`, which `app.config.ts` merges in. Commit that change.
   - Log in to your Apple account: Apple ID, password, two-factor code, then the team.
   - EAS registers the bundle ID `app.omni-os.ios` and turns on Push Notifications for it, because the app's `aps-environment` entitlement asks for it. It then creates the distribution certificate and the provisioning profile.
   - For the submission, EAS creates the App Store Connect app, named by `appName` in `eas.json` ("Omni OS"; EAS adds a suffix if the name is taken), and an internal TestFlight group, "Team (Expo)", that gets every build and holds the team's admins. It offers to generate an App Store Connect API key and keeps it for later submissions.

   `--no-wait` returns once the build is queued. The build and the submission carry on at expo.dev, which links them.
3. **Save the App Store Connect app id.** In App Store Connect, open the app, then App Information, and copy the Apple ID (a number). Put it in `submit.production.ios.ascAppId` in `eas.json` and commit. A non-interactive submission needs it. It is not secret.
4. **Create an APNs key** for push alerts. In Certificates, Identifiers and Profiles, under Keys, add a key with **Apple Push Notifications service (APNs)** enabled. Choose an environment that includes Production, because TestFlight and App Store builds get production device tokens. If you limit the key to topics, include `app.omni-os.ios`. Download the `.p8` file once. Note the ten-character Key ID, and the Team ID under Membership details.
5. **Save the APNs values in Omni.** In Omni's Settings, open Secrets and save these three names as global secrets:
   - `APNS_AUTH_KEY`: the `.p8` file's text, from the BEGIN line to the END line. The field drops the line breaks. Omni puts them back.
   - `APNS_KEY_ID`: the Key ID from step 4.
   - `APNS_TEAM_ID`: the Team ID.

   Restart Omni. Then open Settings, Sharing & access, Omni for iOS and check that Push alerts shows On. If it shows Off, the line under it names what is missing or unreadable.

   Do this on every Omni server the phone pairs with. Each server signs its own alerts, so a server without these secrets sends none. Keep the `.p8` file out of the repository. EAS does not need this key.
6. **Prepare a privacy policy URL** before external testing or App Store review. Internal TestFlight testing does not ask for one. Host a page that says the app stores and sends data only to the Omni server the user pairs with.

## Build and submit

Once steps 2 and 3 are done, from `apps/ios`:

```sh
npx eas-cli@latest build --platform ios --profile production --auto-submit --non-interactive --no-wait
```

This needs an Expo session, from `eas login` on that machine or an `EXPO_TOKEN` in the environment (expo.dev, Account settings, Access tokens). It needs no Apple sign-in: EAS holds the signing files and the API key.

The `production` profile bumps the build number on each build (`autoIncrement`). The marketing version is `version` in `app.config.ts`, which is `0.1.0`. Change it there when a release needs a new user-facing version.

Every build profile pins Node 24.21.0, which bundles npm 11.19.0. The Xcode 27 image ships Node 22 and npm 10.9.9 by default, and the root `devEngines` refuses that npm with `EBADDEVENGINES` before anything installs.

The other profiles are for testing outside TestFlight:

- `development` builds the development client for a device.
- `development-simulator` builds the development client for the Simulator.
- `preview` builds an internal distribution build for devices listed in the developer portal.

## Release on merge

`.eas/workflows/ios-release.yml` runs on EAS when a push to `main` changes `apps/ios`, `packages/shared` or `packages/client-core`. Markdown files and `apps/ios/tests` do not start it. It works out the app's fingerprint, a hash of its native dependencies and its resolved app config, and then takes one of two paths:

- **No production build has this fingerprint.** The change touched native code: a native module, an Expo SDK bump or a config plugin option. The workflow builds with the `production` profile, which takes the next build number from EAS, and submits the build to App Store Connect. "Team (Expo)" has access to every build, so the build reaches its testers once Apple finishes processing it.
- **A production build has this fingerprint.** The change is JavaScript only. The workflow publishes an EAS Update to the `production` channel. Installed builds with the same fingerprint download it on launch and run it on the next launch, so a tester may need to quit and reopen the app twice.

Builds use the fingerprint as their runtime version (`runtimeVersion` in `app.config.ts`), so an update never reaches a build whose native code it was not made for. The fingerprint depends on the resolved config, which depends on `APP_VARIANT`. Any job or command that resolves the config outside a build must set `APP_VARIANT=production`, as the workflow does, or its fingerprint will not match the build's.

Runs queue one at a time. Put `[eas skip]` in a commit message to skip the run for that push. Start a run by hand with `npx eas-cli@latest workflow:run .eas/workflows/ios-release.yml`. Builds before build 4 were made without `expo-updates` and never receive updates.

### Set up the workflow

1. In expo.dev, open the `omni-os-ios` project under the `omni-os` account, then Project settings, then GitHub. Connect `ben-askphill/omni-os` and set the base directory to `apps/ios`. The Expo GitHub app is already installed on `ben-askphill`; grant it access to `omni-os` if the repository is not listed.
2. Nothing else. The workflow runs on EAS with the credentials EAS already holds: the signing files and the App Store Connect API key from the first build. GitHub needs no Expo token.

### Publish an update by hand

From `apps/ios`:

```sh
APP_VARIANT=production npx eas-cli@latest update --channel production --platform ios --environment production --message "<what changed>"
```

## Add internal testers

Internal testers are members of your App Store Connect team, up to 100 people. They need no Beta App Review. The "Team (Expo)" group from the first submission already gets every build.

1. Invite the person under Users and Access in App Store Connect.
2. Open the app, then TestFlight, then Team (Expo), and add them.

Each tester gets an email, installs the TestFlight app on the iPhone, and installs Omni from there. A build shows in TestFlight once App Store Connect finishes processing it.

External testers need Beta App Review. Add an external group, add testers by email, and submit the build for review.

## Check the Release archive without signing

Use this to prove the Release build compiles, links, bundles and generates the entitlement and privacy manifest. The archive is unsigned, so it cannot be installed or uploaded.

You need Node 24 or 26, and Xcode 27 with its iOS SDK. The Mac needs `/opt/homebrew/bin` on `PATH` and `LANG=en_US.UTF-8`. Replace `<mac>` with the host name and use a new directory each time.

```sh
git archive HEAD | ssh <mac> 'rm -rf ~/omni-ios-release && mkdir -p ~/omni-ios-release && tar -x -C ~/omni-ios-release'

ssh <mac> 'export PATH=/opt/homebrew/bin:$PATH LANG=en_US.UTF-8; cd ~/omni-ios-release && npm ci --include=dev && cd apps/ios && APP_VARIANT=production npx expo prebuild --platform ios --clean'

ssh <mac> 'export PATH=/opt/homebrew/bin:$PATH LANG=en_US.UTF-8; cd ~/omni-ios-release/apps/ios/ios && xcodebuild -workspace Omni.xcworkspace -scheme Omni -configuration Release -destination generic/platform=iOS -archivePath ~/omni-ios-release/build/Omni.xcarchive CODE_SIGNING_ALLOWED=NO archive'
```

The archive succeeded when `xcodebuild` ends with `** ARCHIVE SUCCEEDED **`. Two more checks:

- `ios/Omni/Omni.entitlements` sets `aps-environment` to `production`.
- `ios/Omni/PrivacyInfo.xcprivacy` lists the three required-reason entries from `apps/ios/app.config.ts`.

The `prebuild` step runs `pod install`, so CocoaPods must be installed on the Mac.

## TestFlight text

### What to test

- Pair the app with your Omni server by scanning the code shown on your computer.
- Open a channel and a thread, and watch the agent's reply stream in.
- Send a message, attach a photo, and check that the agent gets it.
- Turn on notifications under Settings, then Notifications. Check that an alert arrives when a thread needs an answer. This needs the APNs values on the server.
- Tap an alert and check that it opens the thread.
- Check light mode and dark mode.

### Beta App Description

> Omni OS connects this iPhone to an Omni server you run and pair with. Open channels and threads, follow agent replies as they stream in, start new threads, send messages with photos and files, and get an alert when an agent needs your answer. The app sends your data only to the server you pair it with.

## App privacy answers

- **Data collection.** Answer "Data Not Collected". The app sends its data to the Omni server the user pairs with, and the developer never receives it. Apple's definition turns on whether the developer can access the data, so confirm this reading in App Store Connect before you submit.
- **Tracking.** Answer no. The app does not track users or use the advertising identifier. `NSPrivacyTracking` is `false` in `app.config.ts`.
- **Encryption.** The app uses only standard HTTPS and OS cryptography, so `ITSAppUsesNonExemptEncryption` is `false`. App Store Connect skips the export question.
- **Required-reason APIs.** `app.config.ts` declares the reasons for the APIs the app binary calls. ExpoFileSystem and the React Native bundles ship their own manifests.

## Known gaps

- **Cloud build from a workspace subdirectory.** The EAS cloud build has not run from `apps/ios` inside this npm workspace. If it fails while it installs dependencies, the cause is probably monorepo root detection. Send the build log before you change anything.
- **Bundled frameworks without manifests.** The unsigned archive contains no privacy manifest for `ExpoModulesJSI.framework` or `hermesvm.framework`. Both call required-reason APIs. If App Store Connect's upload validation names them, the fix is an Expo or React Native update, not a change in this app.
