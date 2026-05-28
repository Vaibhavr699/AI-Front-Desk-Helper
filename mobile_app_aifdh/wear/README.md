# Wear OS Companion — Build & Test

The Wear OS watch app delivers real-time coaching cues to a paired Android watch:
a giant single-word glance (ASK / LISTEN / CLOSE) + a haptic, color-coded by urgency.

## Architecture

```
Backend cue fires
  → phone RN app receives `coaching_cue` over WebSocket
  → useWatchCue() calls WearBridge.sendCue()           [modules/wear-bridge]
  → native WearBridgeModule.kt sends MessageClient msg  (path: /coaching-cue)
  → watch CueListenerService receives it                [wear/]
  → vibrates + updates CueStore
  → MainActivity (Compose) renders the glance, auto-dismiss 10s
```

## Pieces

| Piece | Location | What it does |
|-------|----------|--------------|
| Phone bridge (Expo module) | `modules/wear-bridge/` | `sendCue()`, `clearCue()`, `isWatchConnected()` — autolinked |
| Watch app | `wear/` | Standalone Wear OS APK (same `applicationId` as phone) |
| Config plugin | `plugins/withWearOs.js` | Adds `:wear` to settings.gradle on prebuild |
| JS hook | `src/features/in-home-session/hooks/use-watch-cue.ts` | Calls the bridge when a cue fires |

## One-time setup

```bash
# 1. Generate native android/ (one-way: leaves Expo Go behind)
npx expo prebuild --platform android

# 2. The config plugin auto-adds :wear to android/settings.gradle.
#    Confirm it's there:
grep "include ':wear'" android/settings.gradle
```

## Build the phone app (dev client)

```bash
# Local build (free):
npx expo run:android        # builds + installs the dev client on a connected phone/emulator

# Or EAS (cloud, free tier):
eas build --profile development --platform android
```

## Build the watch app

```bash
cd android
./gradlew :wear:assembleDebug
# APK output: ../wear/build/outputs/apk/debug/wear-debug.apk

# Install on a Wear OS emulator or paired watch:
adb -s <watch-device-id> install ../wear/build/outputs/apk/debug/wear-debug.apk
```

## Test the full loop

1. Create a Wear OS emulator in Android Studio (Device Manager → Wear OS Large Round)
2. Pair it: `adb -s <phone> forward tcp:5601 tcp:5601` then pair in the Wear OS companion app
3. Install both APKs (phone dev client + watch app)
4. Start an in-home session in the phone app, trigger a cue (use `scripts/test-live-cues.js`
   on the backend, or speak during a live session)
5. Watch should buzz and show the cue word

## Likely first-build tweak

The `wear/build.gradle` assumes Kotlin 2.0 + the Compose compiler plugin
(`org.jetbrains.kotlin.plugin.compose`), which is what Expo SDK 54 prebuild
generates. If the build complains about the Compose compiler or Kotlin version,
align these in `wear/build.gradle` to match the versions in the generated
`android/build.gradle` (root) — that's the one value that depends on the exact
Expo prebuild output and can't be pinned blind.

## Distribution

Wear OS apps ship **separately** from the phone app to the Play Store (same
`applicationId`, separate APK/AAB). Build a release AAB with
`./gradlew :wear:bundleRelease` when ready. Cost: $25 one-time Play Console fee.
