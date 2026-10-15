# Native build validation

## Android-first integration

The 2026-10-15 frozen UI integration was rebuilt with the existing root
`bun run mobile:herdr:android` command on `xixilys-macmini`. The command rebuilt
`dist-herdr`, copied it, synchronized Capacitor and compiled the Android debug
APK using Java 21.0.9, SDK 36 and Gradle 8.14.3. Vite completed in 21.13 seconds;
Gradle reported `BUILD SUCCESSFUL` with 213 tasks, 27 executed and 186 up-to-date.
The log is `.tmp/android-ui-build-final.log`.

The APK is `android/app/build/outputs/apk/debug/app-debug.apk`, 16,431,850 bytes.
Its bundled `assets/public/index.html` equals the rebuilt `dist-herdr/herdr.html`,
and it contains the current `herdr-Docmua9V.js` bundle. This build includes the
restored shared chat/composer presentation, session popup and keyboard geometry
integration together with the existing host, conversation, preferences and
project-context modules. The package remains `dev.openherdr.mobile`,
versionCode 2 / versionName 0.1.0, minimum SDK 24 and target SDK 36.

The task-owned `OpenHerdr_API36` AVD was restarted from `.tmp/android-avd`
after the earlier emulator process had exited. The detached emulator uses port
5580, 2GB RAM and 2 cores. No user AVD or physical device was used. Boot completed,
`adb install -r` returned `Success`, and `am start -W` reported `Status: ok` with
`dev.openherdr.mobile/.MainActivity` resumed. The application process was PID 2282;
the detached emulator was PID 21369 at validation time. Install and launch logs
are `.tmp/android-ui-install-final.log` and `.tmp/android-ui-launch-final.log`.

The final read-only capture `.tmp/android-ui-connect-final.png` shows the actual
connection form with blank server and pairing fields and the native-vault notice.
Dark status and navigation backdrops have visible white system icons. An earlier
capture during startup showed a blank loading frame and was replaced after the
form rendered. The Android 15+ app-local StatusBar adapter registers after the
generated plugins. Light theme, rotation, resume and keyboard interaction still
require native checks. No native connected chat screen was exercised, so this
capture does not establish the restored chat/composer fidelity on Android.

Capacitor bridge logging is disabled, including debug packages, because its
default verbose calls include secure-storage method data.

Computer Use cannot select this emulator's standalone Qt process. A separate
attempt through the official Android Studio device view did not expose it.
Only task-created IDE processes were stopped; the AVD and user instances were
preserved. Pairing, native storage write/relaunch, Back, keyboard, rotation,
share and offline recovery have not passed this route. No physical phone was
connected. The local/public HTTPS checks in STATUS.md prove their HTTP paths,
not Android interaction.

The human's supplied OpenChamber screenshot is a private local visual reference.
The current shared chat/composer integration is packaged in this APK. Its
connected native display and interactions remain unverified. iOS below records
the older terminal baseline.

## Previously validated terminal baseline

The final OpenHerdr web payload was copied and both native apps rebuilt on the
Mac on 2026-10-14. These checks cover build artifacts and an iOS connection screen.

## Built artifacts

- iOS Simulator app at `build/ios-simulator/Build/Products/Debug-iphonesimulator/App.app`. Xcode 27.0, iOS Simulator SDK 27.0, Capacitor 8.4.1, arm64 and x86_64. `CODE_SIGNING_ALLOWED=NO`. Build output ends with `BUILD SUCCEEDED` in `ios-build-final.log`.
- Android debug APK at `android/app/build/outputs/apk/debug/app-debug.apk`. Java 21 from the existing Android Studio installation, SDK 36, Gradle 8.14.3. Build output ends with `BUILD SUCCESSFUL`, 123 actionable tasks, 24 executed and 99 up-to-date, in `android-build-final.log`.
- Both package identifiers are `dev.openherdr.mobile`. Android `aapt dump badging` confirms the application label `OpenHerdr`, minimum SDK 24 and target SDK 36.
- Copied native `index.html` files match the source `packages/web/dist-herdr/herdr.html`.

The iOS template initially crashed on launch because it lacked the UIScene lifecycle required by the installed SDK/runtime. `AppDelegate.swift` and `Info.plist` now use the scene lifecycle. The original crash report is retained at `build/ios-scene-crash.ips`.

SwiftPM initially waited inside its Keychain authorization provider. The iOS script now selects the documented `netrc` provider. The initial stopped attempt remains in `ios-build-keychain-blocked.log` and `ios-build-sample.log`.

## Simulator runtime

The default simulator device directory points to an external volume where CoreSimulator fails with `NSCocoaErrorDomain 513` and `EPERM`. No existing simulator settings or permissions were changed.

An owned internal device set was created at `/tmp/openherdr-simulators-01a13b8d`. Its iPhone 17 Pro device is `A2FAE2CB-E6FE-4EC7-8DA7-F57DF5C4617D`, running iOS 27.0. The app was installed from an internal temporary copy and launched successfully after the scene fix. The process remained running, and an actual screenshot showed the OpenHerdr connection form.

The final app was reinstalled from the final build and launched as
`dev.openherdr.mobile`, PID 4092. The actual final screenshot is copied to
`docs/openherdr/assets/ios-connect.png`. The header clears the status bar, the
server field starts empty and the native secure-vault message is visible.
CoreSimulator writes screenshots to the owned internal directory; direct writes
to the external repository path fail with `EPERM`.

## Remaining validation

Native pairing, remote input/output, background/reconnect behavior, interactive Android
flows and physical iPhone execution have not been checked.
The final native client uses the secure-storage plugin, awaits persistence and
refuses a browser-storage fallback. Empty-vault startup succeeded; a credential
write/relaunch roundtrip has not been exercised. The browser and server control
checks are recorded separately in `docs/openherdr/STATUS.md`. No push
notifications or camera scanner are included. Release signing and store upload
were not performed.

## Branding and UI access follow-up

Native launcher icons and launch images derive from `packages/web/public-herdr/openherdr.svg`, using the existing Sharp dependency. The generator is `generate-icons.mjs`. Verified the iOS icon is opaque 1024x1024, all 10 Android legacy/round icon sizes match their densities, and all 5 adaptive foreground images are 108dp at the corresponding density. Both final builds include these assets.

Computer Use opened Xcode 27's DeviceHub application and inspected its actual window and File/View menus. The Devices window reports `No Devices`; it does not expose the running custom simulator set. No native taps, pairing or control were performed through DeviceHub. The installed `serve-sim` helper resolves its default device set, so it also does not expose this isolated set through its normal interface. No global device-set configuration or tooling was changed to work around this limitation.
