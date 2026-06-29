# Project — AI Front Desk Helper (AIFDH) + AI Rep Coach

This repo is the umbrella for two products that share one backend, one Expo mobile app, and one dashboard:

- **AIFDH** — AI receptionist (existing product).
- **AI Rep Coach** — real-time sales coaching for home-services field reps (sold standalone via airepcoach.com). The milestones below track **AI Rep Coach**.

Tenants carry two independent flags: `aifdh_enabled` and `rep_coach_enabled`. One person = one record (phone dedup); DISC aggregates across all sources.

## Subprojects
- `./` — Node/Express backend (`routes/`, `lib/`, `services/`, `migrations/`).
- `mobile_app_aifdh/` — Expo SDK 54 RN app (`src/features/`, `app/` expo-router). Bundle id `com.airepcoach.app`.
- `mobile_app_aifdh/wear/` — standalone Wear OS app (Kotlin/Compose).
- `mobile_app_aifdh/modules/wear-bridge/` — local Expo native module, phone→watch via Data Layer.
- `mobile_app_aifdh/native/watchos/`, `native/ios/` — Apple Watch app + WCSession bridge (NOT yet wired into RN).
- `dashboard/` — web dashboard (Vite/React).
- `ai-rep-coach/` — marketing/signup site for airepcoach.com (Vite/React, deploy as Render Static Site).

---

# Milestone Status (last audited 2026-05-29)

Legend: ✅ done · 🟡 partial · ❌ missing

## Milestone 1 — Record → transcribe → AI-score → review (✅ code-complete; only store accounts pending)
| # | Item | Status | Key files / notes |
|---|------|--------|-------------------|
| 1 | RN + Expo project | ✅ | `mobile_app_aifdh/` (Expo 54, expo-router 6). NOTE: lives in `mobile_app_aifdh`, not a separate `airepcoach-mobile` repo. |
| 2 | Biometric auth (Face ID / fingerprint) | ✅ | `expo-local-authentication`; `app/(auth)/enroll-biometric.tsx`, `src/features/auth/biometric.ts`, `settings/components/biometric-card.tsx` |
| 3 | TOTP enrollment | ✅ | `app/(auth)/totp.tsx`, `src/features/auth/screens/totp-screen.tsx`, `routes/rep/auth.js` |
| 4 | airepcoach.com → magic link → install | ✅ | `ai-rep-coach/src/sections/CTA.jsx`, `routes/magicLink.js` |
| 5 | Push-to-record main screen | ✅ | `src/features/field-recording/screens/field-recording-screen.tsx` |
| 6 | Local SQLite offline buffer (60-min, sync queue) | ✅ | `src/features/field-recording/offline/` — `queue-db.ts` (expo-sqlite), `recording-queue.ts` (files → documentDirectory via expo-file-system, 60-min cap in `types.ts MAX_BUFFER_SECONDS`). |
| 7 | Auto-sync on reconnect | ✅ | `offline/sync-manager.ts` — flushes on app launch, AppState→active, 30s interval (while queued), and after each enqueue; expo-network gated; per-item retry w/ MAX_AUTO_ATTEMPTS. Init in `app/_layout.tsx`. Banner: `offline/components/pending-uploads-banner.tsx`. |
| 8 | Backend Whisper transcription | ✅ | `routes/rep/recording.js` `POST /upload`, `services/fieldRecording.js` (`whisper-1`, async via setImmediate). Single-mic audio has no speaker labels, so a gpt-4o `diarizeTranscript()` pass splits it into rep/customer turns BEFORE `analyzeConversation()` — without it the scorer sees 0 customer turns and skips as "one-sided". |
| 9 | Post-call review: 8-dim score, top-3 strengths/improvements | ✅ | Backend `GET /rep/coaching/conversations/:id` (derives strengths/improvements). UI `coaching/screens/conversation-review-screen.tsx`, route `app/(tabs)/coaching/conversation/[id].tsx`. |
| 10 | History list (30 days, paginated) | ✅ | Backend `GET /rep/coaching/me/history` (limit/offset, next_offset). UI `coaching/screens/history-screen.tsx` (useInfiniteQuery + FlatList), route `app/(tabs)/coaching/history.tsx`. Recent card links rows → review, "See all" → history. |
| 11 | Settings (account, subscription, sign out, re-enroll) | ✅ | `app/(tabs)/settings.tsx`, `src/features/settings/screens/settings-screen.tsx` |
| 12 | Per-tenant seat enforcement (count cap) | ✅ | `migrations/090_rep_seat_limit.sql` (`tenants.rep_seat_limit`, null=unlimited), `lib/repSeats.js`. Grant-time cap in `routes/team.js` PATCH `/:id/rep-seat`; defensive login guard in `routes/rep/auth.js` (login + totp). **Run migration 090 + set `tenants.rep_seat_limit` to activate.** |
| 13 | App Store + Play submission packages | 🟡 | `eas.json` (submit profile) + `app.json` (bundle ids, icons, splash, mic + Face ID usage strings, RECORD_AUDIO). **Remaining = external only:** Apple Developer acct ($99) + iOS creds; Play service-account key for `eas submit`; store listing metadata. |

**M1 status:** all code-completable items done and typechecking. Only external account/credential setup remains (#13) + running migration 090 and setting a seat limit (#12).

## Milestone 2 — Real-time in-conversation cues → phone + watch (≈85%)
| # | Item | Status | Key files / notes |
|---|------|--------|-------------------|
| 1 | Realtime streaming transcription (OpenAI Realtime API) | 🟡 | `services/realtimeTranscriber.js` exists but is **NOT wired**. Live path uses `services/chunkTranscriber.js` (Whisper REST batch on `.m4a` chunks, `gpt-4o-transcribe`) because Android expo-av can't emit raw PCM. See `lib/repInHomeWs.js:91`. |
| 2 | Cue engine: GPT-4o, 10–15s windows | ✅ | `services/liveCueEngine.js` (`gpt-4o`, `WINDOW_SECONDS=12`, 20s per-type cooldown) |
| 3 | 8 cue types | ✅ | `liveCueEngine.js:22-31` (ask_discovery, listen, disc_reframe, missing_close, address_objection, slow_down, build_rapport, confirm_next_step) |
| 4 | Phone overlay banner, auto-dismiss 8s | ✅ | `src/features/in-home-session/components/cue-overlay-banner.tsx` (`AUTO_DISMISS_MS=8_000`, urgency colors, haptics) |
| 5 | Apple Watch companion app | 🟡 | **Built, pending iOS build to verify.** watchOS app in `targets/watch/` (RepCoachApp/CueManager/CueGlanceView + `expo-target.config.js`, for `@bacons/apple-targets`). Phone→watch bridge added to the `wear-bridge` Expo module iOS side (`modules/wear-bridge/ios/WearBridgeModule.swift` via WCSession) — same `WearBridge` JS API as Android. `use-watch-cue.ts` now sends on iOS too. **To enable:** add `"@bacons/apple-targets"` to `app.json` plugins + set `APPLE_TEAM_ID` (needs Apple Developer acct), then iOS EAS build. Not added to plugins yet to avoid breaking the Android-first build. |
| 6 | Android Wear OS variant | ✅ | `wear/` (MainActivity.kt, CueListenerService.kt), `modules/wear-bridge/` (MessageClient `/coaching-cue`), `src/features/in-home-session/hooks/use-watch-cue.ts`. Proven E2E. |
| 7 | Cue history per session | ✅ | `in_home_alerts` table (`migrations/076_phase6_d_v0_live_coaching.sql`), `liveCueEngine.js:_persistAlert` |
| 8 | Per-cue-type disable setting | ✅ | `routes/rep/cue-settings.js` (`cue_preferences` JSONB), `repInHomeWs.js:43-52`, `settings/components/cue-types-card.tsx` |

**M2 gaps:** Apple Watch app is fully authored (`targets/watch/` + iOS `wear-bridge`) but unverified — it needs the Apple Developer account, the `@bacons/apple-targets` plugin enabled in `app.json`, `APPLE_TEAM_ID` set, and an iOS EAS build (can't build/test in this env or Expo Go). Realtime API is an intentional trade-off, not a defect — chunked Whisper is the working live path. Live WS: `ws/rep/in-home/:sessionId`.

## Milestone 3 — Whispered audio coaching via bone-conduction earbud (software layer ✅; on-device audio pending EAS build)
Decisions: **software-first** (build now, verify audio on EAS dev build later — Expo Go can't route audio) + **earbud-only playback** (suppress audio when no earbud; fall back to visual so the homeowner never hears it).
| # | Item | Status | Key files / notes |
|---|------|--------|-------------------|
| 1 | Audio cue gen via OpenAI TTS | ✅ | `services/cueTts.js` — `gpt-4o-mini-tts` with whisper-tone `instructions`, mp3 out. |
| 2 | Bluetooth bone-conduction earbuds (Shokz etc.) | 🟡 | No vendor SDK needed — Shokz are standard BT audio. Playback routes to the connected device (OS). Earbud-only gate built (`in-home-session/audio/audio-route.ts`). **Pending EAS/native:** a `modules/audio-route` native module for real BT-route detection (currently a testing override only) + audio-session config. |
| 3 | Whisper-mode TTS (short fragments) | ✅ | Whisper `instructions` in `cueTts.js`; speaks `cue.full_text` (≤120 chars) / headline. |
| 4 | Audio throttle: max 1/60s (configurable) | ✅ | `repInHomeWs.js` global `audioMinGapMs` (default 60s) from `coaching_delivery_prefs.audio_min_gap_seconds`; stepper in `settings/components/audio-card.tsx`. Distinct from the per-type `COOLDOWN_MS` on visual cues. |
| 5 | Manual mute on watch + phone | 🟡 | Phone mute done — header toggle in `live-session-screen.tsx` → `set_audio_mute` WS msg → backend skips TTS. **Watch mute pending** (Wear→phone message + watch UI; EAS/native phase). |
| 6 | Coaching mode pref (visual / audio / both) | ✅ | `coaching_delivery_prefs` channels `{popup,sidebar,watch,audio}` (tier-gated UI in `coaching-delivery-card.tsx`); `repInHomeWs.js onCue` now dispatches the **audio** channel (was popup/watch only). |
| 7 | Latency target ≤3s | 🟡 | Visual cue is instant; TTS follows async (~1-2s) as a separate `cue_audio` WS msg. Not yet instrumented/measured on a real device. |
| 8 | Echo prevention (cue ≠ into call mic) | 🟡 | Earbud-only policy prevents speaker bleed (no earbud → no audio). **Pending EAS/native:** audio-session config to keep TTS on the BT output while the room mic stays on the phone. |

**M3 status:** full software layer built and typechecking — backend TTS + audio-channel dispatch + 60s configurable throttle + phone mute + earbud-gated `expo-audio` playback (`in-home-session/audio/`, `hooks/use-cue-audio.ts`). WS protocol added `cue_audio` (server→client mp3 base64) and `set_audio_mute` (client→server). **Remaining = EAS dev build + native:** a `modules/audio-route` module for real BT-route detection, audio-session routing for echo prevention, watch mute, and on-device latency tuning. Audio can't be heard in Expo Go — use the audio-card "Play on this device (testing)" toggle once on a dev build.

---

## Conventions
- **New code only:** no comments, modular files, clean structure. Do NOT retro-refactor existing backend.
- **Mobile styling:** Tailwind/NativeWind classes only; cards `rounded-sm`.
- **Models:** use the best OpenAI models (`gpt-4o` cues, `gpt-4o-transcribe`/`whisper-1`); cost is not a concern.
- **Expo SDK 54** changed a lot — check https://docs.expo.dev/versions/v54.0.0/ before writing mobile code.
- Do not `git push` unless explicitly asked.
