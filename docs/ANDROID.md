# Install the offline Android starter

Download [founders-morning-offline.apk](../dist/founders-morning-offline.apk) to your Android phone. Open the downloaded file and choose **Install**. If Android asks, allow installation from the browser or Files app you used for this download. You can turn that permission off again afterward. Requires **Android 8.0 or newer** and Android System WebView.

This is the **offline starter** requested before hosting is available. It includes five researched editions, one unused story on each Nairobi calendar day you open it, an archive, favourites, tappable sources and encouragement. Opening or retrying the same day preserves its assigned edition. It never recycles an included incident; after all five it explains that the reserve is exhausted. Its data stays in the app’s private Android storage and backup is disabled. Uninstalling or clearing app data removes its local history and saved readings.

Fresh automatic research and 08:00 notifications require the separate server. Follow [the HTTPS hosting guide](HOSTING.md). Once it is hosted, enter its HTTPS address in **My ritual → Connect the daily service**. This opens the full online PWA in your browser, where you sign in and enable notifications. The starter APK’s archive/favourites and the PWA’s device storage are separate; they do not automatically sync. No AI credentials, server password or signing private key are bundled in the APK.

The current APK is version **1.1.0-connected-starter** (version code 2). Its connection field defaults to **https://founders-morning.caspal26.workers.dev**. Open **My ritual → Open the online edition** to use the live private PWA. The same signing certificate is retained, so an update can preserve the starter’s local history.

## Verification performed

- Compiled against Android API 35, minimum API 26; launcher `app.talqen.foundersmorning.MainActivity`.
- Android `apksigner verify` passes v2 and v3 signature validation; `zipalign` validation passes.
- Package manifest, bundled assets and DEX bytecode inspected; only the Internet permission is declared, no native notification permission or background research service is claimed.
- Bundled UI exercised in Chromium at phone dimensions: saved/reopened reading, five distinct simulated days, unchanged same-day retries, exhausted-reserve state, encouragement and rejection of HTTP service URLs.
- Physical Android installation and native WebView execution have **not** been tested here. Signature/package checks and browser checks do not replace a device test.

The APK’s SHA-256 is recorded in [SHA256SUMS](../dist/SHA256SUMS). Its signing certificate SHA-256 is `dc033d3c9663c534f311c3eccc52954a434b7b4ffa9fffa57d5e1eeace01820b`.

## Rebuild and maintain updates

Source lives in `android/app/src/main/`. With the prepared Android SDK build tools 35.0.0, platform 35, Java runtime, Eclipse ECJ compiler, Python, zip and keytool, run:

```sh
bash scripts/build-apk.sh
```

The script accepts `ANDROID_SDK_ROOT`, `ANDROID_BUILD_TOOLS`, `ANDROID_JAR`, `ECJ_JAR`, `APK_SIGNING_KEYSTORE` and `APK_SIGNING_PASSWORD_FILE` path overrides. Defaults use the prepared `/workspace/android-tools` toolchain. Google’s official repository metadata supplied these verified SHA-1 archive checksums: platform-35_r02.zip `0bb560a90a7a2cbd0dd8348224d518b638fe7949`, build-tools_r35_linux.zip `2cfaa0bbb2336e9ec18ed3ecea84fa2e2af607bc`. ECJ 3.40.0 was fetched from Maven Central and verified against its published checksum. TLS and checksum verification remained enabled.

Keep `var/android-signing/` and its password file privately backed up. They are ignored by Git and excluded from the APK. The same signing key is required for future updates that retain installed app data. Do not commit or distribute it; increase the manifest’s `versionCode` for a release update. The build script generates a new key only if no keystore exists, so restore the original before rebuilding an update on another machine. The APK is privately self-signed, not published through Google Play.
