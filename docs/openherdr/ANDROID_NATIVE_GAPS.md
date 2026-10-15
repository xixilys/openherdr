# Android native integration and remaining checks

Android is the primary OpenHerdr application. This document describes current
source integration and the device checks still needed. The initial-shell gap
review is superseded: the app now includes lifecycle, Back, pairing links,
scanner, file-share and image-paste bridges. See [STATUS.md](STATUS.md) and
[the native validation record](../../packages/mobile/openherdr/VALIDATION.md)
for the builds and runtime checks actually completed.

## Current integration

| Capability | Source owner and behavior | Remaining acceptance |
| --- | --- | --- |
| QR pairing | `openherdr/capacitor.config.json` and the generated Android registry include MLKit. The manifest declares camera permission and optional camera hardware. Shared `apps/mobileQrScan.ts` requests permission and uses QR-only `startScan`, `barcodesScanned`, `scanError` and `stopScan`. `ConnectionWelcome.tsx` previews the resolved server and requires Connect. | Physical camera permission, CameraX preview, scan result, cancellation and successful pairing. The installed plugin API matches the adapter; this does not prove the camera works on a device. |
| Scanner overlay | `MobileQrScannerOverlay.tsx` makes the WebView transparent and hides other page content while CameraX renders behind it. Back, backgrounding and cancellation stop the scan and restore page styles. | Real WebView/CameraX composition, denied permission, Back and background/foreground transitions. |
| Deep links | The manifest declares only `openherdr://connect`. `herdr-native.ts` handles warm URLs and the launch URL; `transport.ts` validates the route and payload. A warm event supersedes a delayed cold-launch URL. Intake requires explicit confirmation and sends no terminal input. | OS delivery on a cold and warm app, form preview, malformed links and unchanged credential ownership after cancellation. |
| Back and lifecycle | `HerdrApp.tsx` supplies the layer/connection/panel handler. `herdr-native.ts` reuses native Back, chrome and lifecycle hooks, pauses reads on app inactivity and resumes against the selected owner. | Actual Android Back order, minimizing, suspend/resume and foreground network recovery. |
| Keyboard and bars | The manifest uses `adjustResize`. App, Keyboard and StatusBar are included; `MainActivity.java` installs `HerdrStatusBarPlugin` after generated registration. SystemBars handles CSS insets. Shared native chrome retains Android resize behavior. | Phone/tablet portrait and landscape, real IME, safe areas, status/navigation bars and target-SDK edge-to-edge behavior. |
| Enter | Both Terminal controls and the structured composer use the original `shouldSubmitEnter` policy. On mobile, Enter inserts a newline and Ctrl/Meta+Enter sends; composition guards remain. Monitor has no input composer and its observation textarea is read-only. | CJK IME composition, hardware-keyboard shortcuts and actual native keyboard geometry. |
| File sharing | `MainActivity` registers `FileSharePlugin`. Herdr Files and conversation attachments use `nativeFileShare.ts`; the plugin writes only the `shared-files/` cache and grants one FileProvider URI to the selected recipient. | Android chooser, cancellation and actual receipt of the complete bytes by another application. Opening a share sheet alone is insufficient. |
| IME image paste | `ImagePastePlugin` and `OpenHerdrWebView` are installed through `MainActivity` and its layout. `ConversationPanel` consumes the shared paste event only while a writable attachment composer owns focus. | An actual supported IME image, bounded decoding, attachment preparation and real agent receipt through its supported conversation driver. Ordinary terminal-only agents do not gain image ingestion from this bridge. |
| Device credentials | `herdr-credentials.ts` uses the installed native secure-storage plugin. Android encrypts stored values with a KeyStore key; backup is disabled. Saving must finish before connection activation and storage failure has no browser-token fallback. | Physical pairing, KeyStore write/read, force-stop/relaunch, revocation and explicit re-pairing. Browser storage fixtures do not prove KeyStore behavior. |
| Pending mutations | `transport.ts` stores each server's pending metadata through a separate native-vault key, or browser localStorage. It reads the former sessionStorage record only for migration and persists it before clearing that legacy copy. Unknown delivery remains blocked and is never automatically resent. | Android process death while a request is unresolved, followed by restored metadata and the actual receipt check. |

The packaged scanner uses the installed MLKit 8.1.0 API with Capacitor 8.4.1.
Source inspection found no method/event mismatch. In the first device scan,
the unresolved factor is actual camera/WebView presentation and permission
handling. Keep the preserved first test APK available while investigating any
reported device result.

## Features still missing or outside current Android acceptance

Push notifications have no OpenHerdr registration/delivery path. The original
OpenChamber Firebase IDs, push keys and subscription infrastructure are separate.
Voice and the other original feature families remain tracked in
[ANDROID_PARITY_PLAN.md](ANDROID_PARITY_PLAN.md). iOS scanning is unavailable in
the current OpenHerdr SwiftPM project; its URL scheme is declared but has not
received new iOS runtime acceptance.

OpenHerdr keeps HTTPS for its packaged connection path. Its native shell does
not open a server, create a tunnel, import SSH keys or change model-provider
configuration. Existing browser/server authorization and enterprise network
policy continue to enforce access. A successful build does not settle any
physical-device check listed above.
