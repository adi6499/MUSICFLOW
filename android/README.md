# Sukoon for Android

A small Android shell around the Sukoon web app. The web app is packed inside the
APK, so the app opens without downloading anything; only the music itself is
streamed.

What the shell adds that a browser tab cannot do:

- Music keeps playing with the screen off or while you use other apps.
- Play / pause / next / previous on the notification, the lock screen, and
  headset or Bluetooth buttons, with the cover and song name.
- The Back button closes whatever is open, then goes back a screen, and only then
  leaves the app (music keeps playing).
- "Back up" and "Restore" use Android's own file screens.
- YouTube Music playlist import works without the website.

## Build the APK

On this PC, double-click **`build.cmd`** in this folder (or run it from a terminal):

```bash
android\build.cmd
```

It builds the website, copies it into the app, builds the signed APK, and leaves
**`Sukoon-v1.2.1.apk`** in this folder. The first build takes a few minutes; later
ones are quicker. If something goes wrong, the full output is in `build.log`.

It expects the Android tools where they already are on this PC
(`C:\Users\Analyst Profile\Android\` — JDK 25 and the Android SDK). On another PC,
edit the two `set` lines at the top of `build.cmd`.

## Install it on a phone

Send the APK to the phone (WhatsApp to yourself, Google Drive, or a USB cable), tap
it, and allow "install unknown apps" when Android asks. The first time you play a
song, allow notifications — that is what shows the lock-screen controls.

## Releasing a new version

1. Raise `versionCode` (by 1) and `versionName` in `app/build.gradle.kts`, and the
   file name near the bottom of `build.cmd`.
2. Run `build.cmd`.

## The signing key — keep it safe

`signing/sukoon-release.jks` and `keystore.properties` are this app's signature.
They are deliberately **not** uploaded to GitHub. Android only installs an update
over the old version if it is signed with the same key, so:

- **Back up the `signing` folder and `keystore.properties`** somewhere safe.
- If they are ever lost, a new key works, but everyone has to uninstall the old app
  before installing the new one (their library can be carried over with
  Settings → Back up / Restore).

## How it is put together

```
app/src/main/
  AndroidManifest.xml          permissions, the one screen, the playback service
  java/com/adi6499/sukoon/
    MainActivity.kt            hosts the web app; Back, keyboard, file screens
    Bridge.kt                  what the web app may ask Android to do
    PlaybackService.kt         notification, lock screen, headset buttons, stay-awake
  assets/public/               the web app (copied in by build.cmd; not in git)
  res/                         icon, colours, names
```

The sound is played by the web app itself. `PlaybackService` never plays audio; it
mirrors what the web app reports and passes button presses back to it. The contract
between the two is small and lives in one place on each side:
`src/lib/native.ts` (web) and `Bridge.kt` (Android).

## Not yet tested on a phone

This shell was built and checked on a PC with no Android phone attached. The build
succeeding proves the code compiles and the APK is correctly signed, not that every
phone behaves. The first things to check on a real phone: music continuing with the
screen locked, the notification buttons, and Bluetooth/headset buttons.
