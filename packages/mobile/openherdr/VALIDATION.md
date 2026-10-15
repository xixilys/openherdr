# Native build validation

## Latest expanded-composer artifact

The current debug APK is 15,738,094 bytes and packages `herdr-CF2mEnjj.js`.
Its `assets/public/index.html` exactly matches the current web build, and the
referenced bundle is present. `.tmp/expanded-composer-apk.json` records the check.
Package identity and native source are unchanged. This APK has not been installed
or interactively tested on Android.

`bun run mobile:herdr:android` rebuilt the web client and synchronized Capacitor,
then stopped making progress inside Gradle's native filesystem enumeration.
The owned client was canceled. A retry with filesystem watching disabled hit
the old daemon's shared journal-cache lock. Both failed attempts are retained in
`.tmp/android-expanded-composer.log` and
`.tmp/android-expanded-composer-gradle-retry.log`.

The final Gradle invocation used the installed Gradle 8.14.3 distribution, a
per-invocation Gradle home/project cache, and a separate read-only copy of the
existing dependency cache. It used `--no-daemon --no-watch-fs`; the offline
attempt lacked repository metadata, so normal resolution of the already-declared
dependencies was enabled for the successful build. No dependency declaration,
shared cache, global Gradle configuration or mounted filesystem was changed.
`.tmp/android-expanded-composer-isolated-online.log` records `BUILD SUCCESSFUL`
in 2m 49s and 213 tasks executed. The old task daemon remained in an exiting
state with its journal lock; recovery of that shared environment is unconfirmed.

The actual HTTPS browser at 412x915 passed tap-to-expand and focus, multiline
Unicode input, Enter newline, model-picker focus return, collapse/reopen,
workspace-return draft retention and a non-bottom reader position of 80 pixels.
One bounded real request returned `OPENHERDR_EXPANDED_INPUT_OK`, with one prompt,
one reply and the sent draft cleared. Arabic RTL positioning also passed before
the language and viewport were restored. `.tmp/expanded-composer-browser.json`
records these checks. Public screenshots are
`docs/openherdr/assets/composer-expanded.jpg` and `composer-response.jpg`.

These browser results do not test Android IME, system Back, native paste,
file chooser/sharing, rotation or connection recovery. Fullscreen editing and
autocomplete remain unfinished. Older native Connect/cold-start observations
below continue to belong to `herdr-BEKetIzv.js`.

## Previous file-navigation artifact

The 2026-10-15 file-navigation increment was built with
`bun run mobile:herdr:android` on `xixilys-macmini`, using the existing Android
SDK and Java 21 installation. The final log is
`.tmp/android-file-navigation-release.log`. Gradle reported `BUILD SUCCESSFUL`
in 2 seconds with 213 tasks, 27 executed and 186 up-to-date.

That file-navigation `android/app/build/outputs/apk/debug/app-debug.apk` was
16,467,798 bytes and contained `assets/herdr-BDGqP9Kp.js`. At that validation,
its `assets/public/index.html` exactly matched the then-built
`dist-herdr/herdr.html`. The package remains
`dev.openherdr.mobile`, versionCode 2 / versionName 0.1.0, minimum SDK 24 and
target SDK 36. This APK includes the shared `MobileFilesView`, current-file tool
navigation and the existing manual host editor.

That APK was not installed or tested interactively on Android. The
Connect screen and cold-start observations below belong to the older
`herdr-BEKetIzv.js` build. No new native startup, connected chat, Back, keyboard,
file sharing or physical-phone acceptance was claimed for that artifact.

The actual HTTPS browser at 412×915 loaded `herdr-BDGqP9Kp.js` and completed a
real tool current-file action, close/reopen with file draft retained, directory
Back and search, manual edit/Save with exact disk readback, and Changes showing
the saved untracked file as a 2-line addition. Returning to the original chat
preserved its title, unsent composer draft and reader `scrollTop` of 533.5. The
owned composer marker was then cleared. Receipts are
`.tmp/file-navigation-browser-validation.json` and `.tmp/file-flow-browser-state.json`.
Public captures are `docs/openherdr/assets/file-browser.jpg`, `file-editor.jpg`
and `file-changes.jpg`. These browser checks do not establish native Android
interaction.

A separate real saved-WSL check ran on `PC-20260204VNLG`. Its owned workspace,
created with `focus:false`, wrote `-remote diff.txt` under a marked `/tmp`
directory. Status confirmed untracked content; the unstaged diff contained the
new-file patch and unique marker, the staged diff remained empty, and file
content/revision readback matched. Cleanup closed only that workspace and removed
its marked temporary directory. `.tmp/untracked-ssh-acceptance.json` records this
ordinary 0644 file case; final executable-mode behavior has separate local tests.
No existing agents, providers or shared services were changed by that fixture.

Complete editor/Git parity and connected native interaction remain unfinished.
The previous browser download completion is still unknown, and the older native
startup sample below does not characterize startup of the current APK.

## Previous shared-chat Android integration

The preceding 2026-10-15 shared-chat UI integration was rebuilt with the existing root
`bun run mobile:herdr:android` command on `xixilys-macmini`. The command rebuilt
`dist-herdr`, copied it, synchronized Capacitor and compiled the Android debug
APK using Java 21.0.9, SDK 36 and Gradle 8.14.3. Vite completed in 12.68 seconds;
Gradle completed in 3 seconds and reported `BUILD SUCCESSFUL` with 213 tasks, 27 executed and 186 up-to-date.
The log is `.tmp/android-ui-presentation-build.log`.

That previous APK was `android/app/build/outputs/apk/debug/app-debug.apk`,
16,462,669 bytes. The path now holds the newer artifact documented above.
At that validation, its bundled `assets/public/index.html` matched the then-built
`dist-herdr/herdr.html` and contained `herdr-BEKetIzv.js`. That build included the
restored shared chat/composer presentation, session popup, keyboard geometry,
tool/attachment adapters and step-by-step forms together with the existing host, conversation, preferences and
project-context modules. The package remains `dev.openherdr.mobile`,
versionCode 2 / versionName 0.1.0, minimum SDK 24 and target SDK 36.

The task-owned `OpenHerdr_API36` AVD was restarted from `.tmp/android-avd`
after the earlier emulator process had exited. The detached emulator uses port
5580, 2GB RAM and 2 cores. No user AVD or physical device was used. Boot completed,
`adb install -r` returned `Success`. The first `am start -W` returned
`Status: timeout` after 16,614 ms. Read-only follow-up confirmed
`dev.openherdr.mobile/.MainActivity` resumed and the connection form rendered.
The application process was PID 3904;
the detached emulator was PID 21369 at validation time. Install and launch logs
are `.tmp/android-ui-presentation-install.log` and
`.tmp/android-ui-presentation-launch.log`.

The final read-only capture `.tmp/android-ui-presentation-connect.png` shows the actual
connection form with blank server and pairing fields and the native-vault notice.
Dark status and navigation backdrops have visible white system icons. An earlier
capture during startup showed a blank loading frame and was replaced after the
form rendered. The Android 15+ app-local StatusBar adapter registers after the
generated plugins. Light theme, rotation, resume and keyboard interaction still
require native checks. No native connected chat screen was exercised, so this
capture does not establish the restored chat/composer, tool, attachment or form
fidelity on Android. Earlier logs and screenshots remain available under their
original names. The filtered startup log is
`.tmp/android-ui-presentation-startup.log`; it includes WebView/graphics warnings
and no sampled `FATAL` entry. Startup performance has not been measured.

A single follow-up process cold start preserved app data and used `am force-stop`
only for `dev.openherdr.mobile` on `emulator-5580`, then `am start -W`. It returned
`Status: ok`, `LaunchState: COLD`, `TotalTime: 4812` and `WaitTime: 4942`.
The host measured 5.246 seconds for the launch command. The immediate read-only
capture completed 7.573 seconds after launch and still showed a blank loading
frame. One follow-up capture showed the complete Connect form with blank fields,
the vault notice and dark system bars. Its conservative visible-ready upper bound
is 29 seconds after launch, derived from the first capture's file timestamp,
the measured capture completion time and a 1-second rounding allowance.
The actual first rendered time between the captures is unknown. This single
emulator sample shows that successful Activity startup still precedes visible
web readiness. It does not establish the cause of the original installation-time
timeout, a performance regression or physical-phone startup behavior.
Logs, timing receipt and both screenshots use the
`.tmp/android-ui-presentation-cold-start` prefix. No repeated launch, rebuild,
app-data clearing or native interaction was performed for this check.

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
That previous APK packaged the shared chat/composer integration. Its connected
native display and interactions were not verified. iOS below records
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
