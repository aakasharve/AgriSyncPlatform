# Voice instant, Phase A: remove the waits we created, bring Sathi into the ring (design)

**Spec id:** `voice-instant-phase-a-2026-11-23` · **Date:** 2026-11-23 · **Base:** `task/plr-d10-rc1` at `61447ea0` (the ShramSafal TEST app line) · **Branch (when built):** cut from the test branch, one lane per task group below.
**Status:** design approved by the founder 2026-11-23; not built. Everything marked *(my call)* is the designer's and can be overruled.
**Private mirror:** the cofounder OS keeps specs in `_COFOUNDER/specs/_active/`, which is not in this checkout; the CTO session copies this file there so PRs can reference the id.

## Founder's approval (2026-11-23, his words as written)

- Problem: "from the moment we using Sarvam for processing the waiting speed was the issue", "The waiting is too much for the bigger voice notes".
- Direction: "I don't want to rely on non-Indian models … voice data I want to be preserved in India", "we want to preserve and save the recording forever", "people should not need to speak again due to our technical lack of infra".
- Experience: "The Sathi image must be there to make it feel interactive. Someone is understanding him", "that feel, that energy … indicates that their farm is being built or being created based on his voice", "जे सांगितलं नाही ते मोठ्या चांगल्या पद्धतीनं रेड कलरमध्ये हायलाइट झालं पाहिजे", "make it more refined and professional".
- Approval of the prototype (artifact *Shram Sathi Instant Voice*, version 3): "Approved, write the Phase A spec and plan".

---

## 1. Intent

After the farmer taps stop, he must:
1. **Know at once that his voice is safe** (under 0.3 s on a low-end phone).
2. **See someone understanding him**: Shram Sathi in the centre of the understanding ring, each understood part lighting up on the ring and being added to a picture of *his plot*.
3. **Get the result screen as soon as the server answers**, not a sync cycle later.
4. **See clearly, in red, what he has not told yet**, with one tap to tell it.

Phase A does this **without** the live-streaming lane (Phase C) and **without** changing which AI provider sorts (Phase B). It removes waits that our own code adds and makes every visible step a real event.

## 2. What exists today (verified on `61447ea0`)

**Where the time goes after stop, in order** (all sequential):

| # | Step | Code | Cost |
|---|---|---|---|
| 1 | Recordings of 60 s or less are encoded by playing them through the browser in real time | `AudioRecorderStreaming.tsx:241` → `VoicePreprocessor.processStreamingResult` → `SegmentCompressor.encodeToWebm` | ≈ speech length |
| 2 | The same recording is decoded, trimmed and encoded in real time **again** | `useVoiceRecorder.ts:112` `processBlobAsSingleBlob` | ≈ speech length again |
| 3 | A full extra decode only to estimate a duration that is already known | `BackendAiClient.ts:469` → `BackendAiClient.helpers.ts:224` | ≈ 0.2–1 s on a low-end phone (unmeasured) |
| 4 | Server writes the audio to S3 **before** starting speech-to-text | `AiOrchestrator.cs:358` | one S3 round trip |
| 5 | Speech-to-text pieces 2 at a time | `SarvamOptions.cs:67` `SttMaxParallelPieces = 2`; model `saaras:v3` (`appsettings.Production.json:49`) | ≈ 5 rounds for a 3-minute note |
| 6 | Structuring segments 2 at a time | `ChunkedStructuring.cs:33` `MaxParallel = 2` | 2–4 rounds for a 3-minute note |
| 7 | The phone waits for a whole sync cycle (push, pull, AI-job worker) before showing the result screen | `useLogCommands.ts:348` → `logSyncMutationService.ts:787` `await backgroundSyncWorker.triggerNow()` | one sync cycle, queued behind any running one |

Recordings over 60 s already skip steps 1–2 (`recorderWords.ts:67` `LIVE_ENCODE_AFTER_SEC = 60`; `liveEncoder.ts` encodes while he speaks; `liveEncodedUpload.ts`). That path is proven on the test app and is the fix for short notes too.

**What the farmer sees today:** the recorder (`RecorderFace`), then the Shram Sathi waiting screen (`logRecorder.tsx:89` `ShramSathiUnderstanding`, a character video and rotating quotes, no progress), then the result screen (`VoiceResultScreen.tsx`) whose ring reveal (`RingStage.tsx`) plays once per recording. Untold parts already show as red on the ring; telling a part opens the one mic (`voiceResultView.tsx:146` `purpose: 'fillPart'`).

**Not measured:** no stage timings have ever been recorded (doctrine E6). Phase A measures first.

## 3. Design

### 3.1 Measure (before and after)
- Phone: one `voice_timing` telemetry event per recording with `stopToAckMs`, `stopToUploadStartMs`, `uploadMs`, `serverMs` (from the response header), `stopToResultMs`, recording length, network type, device memory class. Uses the existing perf marks and analytics bus; no new endpoint.
- Server: `/shramsafal/ai/voice-parse` returns a `Server-Timing` header (`s3`, `stt`, `struct`, `total`, in ms) and logs the same as structured fields. No contract change for installed phones (P11).
- Baseline captured on the founder's phone and one low-end Android, 30 s and 3 min notes, 4G and weak signal, **before** any speed change ships.

### 3.2 Speed: remove the waits we created
1. **Encode while he speaks, for every length.** Route every streaming recording through the live-encoded path (today only > 60 s). Fallback stays the one-pass mu-law WAV. Steps 1–2 above disappear.
   - Consequence *(my call)*: short notes are no longer silence-trimmed on the phone. The upload is slightly larger (24 kbps Opus: about 90 KB for 30 s) and speech-to-text bills a few extra seconds of silence. Accepted; server-side trimming can come later if the bill shows it matters.
2. **No duplicate decode.** Skip `estimateAudioDurationMs` when the recorder supplied the duration.
3. **Result screen from the parse response.** For a voice auto-save, enqueue for sync (fast, local) and **start** the sync without awaiting it; show the result at once. The "not queued" honesty badge still comes from the enqueue outcome, which is known before the sync starts. The server score arrives with the first completed sync; the ring already shows no number until then, never a 0 (`DayUnderstandingCard`/`ResultHero` behaviour unchanged).
4. **Server: S3 write in parallel with speech-to-text.** Start the raw-audio PUT and speech-to-text together; await both before the job row is written. Non-fatal PUT behaviour unchanged.
5. **More parallel pieces.** `SttMaxParallelPieces` 2 → 4 via configuration (Sarvam pay-as-you-go allows 60 requests/minute; a 3-minute note is 9 pieces). `ChunkedStructuring.MaxParallel` becomes an option, 2 → 4.
6. **Saaras v4** (`saaras:v4`; v3 is legacy per Sarvam's changelog of 2026-09). Switched by configuration only after a side-by-side on the founder's real recordings shows no loss (word error on numbers, names and products). Same price.

### 3.3 Feel: Sathi understands him in the ring
1. **Stop = certainty.** On stop: Sathi's eyes-closed nod, a green check on his orb, the existing FEEL-1 `success` haptic and a two-note sound, and "लक्षात ठेवलं ✓ तुमचा आवाज सुरक्षित आहे". Shown only after the phone's write of the recording finished (P10: "on this phone" is never called "on the server").
2. **The waiting screen becomes the Sathi ring.** Replace `ShramSathiUnderstanding` on the processing screen with `SathiRingStage`: the understanding ring (the app's 9 categories, icons from `understandingRing/icons.ts`) with Sathi in the centre and a picture of *his plot* under it.
   - **Real stages only:** फोनवर जतन ✓ (phone write done) → सर्व्हरवर पोहोचला ✓ (upload finished, from the request's upload progress) → साथी समजून घेतोय (awaiting the answer). Sathi's thinking face and a light circling the ring while waiting. Never a percentage, never a timer (P4).
   - **When the answer arrives:** each understood part is revealed in turn (≈ 0.6 s each): a spark travels from Sathi to the part, the part lights with its value ("मजूर · ५ जण"), the part drops into the plot (5 workers walk in for 5 workers, vines grow for work done, mist for a spray, blue drip lines for water, a tractor for machinery, a signpost for cost, notes and reminders). Then the lock: the plot comes alive, Sathi smiles and reads back one sentence ("मी ऐकलं: …"), untold parts turn red.
   - The reveal shows **only what the parse returned**; the plot draws only parsed facts. A labour row without a count draws one figure and no number (P4). Scenery (sun, hills, dust) carries no data.
   - Then the screen hands over to the result screen; `RingStage` lands settled for this recording (no second reveal).
3. **Five Sathi moods** cut from the existing `shramsathi-a.mp4`: listening, thinking, nod, eyebrows up, happy (stills first, short clips later *(my call)*). Idle keeps the full video.
4. **Ring labels never leave the frame.** Short labels on the ring (कामे, मजूर, खत-औषध, पाणी, यंत्र, पीक, खर्च, निरीक्षण, आठवण), anchored outward from each part; full names on the result screen. Must fit 320 px wide with no clipping.
5. **Untold parts in strong red** (founder 2026-11-23). On the ring: red border, red "!" badge, red label pill, slow pulse. On the result screen, a new section "हे अजून सांगितलं नाही (N)" under the score card: one red tile per untold part (icon, full name, "🎤 दाबा आणि बोला"); in "आजचं आतापर्यंत" each untold part is a red row "सांगितलं नाही · दाबा आणि बोला" (strings already in `resultStrings.ts`). A part the farmer closes with "आज नाही" turns grey; the record is unchanged (P3).
6. **Sathi asks one question per red part.** Tapping a red tile opens a sheet with Sathi and one question for that category (new Marathi strings, founder review) plus the existing example (`categories.ts` `hint`), with "🎤 सांगा" (opens the existing `fillPart` mic) and "आज नाही".
7. **Feel and sound.** FEEL-1 haptics only (`selection` per revealed part, `success` on stop and on the lock); the ring module's existing sound (`understandingRing/sound.ts`); no sound while the mic is open; reduced-motion shows the final frame.
8. **Refined, professional.** One type scale, calm glows, no confetti; the lock is the only celebration.

### 3.4 Out of scope (later phases)
- Live words and parts **while** he speaks (Phase C: Sarvam realtime relay).
- Chunked durable upload, server-side reprocessing lane, push notification, Gemini removal and Sarvam structuring (Phase B).
- Sarvam account settings (0-day retention, Pro plan, signed DPA): founder actions, tracked in the plan, no code.

## 4. Rules this must keep
- **P4/P5:** every animation step maps to a real event or a real parsed fact; no fake progress.
- **P9:** nothing new blocks a save or nags during capture.
- **P10:** "on this phone" vs "on the server" stays honest in every label.
- **P11:** installed phones keep working: server changes are additive (header, options); no response field removed or renamed.
- **E6:** baseline measured before the speed changes ship; improvement claimed only from the same measurement.
- **Founder Acceptance Gate** before any deployment beyond the test stack.

## 5. Success measures (to be confirmed against the baseline)
- Stop → "लक्षात ठेवलं ✓": < 0.3 s p90 on a low-end Android.
- Stop → result screen, 30 s note on 4G: at least the measured encode time removed (expected ≈ 2 × speech length), target < 10 s p50 *(my call, confirm after baseline)*.
- 3-minute note on 4G: server time reduced by the parallelism change (expected ≈ 40–50 %, to be measured).
- No change in parse quality on the founder's golden recordings (same parts, same numbers).

## 6. Decisions recorded
- **A-1** Encode while speaking for every length; accept losing phone-side silence trimming *(my call)*.
- **A-2** Result screen does not wait for sync; score fills in when the server answers.
- **A-3** Untold parts are strong red with kind wording and an honest "आज नाही" (founder).
- **A-4** Short ring labels; full names on the result screen (founder to confirm the words).
- **A-5** Saaras v4 only after a side-by-side on real recordings.
