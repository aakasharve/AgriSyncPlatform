# Voice Instant Phase A (remove our waits, Sathi understands him in the ring) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After stop, the farmer knows in under 0.3 s that his voice is safe, watches Sathi understand him part by part in the ring while his plot fills, and gets the result screen as soon as the server answers, with untold parts in strong red and one tap to tell each.

**Architecture:** Phone: every streaming recording uses the existing encode-while-speaking path; no duplicate decode; the voice auto-save shows the result without awaiting a sync cycle; the processing screen becomes `SathiRingStage` (understanding ring + Sathi moods + a canvas plot) driven only by real events and the real parse result. Server: S3 write in parallel with speech-to-text, more parallel speech-to-text pieces and structuring segments (options), `Server-Timing` on the parse response, `saaras:v4` behind configuration after a side-by-side.

**Tech Stack:** React 19 + TypeScript + Vitest (phone), Capacitor 8 haptics via the existing FEEL-1 engine, canvas 2D; .NET 10 + xUnit (server); Sarvam Saaras (India).

**Spec:** `docs/superpowers/specs/2026-11-23-voice-instant-phase-a-design.md` (approved by the founder 2026-11-23). Spec id for commits: `voice-instant-phase-a-2026-11-23`.

## Global Constraints

- Base: the test branch `task/plr-d10-rc1` (verified at `61447ea0`). Cut one lane branch per task group (Speed: Tasks 0–6; Feel: Tasks 7–12); push every commit; never merge to `main`, never force-push; report head SHAs to the CTO session.
- Doctrine P4/P5 (every visible step is a real event or a real parsed fact), P9 (nothing blocks a save, no nags), P10 (phone vs server honesty), P11 (installed phones keep working: additive server changes only), E6 (measure the baseline before shipping a speed change; claim only measured gains).
- No change to which provider structures (Gemini stays the structurer in Phase A); no prompt change. A speech-to-text model change (Task 6) needs the side-by-side recorded in the notes folder and a row in `_COFOUNDER/memory/prompt-registry.md` (hand the row to the CTO if the base checkout refuses the write).
- Marathi mode shows Marathi only; no emoji in farmer copy except the existing 🎤 on mic buttons; no praise words outside the approved lines; all new Marathi strings go to the founder for review before the acceptance gate.
- Haptics only through `shared/utils/haptics.ts` (`hapticFeedback.*`); sound only through `understandingRing/sound.ts`; no sound while the mic is open; reduced motion shows final frames.
- Commits: Conventional Commits, subject ≤ 72 chars, body, `spec: voice-instant-phase-a-2026-11-23`; never `--no-verify`.

## Change Surface

| Surface | Answer |
|---|---|
| **DB** | **None.** No migration, no new column, no new table. |
| **Backend** | `AiOrchestrator.ParseVoiceTwoStageAsync`: raw-audio PUT and speech-to-text run concurrently; stage stopwatches; `AiEndpoints` voice-parse adds a `Server-Timing` response header. `ChunkedStructuring.MaxParallel` becomes an option (`Ai:Structuring:MaxParallel`, default 2, production 4). `Sarvam:SttMaxParallelPieces` 2 → 4 in `appsettings.Production.json`. `Sarvam:SttModel` → `saaras:v4` only after Task 6. |
| **Frontend** | `AudioRecorderStreaming.tsx` (live path for every length), `recorderWords.ts`, `useVoiceRecorder.ts`, `BackendAiClient.ts` (skip duplicate decode, read `Server-Timing`, upload progress), `useLogCommands.ts` + `logSyncMutationService.ts` (voice auto-save does not await the sync), new `features/voice/sathiRing/` (`SathiRingStage`, `SathiOrb`, `FarmPlotCanvas`, `revealPlan.ts`, `ringLabels.ts`), `logRecorder.tsx` (processing screen), `RingStage.tsx` (land settled after our reveal), `VoiceResultScreen.tsx` + new `NotToldSection.tsx` + `SathiAskSheet.tsx`, `DaySummaryLines.tsx` (red untold rows), `resultStrings.ts` (new question strings), Sathi mood assets under `public/assets/shramsathi/`. |
| **Cross-cutting** | Telemetry event `voice_timing` (existing analytics bus); Sarvam account settings (founder: Model API retention 0 days, Pro plan, DPA); test-stack build (`build:fieldtest`) for measurement; prompt-registry row for the STT model change; APK size check for new assets (< 150 KB total). |

## Review Focus

1. **Result without sync:** the "not queued" badge must still come from the enqueue outcome; the score must appear after the first completed sync; a failed sync must never show a 0 — Task 3 tests pin it.
2. **Live encoding for short notes:** an encoder that fails or a phone that sleeps must fall back to the one-pass WAV, never send a partial file; the idempotency key stays the content hash of the bytes sent — Task 1 tests pin it.
3. **Parallel S3 + STT:** a PUT failure stays non-fatal and leaves `rawInputRef` null exactly as today; cancellation cancels both; the AI job row is written after both finish — Task 4 tests pin it.
4. **The reveal shows only parsed facts:** no part lights that the parse did not return; labour with no count draws one figure and no number; untold parts are those the parse did not return, never a guess — Task 10 tests pin it.
5. **Low-end phones:** the plot runs in lite mode (no blur, fewer particles, 30 fps cap) on devices with ≤ 3 GB memory; reduced motion shows the final frame — Task 9 tests pin it.

---

### Task 0: Measure first (phone and server)

**Files:** `src/clients/mobile-web/src/infrastructure/ai/BackendAiClient.ts`, `src/clients/mobile-web/src/infrastructure/api/resources/AiResource.ts`, `src/clients/mobile-web/src/core/telemetry/eventEmitters.ts`, `src/apps/ShramSafal/ShramSafal.Infrastructure/AI/AiOrchestrator.cs`, `src/apps/ShramSafal/ShramSafal.Api/Endpoints/AiEndpoints.cs`.

- [ ] **Step 1: Failing tests.** Phone: a parse with a response header `Server-Timing: s3;dur=120, stt;dur=2400, struct;dur=3100, total;dur=5800` emits one `voice_timing` event carrying `serverMs: 5800`, `stopToAckMs`, `stopToUploadStartMs`, `uploadMs`, `stopToResultMs`, `recordingMs`, `networkType`. Server: a voice-parse request returns a `Server-Timing` header with `s3`, `stt`, `struct`, `total`, all non-negative integers.
- [ ] **Step 2: Run and see them fail** (`npx vitest run src/infrastructure/ai/__tests__/BackendAiClient.voiceTiming.test.ts`; `dotnet test src/tests/ShramSafal.Domain.Tests --filter FullyQualifiedName~AiOrchestrator`).
- [ ] **Step 3: Implement.** Stopwatches around each stage in `ParseVoiceTwoStageAsync`, exposed on the result; the endpoint writes the header and a structured log line. Phone reads the header, marks `voice:ack` / `voice:upload-start` / `voice:upload-done` / `voice:result`, emits the event.
- [ ] **Step 4: Run → PASS.** Commit `feat(voice): measure each stage of a voice note, phone and server`.
- [ ] **Step 5: Baseline.** On the test stack, founder's phone and one low-end Android (≤ 3 GB), record 5 × 30 s and 3 × 3 min notes on 4G and on weak signal. Save the table (p50/p90 per field) in the notes folder as `voice-timing-baseline-2026-11.md`. No speed task ships before this table exists.

### Task 1: Encode while he speaks, for every length

**Files:** `src/clients/mobile-web/src/features/voice/components/AudioRecorderStreaming.tsx:224-241`, `src/clients/mobile-web/src/features/voice/components/recorder/recorderWords.ts:67`, `src/clients/mobile-web/src/features/voice/liveEncodedUpload.ts`, tests `AudioRecorderStreaming.longRecording.test.tsx`, `useVoiceRecorder.liveEncoded.test.tsx`.

- [ ] **Step 1: Failing tests:** a 20 s recording calls `onAudioCaptured` with `encodedLive: true` and never calls `processStreamingResult`; a 20 s recording whose live encoder returns `null` sends the one-pass mu-law WAV (`RAW_UPLOAD_MIME`), complete; `preprocessAudio` never calls `processBlobAsSingleBlob` for an `encodedLive` recording; `requestPayloadHash` equals the SHA-256 of the bytes sent.
- [ ] **Step 2: Run, fail.**
- [ ] **Step 3: Implement:** set `LIVE_ENCODE_AFTER_SEC = 0` (keep the constant and its comment, updated to say why), so every streaming recording takes the live path. Leave `processStreamingResult` in place for the non-streaming recorder.
- [ ] **Step 4: Run the voice suites** (`npx vitest run src/features/voice src/infrastructure/voice`) → PASS. Commit `perf(voice): encode every recording while he speaks, no replay after stop`.

### Task 2: No duplicate decode

**Files:** `src/clients/mobile-web/src/infrastructure/ai/BackendAiClient.ts:469`, `BackendAiClient.helpers.ts:224`.

- [ ] **Step 1: Failing test:** with `inputRawDurationMs` supplied, `estimateAudioDurationMs` is never called; without it, it is called once.
- [ ] **Step 2: Run, fail; implement; run → PASS.** Commit `perf(voice): skip the extra decode when the duration is known`.

### Task 3: Show the result without waiting for a sync cycle

**Files:** `src/clients/mobile-web/src/app/hooks/useLogCommands.ts:264-274, 340-367`, `src/clients/mobile-web/src/features/logs/services/logSyncMutationService.ts:786-788`.

- [ ] **Step 1: Failing tests:** for an auto-saved voice log, `setStatus('success')` and `setLastSavedLogIds` run before `backgroundSyncWorker.triggerNow()` resolves (use a never-resolving fake); `syncQueuedById` for that log comes from the enqueue outcome; a `triggerNow` rejection is caught and logged, never thrown into the save; hand-filled saves keep today's behaviour (awaited).
- [ ] **Step 2: Run, fail.**
- [ ] **Step 3: Implement:** `enqueueLogsForSync(logs, { awaitSync })` (default `true`); the voice auto-save path passes `false` and starts the sync with `void backgroundSyncWorker.triggerNow().catch(log)`.
- [ ] **Step 4: Run** `npx vitest run src/app/hooks src/features/logs` → PASS. Also run `ResultHero.settled.test.tsx` (score appears after `lastSyncAtMs` changes). Commit `perf(voice): show the result as soon as the server answers`.

### Task 4: Server: S3 write alongside speech-to-text

**Files:** `src/apps/ShramSafal/ShramSafal.Infrastructure/AI/AiOrchestrator.cs:340-400`.

- [ ] **Step 1: Failing tests** (fakes for blob store and transcriber with controllable delays): with a 300 ms PUT and a 300 ms STT the stage completes in < 450 ms; a throwing PUT leaves `RawInputRef` null and the parse succeeds; cancelling the token cancels both; the AI job row is added only after both completed.
- [ ] **Step 2: Run, fail.**
- [ ] **Step 3: Implement:** start `TryPersistRawBlobAsync` and the transcriber call as two tasks; `await Task.WhenAll`; keep every existing log line and failure class.
- [ ] **Step 4: Run** `dotnet test src/tests/ShramSafal.Domain.Tests` and `src/tests/AgriSync.ArchitectureTests` → PASS. Commit `perf(ai): store the raw audio while Sarvam transcribes`.

### Task 5: More parallel pieces and segments (configuration)

**Files:** `src/apps/ShramSafal/ShramSafal.Infrastructure/AI/ChunkedStructuring.cs:33, 210`, `AiOptions` (or the structuring options class it reads), `src/AgriSync.Bootstrapper/appsettings.Production.json` (`Sarvam:SttMaxParallelPieces`, `Ai:Structuring:MaxParallel`).

- [ ] **Step 1: Failing tests:** `ChunkedStructuring` with `MaxParallel = 4` runs at most 4 segment calls at once (semaphore probe); the default stays 2 when the option is absent; `SarvamSttClient` respects `SttMaxParallelPieces = 4`.
- [ ] **Step 2: Run, fail; implement; run → PASS.** Production values: 4 and 4 (Sarvam pay-as-you-go: 60 req/min; a 10-minute note is 25 pieces).
- [ ] **Step 3: Commit** `perf(ai): run four speech pieces and four sorting segments at once`.

### Task 6: Saaras v4 side-by-side, then switch by configuration

**Files:** notes folder; `appsettings.Production.json:49, 53` (`SttModel`, `StreamingSttModel`).

- [ ] **Step 1:** Collect 15 real recordings from the test stack's S3 raw bucket (founder's own, consented), short and long, with labour counts, product names, doses, hours.
- [ ] **Step 2:** Transcribe each with `saaras:v3` and `saaras:v4` (`mode=codemix`, `mr-IN`), run both transcripts through the current structurer, and compare: numbers, product names, worker names, parts found. Record the table in `saaras-v4-side-by-side-2026-11.md`.
- [ ] **Step 3:** If v4 is equal or better on every case class, set both model values to `saaras:v4`; otherwise stop and report to the founder. Add the prompt-registry row (`VoiceStt | saaras:v4 | <date> | side-by-side: <result>`).
- [ ] **Step 4: Commit** `chore(ai): move speech-to-text to Saaras v4 after side-by-side`.

### Task 7: Sathi's five moods as assets

**Files:** `src/clients/mobile-web/public/assets/shramsathi/` (new `sathi-listen.webp`, `sathi-think.webp`, `sathi-nod.webp`, `sathi-bright.webp`, `sathi-happy.webp`), `features/voice/sathiRing/SathiOrb.tsx`.

- [ ] **Step 1:** Cut stills from `shramsathi-a.mp4` (listen 6.5 s, think 4.0 s, nod 2.2 s, bright 2.5 s, happy 0.05 s), 300 px wide, WebP q≈82 (≈ 12 KB each); founder approves the five frames.
- [ ] **Step 2: Failing test:** `SathiOrb` shows exactly one mood layer; `mood('nod', 900)` returns to the base mood after 900 ms; idle shows the video; reduced motion disables the nod/tilt animations.
- [ ] **Step 3: Implement; run → PASS.** Commit `feat(sathi): five moods from Sathi's own video`.

### Task 8: SathiRingStage on the processing screen (real stages)

**Files:** new `features/voice/sathiRing/SathiRingStage.tsx`, `ringLabels.ts`; `src/clients/mobile-web/src/core/navigation/logRecorder.tsx:82-98`; `useVoiceRecorder.ts` (stage signals); `AiResource.ts` (upload progress callback).

- [ ] **Step 1: Failing tests:**
  - stages appear only on their events: `phoneSaved` after the clip write resolves, `uploaded` after upload progress reaches 100 %, `understanding` while awaiting the response; no percentage text anywhere;
  - on stop the ack ("लक्षात ठेवलं ✓") renders within one frame of the phone write and fires `hapticFeedback.success` once;
  - ring labels: at 320 px width every label's bounding box lies inside the stage box (jsdom layout stub + a Playwright check in Step 4); the short labels are exactly कामे, मजूर, खत-औषध, पाणी, यंत्र, पीक, खर्च, निरीक्षण, आठवण.
- [ ] **Step 2: Run, fail.**
- [ ] **Step 3: Implement** the stage with the 9 categories (`understandingRing/categories.ts` order and icons), Sathi orb in the centre, outward-anchored labels, the status line; replace `ShramSathiUnderstanding` in the processing branch when `FEATURE_FLAGS.dailyLoop` is on.
- [ ] **Step 4: Run → PASS;** Playwright screenshot at 320 px and 412 px wide, light and dark, attached to the PR. Commit `feat(sathi): Sathi waits in the understanding ring with real steps`.

### Task 9: The plot that fills from his words (canvas)

**Files:** new `features/voice/sathiRing/FarmPlotCanvas.tsx`, `plotScene.ts`.

- [ ] **Step 1: Failing tests (pure scene functions):** `addPart('labour', {count: 5})` places exactly 5 figures; `count: null` places 1 figure and no number label; `addPart('water')` turns on drip lines; an unknown category adds nothing; `lite: true` caps particles at 12 and disables blur; reduced motion renders the final state in one frame.
- [ ] **Step 2: Run, fail; implement** (draw functions from the approved prototype; quality `auto` → lite when `navigator.deviceMemory ≤ 3`); **run → PASS.**
- [ ] **Step 3:** On the low-end Android, the processing screen holds ≥ 30 fps during the reveal (Chrome remote devtools trace attached to the PR).
- [ ] **Step 4: Commit** `feat(sathi): his plot fills with what he said`.

### Task 10: The reveal from the real parse result, then the result screen

**Files:** new `features/voice/sathiRing/revealPlan.ts`; `SathiRingStage.tsx`; `features/logs/components/voiceResult/RingStage.tsx` (export `markRevealPlayed(saveKey)`); `useVoiceAutoSave.ts` (hand-over).

- [ ] **Step 1: Failing tests:**
  - `revealPlan(parsedLog)` returns one step per category the parse filled, in ring order, with the value text from the parse (labour count, hours, product); categories not filled become `missed`; a category marked unsure stays unlit;
  - the stage lights only those parts, fires `hapticFeedback.selection` once per part and `success` once on the lock; the read-back sentence lists exactly the revealed values;
  - after the hand-over, `RingStage` for that `saveKey` renders settled (no second reveal).
- [ ] **Step 2: Run, fail; implement; run → PASS.** Commit `feat(sathi): reveal each understood part, then hand over to the result`.

### Task 11: Untold parts in strong red on the result screen

**Files:** new `features/logs/components/voiceResult/NotToldSection.tsx`; `VoiceResultScreen.tsx` (mount under `ResultHero`); `DaySummaryLines.tsx` (red untold rows); `resultStrings.ts`.

- [ ] **Step 1: Failing tests:** with 6 untold parts the section title reads "हे अजून सांगितलं नाही" with the count ६ (Marathi digits); one tile per untold part with the full name and "🎤 दाबा आणि बोला"; tapping a tile calls `onTellMore(part)` (via the sheet, Task 12); a part closed with "आज नाही" leaves the section and shows grey in "आजचं आतापर्यंत"; no tile when nothing is untold; English mode shows English strings; long names wrap inside the tile at 320 px.
- [ ] **Step 2: Run, fail; implement; run → PASS.** Commit `feat(result): what he has not told yet, in red, one tap away`.

### Task 12: Sathi asks one question per red part

**Files:** new `features/logs/components/voiceResult/SathiAskSheet.tsx`; `resultStrings.ts` (9 questions, founder-reviewed); `voiceResultView.tsx` (wire to the existing `speakHere({ purpose: 'fillPart', … })`).

- [ ] **Step 1: Failing tests:** tapping a red tile or a red ring part opens the sheet with Sathi (bright mood), the category's question and its `hint`; "🎤 सांगा" calls `speakHere` with `purpose: 'fillPart'` and that part; "आज नाही" closes the part for this screen only and writes nothing to the record; the sheet closes on back.
- [ ] **Step 2: Run, fail; implement; run → PASS.** Commit `feat(result): Sathi asks one question for each part not told`.

### Task 12A: After "पक्कं आहे": seal the day, then the समजलं meter as the trigger to say more

Founder 2026-11-23: "after he taps the completion … one another animation of gratification or celebration"; "The understanding meter is … a trigger that let him know he needs to speak more. That number matters, that decides the quality of the log. Check the DFES code for that." Approved preview: artifact *Understanding Meter* (version 2).

**What the number is (verified in code):** the Day Understanding Score (`DayUnderstandingScore.cs`, roster from `DfesLensExtractor.cs`, engine `dfes-5`): details told ÷ details this day owes (WHAT 20, DOSE 20, OBS_FACET 15, COST 12, PRODUCT_ID 10, CARRIER 10, WEATHER 8 unless the app holds the weather; LEARN_FACET recorded, not counted), × 10, rounded. Fixed denominator, so telling more can only raise it. Labour and plot do not count. Today only the /10 crosses to the phone (`DfesResource.ts:38-40`), so the phone cannot say which detail would raise it.

**Files:** server `GetDayUnderstandingHandler` + DTO (new additive field), `DayUnderstandingScore` (projection helper); phone `infrastructure/api/resources/DfesResource.ts`, new `features/logs/components/voiceResult/completion/` (`CompletionMoment.tsx`, `UnderstandingMeterDial.tsx`, `nextDetails.ts`), `VoiceResultContainer.tsx` (open on confirm), `resultStrings.ts` (detail questions), `app/featureFlags.ts` (`VITE_UNDERSTANDING_METER_V2`).

- [ ] **Step 0: Founder decision** — `[ ]` allow the server to send, beside the /10, the details still owed and the score each would lead to (names only, e.g. `DOSE`; no lens scores). Without it this task stops at the seal and the dial.
- [ ] **Step 1: Failing server tests:** `nextDetails` lists every roster dimension that is applicable, counted and not fully covered, each with `ifToldScore` = the score with that dimension at coverage 1 (same formula, same rounding); sorted by `ifToldScore` then weight; empty when the score is 10 or null; LEARN_FACET never listed; a dimension not owed today never listed; the field is additive (old phones ignore it, P11).
- [ ] **Step 2: Failing phone tests:**
  - tap "पक्कं आहे" → the existing verify is queued, then the moment opens: entry card, seal, dial;
  - the needle steps to the server score (never above it, never 0; null → "अजून समजतंय…");
  - one chip per `nextDetails` item, with the founder-approved question for that dimension and "→ X / १०" from the server; the OBS chip is marked "९ साठी आवश्यक" when 9 is reachable only through it;
  - tapping a chip opens the existing one-mic answer flow for that detail (`stashPendingQuestionAnswer` + `speakHere`), and the dial moves only when the rescored /10 arrives from the server;
  - ≥ 9 → "★ लक्ष्य ९ गाठलं" and the marigold shower; 10 → "★ सगळं समजलं";
  - the month count comes from recorded days (never a streak); tap anywhere skips to the final frame; reduced motion → final frame only.
- [ ] **Step 3: Run, fail; implement; run → PASS.** Playwright pictures at 320 px and 412 px, light and dark, for 3/10, 7/10, 9/10, 10/10.
- [ ] **Step 4: Commit** `feat(result): seal the day and show what raises the समजलं meter`.

### Task 13: Founder actions (no code)

- [ ] Sarvam dashboard: Model API data retention set to **0 days** (it is indefinite by default); screenshot in the notes folder.
- [ ] Sarvam plan: decide Pro (100 concurrent live sockets, needed for Phase C) or stay on pay-as-you-go for Phase A.
- [ ] Sarvam DPA requested and signed (needed before Phase B removes Gemini).

### Task 14: Build, measure again, accept, deploy

- [ ] **Step 1:** All suites: `npx vitest run` (phone), `npx tsc --noEmit`, `npm run lint`, `dotnet test src/tests/ShramSafal.Domain.Tests`, `dotnet test src/tests/AgriSync.ArchitectureTests` → PASS; output pasted in the PR.
- [ ] **Step 2:** `npm run build:fieldtest` → `npx cap sync android` → `assembleFieldtest`; install "ShramSafal TEST" on the founder's phone and the low-end Android.
- [ ] **Step 3:** Repeat Task 0 Step 5 exactly; save `voice-timing-after-phase-a-2026-11.md` next to the baseline with the deltas. Claim only what the table shows.
- [ ] **Step 4: Founder Acceptance Gate** — `[ ]` founder on 2 real phones in a real field, 4G and weak signal: the ack is instant; Sathi's ring shows real steps and reveals each part; the plot fills with exactly what he said; untold parts are clearly red and one tap asks the right question; the result screen appears without the old wait; Marathi strings approved.
- [ ] **Step 5: Deployment** — `[ ]` merged into the test branch and the test stack updated (evidence: test-stack `/version` SHA + HTTP 200); `[ ]` production deployment only when the test branch is promoted, with `https://api.shramsafal.in/version` SHA and a `DEPLOYMENT_TRACKER.md` row. Not done by this lane.
