# AI Rep Coach — Recording-Survives-Anything, Customer-Centric Sessions & Customizable Scorecards

**Date:** 2026-06-12
**Source:** Drew's code-review email (Rep Coach mobile audio layer) + three product asks from the owner.
**Scope decision:** Everything, sequenced by Drew's priority order. P0 (launch blockers) → P1 → P2 → product asks, with the product asks interleaved where they share code with a fix.

---

## 0. Guiding principle

> The audio IS the asset. A rep who loses one visit recording never trusts the app again. Everything flows from "the recording survives anything."

Two non-obvious facts discovered while grounding this spec against the code — both change the work:

1. **The live in-home session stores NO recording today.** `lib/repInHomeWs.js` receives raw binary chunks, transcribes each via Whisper for live cues (`services/chunkTranscriber.js`), and discards them. There are only `/start` and `/end` routes — no audio upload. So "persist the chunks" (Drew #2) is really **build the session-recording artifact from scratch.** This is also the literal answer to Drew's open question #1: *in an offline session today, the audio is gone.*

2. **The push-to-record path already has the artifact + storage we need.** `routes/rep/recording.js POST /upload` → `services/fieldRecording.js` uploads to **S3**, creates a `coaching_conversations` row (`source_type='rep_recording'`, linked to `lead_id`), transcribes, diarizes, scores. The lead detail screen already renders these via `CoachingRecordingsCard` reading `lead.coaching_conversations`. **So if the in-home recording is uploaded through this same pipeline, it appears under the customer automatically** — product ask #1 falls out of P0 #2.

These two facts collapse Drew #2 + Drew's question #1 + product ask #1 into one coherent piece of work.

---

## Current-state answer: "Does it record in my pocket / if the screen blanks / if the phone dies?"

| Scenario | Records today? | Root cause | Fixed by |
|---|---|---|---|
| Phone fully dead (0% battery) | No — impossible on any platform | Hardware off | Pre-visit battery warning (preflight check already exists); not software-fixable |
| Screen off / locked, pocketed | **No (broken)** | No `UIBackgroundModes`, no Android FG-service perms, no background audio-mode flag | **P0 #1 (DONE)** |
| App backgrounded (rep app-switches) | **No (broken)** | Same as above | **P0 #1 (DONE)** |
| Incoming call grabs the mic | No, silently — red Mic badge keeps showing | `use-audio-stream` stays `streaming=true` on failure | P0 #3 |
| WS drops (basement / no signal) | Permanent hole | Chunks are fire-and-forget, never persisted | P0 #2 |
| Rep navigates mid-visit | Recording killed | Recorder is screen-scoped; unmount stops it | P0 #4a |

**After P0:** pocket, screen-off, app-switch, dropped signal, and interrupting calls all survive. Only a fully dead battery doesn't — and the preflight battery check warns before that. The pocket-plus-one-earbud coaching workflow is exactly what P0 #1 unlocks.

---

## Phase P0 — Launch blockers (recording survives anything)

### P0 #1 — Background audio ✅ DONE
- `app.json`: added iOS `UIBackgroundModes:["audio"]`; Android `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_MICROPHONE`, `POST_NOTIFICATIONS`; de-duplicated the doubled permissions array.
- `use-field-recorder.ts` + `use-audio-stream.ts`: added `staysActiveInBackground: true` to `setAudioModeAsync`.
- Typechecks clean. **Caveat:** verified by typecheck only; background behavior must be confirmed on an EAS dev build (cannot test in Expo Go). The Android foreground-service is satisfied at the manifest/permission level here; if expo-audio's recorder does not auto-start a FG service, a config-plugin or native FG-service may be needed — to be confirmed on the dev build.

### P0 #2 — Persist the recording + make it the recording-of-record
**Decision (owner-confirmed): reuse the field-recording upload pipeline.** New `source_type='in_home_session'`.

Client (`src/features/in-home-session/`):
- Rewrite `use-audio-stream.ts` so each chunk is `FileSystem.move`d into a per-session dir and tagged with a **sequence number** *before* the WS send. WS becomes the live-cue transport only; the on-disk chunk files are the recording of record.
- On session end: stitch the sequenced `.m4a`/AAC chunks in order, then upload the stitched file through the field-recording pipeline (`/rep/recording/upload`, `source_type='in_home_session'`, `lead_id` from the session). Integrate with the existing offline queue (`field-recording/offline/recording-queue.ts`) so an offline session syncs on reconnect — this is what makes the pre-session "offline mode" promise real.
- Delete-after-ack lifecycle for chunk files (also resolves the P2 cache-bloat item).

Backend (`ai-front-desk-backend`):
- `routes/rep/recording.js`: accept `source_type='in_home_session'` (currently hardcoded `'rep_recording'`); link to the `in_home_sessions` row so the session review can reference the stored recording.
- `lib/repInHomeWs.js`: send a `cue_ack` / chunk-ack WS message so the client knows which chunks are safely received and can be cleaned up live.

Open question for plan stage: stitch on-device (concatenate AAC chunks) vs. server-side stitch from uploaded sequenced chunks. On-device keeps the existing single-file `/upload` contract unchanged; prefer it unless AAC concatenation proves unreliable.

### P0 #3 — Stream-death recovery (`use-audio-stream.ts`)
- In the chunk loop, if `Recording.createAsync` throws (incoming call grabs mic, audio-session hiccup), retry recorder creation.
- After N consecutive failures, flip a loud error state: banner + vibration, and **kill the red Mic badge** so the header never lies about capture.
- Surfaces a real `error` state from the hook that `live-session-screen.tsx` renders.

### P0 #4 — Field-recorder lifecycle (`use-field-recorder.ts`), four parts
- **(a)** Move the recorder into a **global provider above navigation** so mid-visit navigation can't unmount-and-stop it; screens subscribe.
- **(b)** Crash recovery: persist `{activeRecordingStartedAt, customerId}` to AsyncStorage on start, clear on clean stop, check for orphans on launch and offer the partial file for upload.
- **(c)** `startRecording` gets a `try/catch` (mic-held/in-call throw → real UX, not an unhandled rejection); `stopRecording`'s catch must still attempt `getURI()` — a stop that throws often still yields a playable file. Today the catch discards the URI.
- **(d)** Permission-denied is currently a silent no-op (`if (!permissionGranted) return`). Add explicit "recording couldn't start" UX + `Linking.openSettings()` deep-link.

**P0 exit criteria:** a session survives screen-off, app-switch, navigation, an interrupting call, and a WS drop; the recording is stored and appears under the customer; nothing silently lies about capture state.

---

## Phase P1

- **#5 Consent-on-tape.** Start capture on "Begin session"; make the first live cue "Read the consent script now," so the script + the customer's agreement are the opening seconds of the audio. Recording proves its own legality. (Pre-session consent flow stays; this adds the on-tape evidence. Attorney review pending.)
- **#6 GPS-suggest visit state** on the pre-session screen (`expo-location` reverse-geocode, rep confirms) instead of defaulting to `home_state`. Fixes cross-border consent-state mis-recording for border-metro reps.
- **#7 Interruption detection.** `rec.setOnRecordingStatusUpdate`; alarm loudly if `isRecording` flips false unexpectedly. Bonus: `durationMillis` from status updates replaces both drift-prone `setInterval` timers.
- **#8 Walkthrough served from backend per tenant/vertical** — replaces hardcoded `INITIAL_WALKTHROUGH` in `live-session-screen.tsx`. This is the live-walkthrough half of the customizable-scorecard ask (Product ask B / owner ask #3). See "Product asks" below.
- **#9 Android `AudioRouteModule`:** remove `TYPE_BLE_SPEAKER` from the private-output list (a BT speaker is the opposite of private — cue audio would play to the room). Keep the A2DP-covers-speakers caveat + prominent mute. Add a code comment that iOS `.carAudio` is a deliberate keep for rep-alone-in-truck briefings.
- **#10 `use-cue-audio` enforcement.** Verify it (a) auto-mutes cue audio instantly on the route-disconnect event, and (b) re-checks the route **synchronously right before each play** so a queued cue can't leak through the phone speaker in the gap. The detection modules only report; enforcement lives here. (Current `use-cue-audio.ts` gates on a `ready` snapshot but does not re-check at play-time — needs the synchronous pre-play guard.)
- **#11 "End anyway, sync later"** when `end.mutateAsync` fails offline at visit end. Queue the end event locally, reconcile on connectivity. (Today `confirmEnd` only re-alerts.)
- **#12 expo-av → expo-audio migration.** Both audio hooks are on deprecated expo-av; expo-audio is already in `app.json` plugins. SDK 54's expo-audio uses `shouldPlayInBackground`/`allowsBackgroundRecording` (not expo-av's `staysActiveInBackground`) and supports continuous `recorder.record()` without stop/start chunking + a `statusListener` — which directly help P0 #1, P0 #2 (continuous capture removes the chunk-gap problem), and P1 #7. Sequence this **after** P0 is proven so the migration doesn't destabilize the launch-blocker fixes, but before the chunk-gap P2 work since continuous capture supersedes it.
- **#13 EAS/Apple ownership move.** EAS owner is `rahull` (personal); move to an org account under the LLC when Drew's Apple Developer entity enrollment lands; same for the Apple team ID. Coordinate; non-code.

---

## Phase P2 (polish / hardening)

- Enable `isMeteringEnabled` + show live level bars during capture (rep confidence it's recording).
- Drop bitrate to 64kbps/22.05kHz mono (field 44.1k/128k, stream 96k today) — halves upload size & failure surface on job-site LTE; still above Whisper's needs.
- Chunk-gap (100–300ms lost every 4s clips words): interim 8–10s chunks; **superseded by continuous capture once on expo-audio (#12).**
- Sequence numbers also fix the `FileReader.onloadend` out-of-order send race (send fires outside the `busyRef` guard) — handled by P0 #2's sequencing.
- Delete chunk files after ack (40MB+/hr) — handled by P0 #2's delete-after-ack.
- Pause/resume on the field recorder (visits have interruptions).
- `scheme` is `aifdh` → change to `airepcoach` before launch (collision risk if a tenant installs both apps). **Coordinate timing — changing the scheme affects deep links / magic-link install.**
- Mic-denied state on pre-session needs the settings deep-link button (pairs with P0 #4d).
- Quick-start sessions (`leadId="quick"`) prompt "attach to a customer" post-visit so they aren't orphaned from DISC/outcomes.
- Consider `TYPE_HEARING_AID` in the Android private list.

---

## Product asks

### Ask #1 (owner) — Live session lives under the customer; rep enters there; manager leaves feedback
**Decisions (owner-confirmed): launch the session from the customer; manager feedback lives in the web dashboard.**

- **Recording under the customer:** delivered by P0 #2 — the in-home recording uploads as a `coaching_conversations` row linked to `lead_id`, which `CoachingRecordingsCard` on `lead-detail-screen.tsx` already renders. Past sessions for that customer list there; tapping one opens the recording + cues review.
- **Launch from the customer:** add a "Start in-home session" entry point on `lead-detail-screen.tsx` that routes into the existing pre-session consent/preflight flow (kept) carrying the `leadId`. The customer detail screen becomes the home for both starting and reviewing sessions.
- **Manager feedback (web dashboard):** the manager role already exists (`lib/auth.js ROLES.MANAGER`), as does a feedback pattern for call-coach conversations (`coaching_feedback` table + `dashboard/.../FeedbackModal.jsx`) and a session detail page (`dashboard/.../InHomeSessionDetail.jsx`). Extend that pattern: a manager opens a rep's in-home session in the dashboard, plays the recording, and submits coaching feedback (free-text and/or rubric). **Important distinction:** the existing `/rep/in-home/sessions/:id/feedback` endpoint is the *rep's own 1–5 self-rating* — it is NOT manager feedback. Manager feedback is a new write (new endpoint or extend `coaching_feedback` with a session link + author role). The rep reads the manager's feedback in-app, under the customer, on the session review.

### Ask #2 (Drew, Product ask A) — DISC briefing card on the pre-session screen
`useLeadDetail` is already fetched on the pre-session screen and only `lead.name` is used. AIFDH already has the DISC profile from the booking call. Add a card: DISC badge + confidence, 3 do's, 3 don'ts, pace guidance. **One check at plan stage:** does the rep lead-detail endpoint (`routes/rep/leads.js`) return the `disc_*` columns? If not, it's a `SELECT` change. (Drew's open question #2.) This is the differentiator — the rep knows the customer before walking in; Rilla never met them.

### Ask #3 (owner) + Drew #8 / Product ask B — Customizable scorecard / cue items per owner
The roofing-company ask: let each owner define the cue items their team focuses on, instead of the fixed set. This is cross-cutting and currently hardcoded in **three** places:

1. **Live walkthrough strip** — `INITIAL_WALKTHROUGH` (Rooms/Scope/Timeline/Budget/Close) hardcoded in `live-session-screen.tsx`.
2. **8 scoring dimensions** — `rapport, property_walkthrough, discovery, education, value_framing, objection_handling, close, professionalism` hardcoded across `services/coachingScorer.js`, `services/coachingRuleExtractor.js`, `services/fieldRecording.js`.
3. **Live cue types** — `CUE_TYPES` + the prompt in `services/liveCueEngine.js`.

Design: a **per-tenant scorecard config** (table, e.g. `tenant_scorecards`) that defines the dimensions/cue items/walkthrough steps for that tenant, with the current set as the default seed (so nothing breaks for existing tenants). Serve it to the live screen (#8) and feed it into the scorer + cue-engine prompts. Owner-facing editor in the dashboard. **This is a large item** — recommend its own sub-spec after P0/P1 land; the plan should scope a v0 (walkthrough steps + cue items configurable; scoring dimensions configurable as a fast-follow) rather than all three at once.

---

## Sequencing summary (Drew's priority order: 1→2→3→4→5→10)

1. **P0 #1** ✅ done
2. **P0 #2** — persist + upload recording (also delivers product ask #1's "recording under customer" + answers the offline question)
3. **P0 #3** — stream-death recovery
4. **P0 #4** — field-recorder lifecycle (a–d)
5. **P1 #5** — consent-on-tape
6. **P1 #10** — cue-audio enforcement
7. Remaining P1 (#6, #7, #8, #9, #11), then **#12 expo-audio migration**, then P2 polish.
8. Product asks #1 (launch-from-customer UI + manager dashboard feedback), #2 (DISC card), #3 (customizable scorecard — own sub-spec).

Open questions to resolve at plan stage: (a) on-device vs server-side chunk stitch; (b) does `routes/rep/leads.js` return `disc_*`; (c) current state of `use-cue-audio` re #10 (needs the synchronous pre-play guard — flagged above); (d) which Expo SDK — confirmed **SDK 54** (CLAUDE.md), expo-audio API verified against v54 docs.
