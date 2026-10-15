# OpenHerdr native app

This separate Capacitor app bundles the OpenHerdr web client. Its application ID is `dev.openherdr.mobile`, so it can coexist with OpenChamber. It connects to an existing OpenHerdr server through the connection screen. The app contains no Herdr daemon, SSH private keys, or model provider credentials.

The Android build rebuilds the current web source before copying and compiling it.
The standalone preparation and iOS commands use the existing web build:

```sh
bun run build:herdr
node packages/mobile/scripts/prepare-herdr.mjs
node packages/mobile/scripts/build-herdr-ios.mjs
node packages/mobile/scripts/build-herdr-android.mjs
```

Dependencies resolve from the existing `packages/mobile/node_modules`. Do not run a separate package install in this directory. Native projects are generated on the first build and updated by Capacitor sync.

The bundled client uses the registered secure-storage plugin for native connection credentials. On iOS, it selects device-only Keychain storage accessible while unlocked and disables iCloud synchronization. On Android, the plugin encrypts values with an Android KeyStore key and stores the encrypted values in app-specific SharedPreferences. The Android app disables backup. Browser/PWA connections use browser localStorage. Native storage failures produce a connection error and do not fall back to browser credential storage. Saving must succeed before the UI enters the connected state.

Pending mutation metadata uses a separate native-vault key for each server.
The request record is saved before dispatch and survives application restart.
Unknown results remain blocked until their receipt or affected state is checked.
These describe the implemented storage path. Successful native pairing,
credential write and restored authenticated session still need runtime checks.
See `VALIDATION.md` for actual checks and their limits.

The dedicated Android activity registers the shared file-share and image-paste
plugins and custom WebView. Download uses the Android share sheet; opening that
sheet does not prove that another application saved the file. IME image paste
is enabled only while the writable attachment composer owns focus. The native
App, Keyboard and StatusBar plugins support lifecycle, Back and inset handling.
The precise `openherdr://connect` VIEW route fills the pairing form and requires
Connect; opening it sends no prompt.

Run `node packages/mobile/openherdr/generate-icons.mjs` from the repository root to regenerate native launcher icons and launch images from `packages/web/public-herdr/openherdr.svg`. The generator uses the existing Sharp dependency. iOS gets an opaque 1024px icon; Android gets density-specific launcher images and adaptive foregrounds.

The iOS command builds an unsigned Simulator `.app` at `build/ios-simulator/Build/Products/Debug-iphonesimulator/App.app`. It requires Xcode and an iOS Simulator runtime. It does not install or launch the app. Device signing, provisioning, distribution and App Store upload are separate steps.

SwiftPM uses its `netrc` authorization provider for public build dependencies, which avoids an interactive Keychain query during headless builds. The command does not change Keychain settings.

The Android command requires a configured `ANDROID_HOME` or `ANDROID_SDK_ROOT`, a working Java installation compatible with Capacitor 8, and installed SDK platforms/build-tools. It rebuilds the web assets, synchronizes Capacitor and generates a debug APK at `android/app/build/outputs/apk/debug/app-debug.apk`. It does not install or launch an emulator.

Use an HTTPS server URL, including a registered Cloudflare tunnel URL. The server must explicitly permit the packaged origins `capacitor://localhost` on iOS and `https://localhost` on Android. Pairing, bearer authorization and administrator network policy are enforced by the OpenHerdr server. The shell does not open a local listener or create a tunnel. Push notifications and QR camera scanning are not included.

Capacitor bridge logging is disabled in the packaged app, including debug builds,
so secure-storage values and pairing URL callbacks are not written to bridge logs.
