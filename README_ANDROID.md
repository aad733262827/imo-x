# Android (TWA) — Build an APK for IMMO X

This guide helps you wrap the PWA in this repo into an Android APK using a Trusted Web Activity (TWA) via Bubblewrap.

Prerequisites
- A live HTTPS site that serves `manifest.json` (e.g. `https://your-site.example/manifest.json`).
  - If you don't have a live site yet, publish to Render (the repo already contains `render.yaml` / Dockerfile) and use the Render URL.
- Node.js and npm
- Java JDK (11+ recommended)
- Android Studio (or Android SDK + command line tools) with an Android SDK and platform (at least API 26+)
- (Optional) A keystore if you want a signed release build

Quick overview (recommended: make a Debug APK first):

1) Install Bubblewrap CLI

```bash
npm i -g @bubblewrap/cli
```

2) Initialize a TWA project

Pick the manifest URL for your live site (replace below). We will use the package id you chose: `com.example.imox`.

```bash
export MANIFEST_URL="https://your-site.example/manifest.json"
export PACKAGE_ID="com.example.imox"
bubblewrap init --manifest=$MANIFEST_URL --packageId=$PACKAGE_ID --name="IMMO X" --shortName="IMMO X"
```

This will create a directory (by default `twa-manifest` or similar). Follow the interactive prompts — the defaults are usually fine.

3) Build a Debug APK (for testing)

Open the generated Android project in Android Studio and run it on a device/emulator, or build via Gradle from the project root:

```bash
cd <your-twa-project-folder>
# Linux / macOS
./gradlew assembleDebug
# Windows
gradlew.bat assembleDebug
```

The resulting debug APK will be under `app/build/outputs/apk/debug/app-debug.apk`.

4) Build a Signed Release (for Play Store)

Create a keystore (example):

```bash
keytool -genkeypair -v \
  -keystore release-keystore.jks \
  -alias imoxkey \
  -keyalg RSA -keysize 2048 -validity 10000
```

Then in Android Studio set up the signing configuration (Build > Generate Signed Bundle / APK) and point to the keystore, or configure Gradle signing and run:

```bash
# produce an unsigned release APK with gradle
./gradlew assembleRelease
# sign & align (example commands)
zipalign -v -p 4 app/build/outputs/apk/release/app-release-unsigned.apk app-release-unsigned-aligned.apk
apksigner sign --ks release-keystore.jks --out app-release-signed.apk app-release-unsigned-aligned.apk
```

Notes: `zipalign` and `apksigner` are included in the Android SDK build-tools. If you use Android Studio's Generate Signed APK flow it handles signing and alignment.

Automation / CI
- You can automate building in CI (GitHub Actions) but you'll need to add keystore and passwords as secrets.

Files I added to the repository
- `README_ANDROID.md` — this guide (you can edit)
- `build-apk.sh` — helper script to init and build a debug APK (run locally; assumes Android SDK available)
- `twa-manifest.example.json` — a small example/template for a TWA manifest

Next steps for me (pick one):
- I can create a Bubblewrap config pre-filled with your manifest URL (if you give it) and push it to the repo so you can run the script without typing things.
- I can walk you through publishing the app to Play Store (creating store listing, upload, release steps).

Run the helper script locally (example):

```bash
# make it executable once
chmod +x build-apk.sh
# run (replace manifest URL if you have a live site)
./build-apk.sh "https://your-site.example/manifest.json" com.example.imox
```

If you don't yet have a live HTTPS URL, tell me and I will guide you to deploy the repo to Render first.
