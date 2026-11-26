# Voice redesign: localhost test plan (everything tested on the founder's PC before it joins the test app)

**Covers:** `2026-11-23-voice-instant-phase-a.md` (speed + Sathi ring + plot + red untold + question sheet + the new समजलं meter), `2026-11-23-voice-india-only-sarvam.md` (Sarvam sorts, durable retry, Gemini out of voice) and the Gemini model updates for OCR.
**Founder direction (2026-11-23):** "All these things I want to test on the test app first on the local host … then we'll integrate all together into existing test app." "Gemini for OCR will remain as it is. Just check the model. If that is expiring, we will change it in the test app."
**Spec ids:** `voice-instant-phase-a-2026-11-23`, `voice-india-only-2026-11-23`.

---

## 1. What gets tested on localhost

| # | Area | Plan | What "works" means |
|---|---|---|---|
| A | Speed | Phase A Tasks 0–6 | Stop → "लक्षात ठेवलं ✓" < 0.3 s; stop → result faster than the measured baseline; no quality loss |
| B | Sathi ring while waiting, plot that fills | Phase A Tasks 7–10 | Only real steps; only parsed facts on the ring and in the plot; 5 workers drawn for 5 workers |
| C | Untold parts in red, Sathi's one question | Phase A Tasks 11–12 | Red tiles and rows for untold parts; "सांगा" opens the existing mic; "आज नाही" writes nothing |
| D | After "पक्कं आहे": seal + समजलं meter as the trigger to say more | Phase A Task 12A | Needle settles on the server score; chips show the details still owed with the score each leads to; answering one raises the dial only after the server rescores; goal celebration at 9 and 10 |
| E | Sarvam sorts, no Gemini in voice | India-only Tasks 1–7 | Golden comparison passes the founder gate; a forced Sarvam failure waits and retries, never goes to Gemini |
| F | Gemini models (OCR stays Gemini) | India-only Task 9A | Receipts and patti read correctly on a supported model before 1 Dec 2026 |

## 2. Gemini model check (done 2026-11-23, Google's deprecations page)

| Setting (`appsettings.Production.json:38-46`, same in `appsettings.Development.example.json`) | Model | Google status | Action |
|---|---|---|---|
| `Gemini:StructurerModelId` | `gemini-3.1-flash-lite-preview` | **Shut down 25 May 2026** (replacement `gemini-3.1-flash-lite`, earliest shutdown 7 May 2027) | If no override exists on the server, every Gemini sorting call fails today. Interim: set `gemini-3.1-flash-lite` so the golden comparison (E) can run; removed from voice after the India-only switch. |
| `Gemini:OcrModelId` (receipts, patti) | `gemini-2.5-flash` | **Shuts down 1 Dec 2026**; after that requests auto-route to `gemini-3.5-flash-lite` | Test receipts and patti on `gemini-3.5-flash-lite` and on `gemini-3.8-flash` (newest Flash, no shutdown announced); pick the one that reads correctly; change before 1 Dec. |
| `Gemini:VoiceFallbackModelId` | `gemini-2.5-flash` | Shuts down 1 Dec 2026 | Removed by the India-only plan; until then same change as OCR. |

**First thing to check on the PC and on the live server:** whether `Gemini__StructurerModelId` or `Gemini__OcrModelId` are overridden by environment variables. If not, the structurer model is already dead and the 1 Dec date applies to OCR.

## 3. What is needed before testing starts

### 3.1 Machine and software (founder's PC = the test stack)
- [ ] Windows PC on the same Wi-Fi as the phones; its LAN address written into `src/clients/mobile-web/.env.fieldtest` (`VITE_AGRISYNC_API_URL=http://<PC-IP>:5048`, the template is `.env.fieldtest.example`); Windows firewall allows inbound TCP 5048.
- [ ] .NET 10 SDK, Node 20, JDK 21 + Android SDK (for `assembleFieldtest`), Git.
- [ ] **ffmpeg on the PATH** (the server cuts long recordings with it: `AudioSplitter`, `FfmpegAudioTranscoder`). Check: `ffmpeg -version`.
- [ ] PostgreSQL 16 test database only (the CTO test cluster, never the live database, never port 5433 for this). Migrations applied with the Bootstrapper.
- [ ] The demo farm seeded on the test database (`--reseed-purvesh-demo`, refuses in Production).
- [ ] Chrome on the PC for remote debugging of the phone (frame rate and timing traces).

### 3.2 Keys and storage (never in git: user-secrets or environment variables)
- [ ] **Sarvam API key** for a test workspace, with Model API data retention set to **0 days** in the Sarvam dashboard.
- [ ] **Gemini API key** (OCR, and the one-time sorting comparison).
- [ ] **Where recordings are kept on localhost — decision needed.** The server always registers the S3 raw store (`Program.cs:231`), bucket `agrisync-raw-ap-south-1-dev` in development settings. Either:
  - **(a)** AWS credentials for the dev bucket on the PC (closest to production), or
  - **(b)** a small local-folder raw store, development only, so recordings stay on the PC (new code, test-only, never registered in Production).
  - *(my recommendation: (a), so "kept forever" is tested the way it will run).*

### 3.3 Test material
- [ ] **25 real voice notes** from the founder's farm for the sorting comparison: worker counts with and without names, sprays with products and doses, drip/flood hours, tractor, costs, a correction ("पाच नाही, सहा"), a future task, a no-work day, two 5–10 minute notes. Kept on the PC (or the dev bucket), never in git.
- [ ] **10 receipt and patti photos** for the OCR model check, with the correct values written down beforehand.

### 3.4 Devices
- [ ] Founder's phone with "ShramSafal TEST" (app id `com.agrisync.shramsafal.test`, installs beside the live app).
- [ ] One low-end Android (3 GB memory or less) with the same TEST build.

### 3.5 Feature switches for side-by-side testing (new, test build only)
- [ ] `VITE_SATHI_RING=1` — the Sathi ring + plot replaces the old waiting screen (0 = old screen).
- [ ] `VITE_UNDERSTANDING_METER_V2=1` — the completion moment (seal + समजलं meter with "what raises it") opens after "पक्कं आहे" (0 = today's behaviour).
- [ ] Server settings, test stack only: `Sarvam:SttModel`, `Sarvam:SttMaxParallelPieces`, `Ai:Structuring:MaxParallel`, `Gemini:OcrModelId`, `Gemini:StructurerModelId`, and the `ssf.ai_provider_configs` row (`structurer_provider`, `fallback_enabled`).

### 3.6 People and decisions
- [ ] Founder: Marathi review of the 9 short ring labels, 9 Sathi questions, "साथी थोड्या वेळात समजून घेईल", the 6 detail questions for the meter (dose, water, cost, which product, what he noticed, which job) and the meter lines ("लक्ष्य ९ गाठलं", "सगळं समजलं").
- [ ] Founder: allow the server to send the details still owed with their projected score (`nextDetails`, names only).
- [ ] Founder: go / no-go after the sorting comparison (E) and after the OCR check (F).
- [ ] Founder: storage choice 3.2 (a) or (b).
- [ ] Who builds the TEST APK on the PC (founder's CTO session) and who merges lane branches into the test branch.

## 4. Order of work on localhost

Each stage: build on a lane branch from `task/plr-d10-rc1` → run all automated tests → run on the PC stack with the TEST app → founder checks → next stage.

1. **Stage 0: stack ready and baseline.** Section 3 done. Phase A Task 0: timing on both phones (5 × 30 s, 3 × 3 min, Wi-Fi and a throttled connection). Save the baseline table.
2. **Stage 1: speed.** Phase A Tasks 1–6 behind configuration. Measure again with the same script; compare with the baseline.
3. **Stage 2: Sathi ring while waiting + plot.** Phase A Tasks 7–10 with `VITE_SATHI_RING=1`.
4. **Stage 3: red untold parts + Sathi's question.** Phase A Tasks 11–12.
5. **Stage 4: completion moment + समजलं meter.** Founder decision on the new `nextDetails` field first, then Phase A Task 12A with `VITE_UNDERSTANDING_METER_V2=1`.
6. **Stage 5: India-only.** India-only Tasks 1–2 (measure, compare; founder gate), then Tasks 3–7 (Sarvam sorts, durable retry, real cost, Gemini out of voice).
7. **Stage 6: OCR model.** India-only Task 9A on the 10 photos; set the chosen model.
8. **Stage 7: full regression, then integrate.** Section 5 cases pass on both phones; all lanes merged into the test branch; one TEST APK with every switch on; founder acceptance gate.

## 5. Test cases to run on localhost (both phones unless noted)

| # | Case | Expected |
|---|---|---|
| 1 | 30 s note, Wi-Fi | Ack < 0.3 s; Sathi ring shows real steps; parts reveal; result without the old sync wait; meter plays ≈ 5 s |
| 2 | 3-minute note | Server pieces run 4 at a time; result faster than baseline; plot shows each part said |
| 3 | 10-minute note | Completes; no "speak again"; split recording sorted in parts by Sarvam |
| 4 | Phone in airplane mode during recording, back online later | "आवाज फोनवर सुरक्षित", result arrives after reconnect; nothing lost |
| 5 | App killed right after stop | On reopen the recording is still there and gets processed |
| 6 | Server stopped during upload | Retry when the server is back; no duplicate entry (same idempotency key) |
| 7 | Sarvam key wrong (forced failure) | Job waits ("साथी थोड्या वेळात समजून घेईल"), retries, completes after the key is fixed; no Gemini call in logs |
| 8 | Labour "८ मजूर, रमेश आणि सुरेश" | 8 on the ring and 8 figures in the plot; names are an overlay, count unchanged (P7) |
| 9 | Labour without a number | One figure, no number shown (P4) |
| 10 | Correction "पाच नाही, सहा" | Final value 6 |
| 11 | Only a future task ("उद्या फवारणी करायची") | Reminder part, no "work done" |
| 12 | No-work day | No score number; honesty acknowledged (existing DeclaredNoWorkDay path) |
| 13 | Typed entry ("साथीला पाठवा") | Same result screen marked "लिहिलेलं", no player |
| 14 | Tap red part → "सांगा" | Existing one-mic opens for that part; new recording joins the same day; red turns green |
| 15 | Tap red part → "आज नाही" | Part grey on screen; record unchanged |
| 16 | Tap "पक्कं आहे" on a spray entry with no dose | Seal, needle on the server score, "कॉन्फिडॉर किती वापरलं? → X / १०" listed first |
| 17 | Answer the dose chip | One-mic answer; dial rises only when the server's rescored /10 arrives; chips update |
| 18 | Score not yet on the server; tap during the moment | "अजून समजतंय…", never 0; a tap jumps to the final frame |
| 19 | Phone "reduce motion" on | Final frames only, everywhere |
| 20 | Low-end phone | ≥ 30 fps during the plot and meter (Chrome trace) |
| 21 | Dark mode, English mode | Readable; English strings shown in English mode |
| 22 | 320 px wide screen | No label outside its element on ring, tiles or meter |
| 23 | Receipt and patti photos (OCR) | Values match the written answers on the chosen Gemini model |
| 24 | Existing flows: हजेरी, edit form, past-day entry, Sathi's daily question | Unchanged |

## 6. Exit criteria before integrating into the test app
- [ ] All automated suites pass (phone `vitest`, `tsc`, lint; server `ShramSafal.Domain.Tests`, `AgriSync.ArchitectureTests`), output saved.
- [ ] Section 5 cases pass on both phones; failures fixed or explicitly accepted by the founder.
- [ ] Baseline vs after timing table saved; only measured gains claimed.
- [ ] Sorting comparison and OCR check approved by the founder.
- [ ] Marathi strings approved.
- [ ] Founder Acceptance Gate ticked; then merge into the test branch and build the TEST APK with all switches on.

## 7. Risks
- **Hidden server overrides:** environment variables on the PC or server may differ from the settings files; checked first (section 2).
- **1 Dec 2026 OCR deadline:** if stages slip, change only `Gemini:OcrModelId` first (Stage 6 can run before Stage 1).
- **Sarvam price ambiguity** (₹10/₹25 vs ₹15/₹60 per million tokens): confirm with Sarvam before reading the cost results as final.
- **Low-end phones:** the plot and meter need the lite mode; checked in case 20.
