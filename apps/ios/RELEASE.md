# Release Omni OS for iPhone

This guide covers the setup you do once with Apple and Expo, the commands that build and submit a release, how to add TestFlight testers, and the text and privacy answers for App Store Connect. Run all EAS commands from `apps/ios`.

## One-time setup

Do these before the first build. Some steps need your Apple and Expo accounts, so the agent cannot do them.

1. **Enroll in the Apple Developer Program.** Note the Team ID under Membership details. It goes into `eas.json` in step 6.
2. **Register the App ID `app.omni-os.ios`.** In Certificates, Identifiers and Profiles, add an App ID with that bundle ID and turn on the **Push Notifications** capability. A build cannot sign the `aps-environment` entitlement without it.
3. **Create an APNs key.** Under Keys, add a key with **Apple Push Notifications service (APNs)** enabled. Download the `.p8` file once. Note the ten-character Key ID.
4. **Save the APNs values in Omni's secret store.** Save these three names:
   - `APNS_AUTH_KEY`: the `.p8` file's text.
   - `APNS_KEY_ID`: the Key ID from step 3.
   - `APNS_TEAM_ID`: the Team ID from step 1.

   The store is the Keychain on a Mac, `data/secrets.json` on Linux, or libsecret when `OMNI_SECRET_STORE` selects it. Restart the server afterward. The server logs the names of any missing values at startup, never the values. Keep the `.p8` file out of the repository.
5. **Create the App Store Connect app record.** In My Apps, choose New App, iOS, and bundle ID `app.omni-os.ios`. The store name must be unique on the App Store. If "Omni" is taken, pick another store name. The name under the icon still comes from `name` in `app.config.ts`, so the two can differ.
6. **Fill in the submit placeholders in `eas.json`.** Open App Information, then General Information, and copy the numeric Apple ID. Put it in `submit.production.ios.ascAppId`. Put the Team ID from step 1 in `appleTeamId`. Neither value is secret. Replace both `REPLACE_WITH_...` placeholders and commit the change.
7. **Prepare a privacy policy URL.** App Store Connect asks for one on the app record. Host a page that says the app stores and sends data only to the Omni server the user pairs with.
8. **Sign in to EAS.** Run `npx eas-cli login`. On the first build, EAS asks to create or link an Expo project. Accept. EAS should write `extra.eas.projectId` into `app.config.ts`, which is not yet verified for this config file. If it prints the snippet instead, paste it into the config yourself, and commit the change.
9. **Let EAS manage signing.** Run `npx eas-cli credentials -p ios`, select the `production` profile, and let EAS create the distribution certificate and provisioning profile. EAS does not need the APNs key. Omni's server signs alerts with it directly.

## Build and submit

From `apps/ios`:

```sh
npx eas-cli build --platform ios --profile production
npx eas-cli submit --platform ios --profile production --latest
```

The `production` profile bumps the build number on each build (`autoIncrement`). The marketing version is `version` in `app.config.ts`, which is `0.1.0`. Change it there when a release needs a new user-facing version.

On the first submit, EAS asks for your Apple sign-in or an App Store Connect API key.

Omni does not use EAS Update, so every change ships as a new build. The `channel` keys in `eas.json` are inert until an update library is added.

The other profiles are for testing outside TestFlight:

- `development` builds the development client for a device.
- `development-simulator` builds the development client for the Simulator.
- `preview` builds an internal distribution build for devices listed in the developer portal.

## Add internal testers

Internal testers are members of your App Store Connect team, up to 100 people. They need no Beta App Review.

1. Open the app in App Store Connect, then the TestFlight tab.
2. Under Internal Testing, create a group and add the team members.
3. After the build finishes processing, select it for the group.

Each tester gets an email and installs the TestFlight app from it.

External testers need Beta App Review. Add an external group, add testers by email, and submit the build for review.

## Check the Release archive without signing

Use this to prove the Release build compiles, links, bundles and generates the entitlement and privacy manifest. The archive is unsigned, so it cannot be installed or uploaded.

You need Node 24 or 26, and Xcode 27 with its iOS SDK. The Mac needs `/opt/homebrew/bin` on `PATH` and `LANG=en_US.UTF-8`. Replace `<mac>` with the host name and use a new directory each time.

```sh
git archive HEAD | ssh <mac> 'rm -rf ~/omni-ios-release && mkdir -p ~/omni-ios-release && tar -x -C ~/omni-ios-release'

ssh <mac> 'export PATH=/opt/homebrew/bin:$PATH LANG=en_US.UTF-8; cd ~/omni-ios-release && npm ci --include=dev && cd apps/ios && EAS_BUILD_PROFILE=production npx expo prebuild --platform ios --clean'

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
