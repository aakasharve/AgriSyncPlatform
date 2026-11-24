# Voice India-only (Sarvam transcribes and sorts; no voice or transcript leaves India) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every voice note is transcribed and sorted by Sarvam in India; Gemini is removed from the voice path (no structurer, no audio fallback); a failure never loses a recording and never asks the farmer to speak again.

**Architecture:** Two-stage Sarvam → Sarvam (Saaras speech-to-text, `sarvam-105b-conversations` structuring through the existing `ChunkedStructuring`), enabled by removing the "same provider collapses to the one-call path" rule for this pair. Gemini fallback is replaced by a durable retry from the stored audio/transcript. Real per-call cost comes from the usage Sarvam already returns.

**Spec:** follows `docs/superpowers/specs/2026-11-23-voice-instant-phase-a-design.md` §3.4 (Phase B, India-only part). Spec id for commits: `voice-india-only-2026-11-23`. Founder direction 2026-11-23: "I don't want to rely on non-Indian models … voice data … processed on Indian servers only"; "re calculate the cost first … confirm that and then you plan it".

## Why now: the cost question, answered (2026-11-23)

**Was cost the reason Gemini sorts today?** No record says so. The written reason is the founder's 2026-08-25 design ("Sarvam is good at understanding Marathi; once it transcribes, Gemini can shift that transcript to auto buckets", `20260825130000_SetTranscriberProviderToSarvam.cs:15-20`), plus Sarvam's chat models being retired twice in 2026 (`SarvamOptions.cs:23-50`). The 2026-08-14 cost study says the AI bill was never calculated (`docs/superpowers/evidence/2026-08-14-cost-aws-projection.md:510-522`). The "23×" note in `SarvamOptions.cs:44` compares two Sarvam models, not Sarvam with Gemini.

**What it costs now** (estimates; to be replaced by measured usage in Task 1):

| Input | Value | Source |
|---|---|---|
| Fixed sorting prompt sent with every sorting call | ≈ 9,000 tokens (± 30 %) | measured from `AiPromptBuilder.cs` + `MarathiPromptData.cs` text |
| Farm context + transcript per call | ≈ 1,000 tokens | estimate |
| Answer size | ≈ 400 + 11 × transcript tokens | measured live 2026-10-31 on real Sarvam (`ChunkedStructuring.cs:626-640`) |
| Transcript size | ≈ 150 tokens per 30 s of speech | the code's own high estimate |
| Segment size | 187 transcript tokens (4,096-token answers) | `StructuringBudget` |
| Sarvam 105B price | ₹10 in / ₹0.25 cached / ₹25 out per 1M (pricing pages, "introductory through end of 2026") **or** ₹15 / ₹5 / ₹60 (changelog 2026-10-10) | docs.sarvam.ai |
| Gemini 3.1 Flash-Lite price | $0.25 in / $0.025 cached / $1.50 out per 1M (₹88 = $1 assumed) | Google, secondary sources |
| Speech-to-text | ₹0.49 per minute (pay as you go), same for all paths | docs.sarvam.ai |

| Sorting cost per note | 30 s | 1 min | 3 min |
|---|---|---|---|
| Sarvam at ₹10 / ₹25 | ₹0.15 | ₹0.31 | ₹0.81 |
| Sarvam at ₹15 / ₹60 | ₹0.28 | ₹0.55 | ₹1.48 |
| **Gemini 3.1 Flash-Lite (today's structurer)** | **₹0.49** | **₹0.99** | **₹2.69** |
| Gemini 2.5 Flash-Lite (the older model) | ₹0.16 | ₹0.32 | ₹0.87 |

Per farmer per month (one 1-minute note a day, speech-to-text included): **Sarvam only ₹24–31; with Gemini sorting ₹44.** Gemini 3.1 Flash-Lite costs about three times its predecessor, so the cost argument now favours Sarvam. Caching the fixed prompt would cut all rows further, but Sarvam has not documented whether 105B caches automatically (Task 6). Prices exclude GST.

## Global Constraints

- Base: the test branch `task/plr-d10-rc1`; lane branch per task group; push every commit; never merge to `main`; never force-push.
- Doctrine P4 (no number the farmer did not say: golden set checks invented values), P9, P10 (the recording and transcript are server-side before "understood" is claimed), P11 (installed phones keep working: no response field removed), E6 (measured cost and quality before the switch), E9 (a stuck retry reaches us).
- AI DoD: provider change = prompt-registry row + golden-set delta; prompt text unchanged in Tasks 1–5.
- Gemini stays for receipts and patti images until the founder decides (Task 9); this plan removes it from **voice** only.
- Commits: Conventional Commits, body, `spec: voice-india-only-2026-11-23`; never `--no-verify`.

## Change Surface

| Surface | Answer |
|---|---|
| **DB** | One data-only migration setting `ssf.ai_provider_configs.structurer_provider = 'Sarvam'` (and `fallback_enabled` semantics unchanged), with an exact `Down()`. If Task 4 needs a "waiting to retry" job state, it is an additive enum value stored as text: verify against `AiJob` before adding. No table or column removed. |
| **Backend** | `AiOrchestrator` (Sarvam→Sarvam two-stage without collapse, `:319`); voice fallback chain without Gemini; durable retry worker from stored audio/transcript (Hangfire on the existing Postgres, or the existing worker pattern if Hangfire is not approved); `AiAttemptCostEstimator` (`:46`, today a flat `0.070` per second) priced from configuration and real usage; `AiCostBudgetGuard` budget alert. |
| **Frontend** | Result screen state "आवाज जतन आहे — साथी थोड्या वेळात समजून घेईल" when the job is waiting to retry, and the normal result when it completes (via the existing sync pull); no new endpoint. |
| **Cross-cutting** | Prompt-registry row and golden set; privacy notice (`public/legal/privacy_*.md` names Gemini) through the legal-review gate; `CrossBorderTransfer` rows stop for voice (test asserts none); Sarvam account: 0-day retention, DPA, plan. |

## Review Focus

1. **Quality before switch:** Sarvam must match or beat Gemini on parts found, exact numbers, products and labour counts on the golden set, with zero invented values — Task 2 is a hard gate.
2. **No silent loss:** when Sarvam sorting fails, the job waits and retries; the farmer's recording and transcript stay; nothing is sent to Gemini — Task 4 tests pin it.
3. **Long recordings:** the split-recording path (> 4 pieces, `AiErrorMarkers.FallbackMaxPieces`) keeps working with Sarvam sorting — Task 3 tests pin it.

---

### Task 1: Measure real tokens and cost per note (both providers)

- [ ] **Step 1:** On the test stack, record for 20 notes (short and long): Sarvam usage (`SarvamChatClient` already logs the returned `usage`), Gemini usage (`usageMetadata` from the Gemini response: add the same log line), segments per note, STT seconds.
- [ ] **Step 2:** Write `voice-ai-cost-measured-2026-11.md` in the notes folder: tokens in/out per note, ₹ per note at both Sarvam price points and at Gemini's, per-farmer month. Replace the estimates above with these numbers in the PR description.
- [ ] **Step 3: Commit** `feat(ai): log Gemini token usage beside Sarvam's for cost per note`.

### Task 2: Golden comparison, Sarvam vs Gemini sorting (gate)

- [ ] **Step 1:** 25 real consented recordings from the founder's farm (labour counts, sprays with products and doses, irrigation hours, machinery, costs, a correction "पाच नाही, सहा", a future task, a long 5–10 min note). One transcript each (Saaras), sorted by both structurers with the same prompt.
- [ ] **Step 2:** Score per recording: parts found, each number exact, product names, worker counts, invented values (must be 0), cut-off answers, time. Save `golden-sorting-sarvam-vs-gemini-2026-11.md`.
- [ ] **Step 3: Founder gate** — `[ ]` founder reads the table and says go / no-go. No later task merges without "go".

### Task 3: Sarvam transcribes and Sarvam sorts (no collapse)

**Files:** `src/apps/ShramSafal/ShramSafal.Infrastructure/AI/AiOrchestrator.cs:315-330`, data migration, tests.

- [ ] **Step 1: Failing tests:** with transcriber `Sarvam` and structurer `Sarvam`, the two-stage path runs (Saaras pieces, then `ChunkedStructuring` with `SarvamAiProvider` on `text/plain`), `transcript_provider` is written, no call reaches `GeminiAiProvider`; a 6-piece recording completes; the migration sets `structurer_provider = 'Sarvam'` and `Down()` restores the previous value exactly.
- [ ] **Step 2: Run, fail; implement** (collapse only when the transcriber port is missing, not when both are Sarvam); **run** `dotnet test src/tests/ShramSafal.Domain.Tests` and `src/tests/AgriSync.ArchitectureTests` → PASS.
- [ ] **Step 3: Commit** `feat(ai): Sarvam sorts what Sarvam transcribed, in India`.

### Task 4: Replace the Gemini fallback with a durable retry

- [ ] **Step 1: Failing tests:** a Sarvam sorting failure (5xx, timeout, cut-off after bisect) leaves the job waiting with transcript and raw-audio reference kept; no request to Gemini; the retry worker retries with backoff (1 min, 5 min, 30 min, 2 h, 6 h) and completes the job when Sarvam answers; after the last attempt the job is flagged and an alert is emitted (E9); a speech-to-text failure retries from the stored audio, never asks the phone again.
- [ ] **Step 2: Run, fail; implement; run → PASS.**
- [ ] **Step 3:** Phone: the result screen shows "आवाज जतन आहे — साथी थोड्या वेळात समजून घेईल" for a waiting job, and the normal result once the pull brings the completed job (test with a fake pull).
- [ ] **Step 4: Commit** `feat(ai): retry from the stored voice instead of sending it abroad`.

### Task 5: Real cost in the budget guard

- [ ] **Step 1: Failing tests:** `AiAttemptCostEstimator` prices STT by seconds × configured rate and sorting by returned usage × configured rates (input, cached, output); `AiCostBudgetGuard` raises the alert at 80 % of `MonthlyBudgetInr`.
- [ ] **Step 2: Run, fail; implement (rates in configuration, not code); run → PASS.** Commit `feat(ai): price each voice note from real Sarvam usage`.

### Task 6: Prompt caching and answer size (cost and speed)

- [ ] **Step 1:** Ask Sarvam (support) whether `sarvam-105b-conversations` caches a repeated prompt prefix automatically and how cached tokens are billed; record the answer.
- [ ] **Step 2:** If caching exists, keep the fixed prompt as the identical leading block and the farm context after it; measure cached tokens in the usage log.
- [ ] **Step 3 (optional, own prompt version):** a compact answer format to cut the ≈ 11× answer ratio; only with a new prompt version, registry row and golden delta.

### Task 7: Remove Gemini from the voice path and the notice

- [ ] **Step 1: Failing tests:** no voice operation resolves `GeminiAiProvider`; `CrossBorderTransfer` gets no voice rows; receipts and patti still work unchanged.
- [ ] **Step 2: Implement; run → PASS.** Privacy notice updated (voice processed in India by Sarvam), through the legal-review gate.
- [ ] **Step 3: Commit** `feat(ai): voice stays in India end to end`.

### Task 8: Founder actions (no code)

- [ ] Sarvam Model API retention **0 days**. - [ ] DPA signed. - [ ] Plan: pay as you go is enough for REST (60 requests/min); Pro (₹9,999/month) when live streaming (Phase C) needs more than 20 concurrent sockets.

### Task 9: Receipts and patti stay on Gemini (founder, 2026-11-23)

- [x] Founder decided: "Gemini for OCR will remain as it is. Just check the model. If that is expiring, we will change it in the test app."

### Task 9A: Move off expiring Gemini models (deadline 1 Dec 2026)

Checked 2026-11-23 on Google's deprecations page: `gemini-3.1-flash-lite-preview` (today's `StructurerModelId`) **shut down 25 May 2026**; `gemini-2.5-flash` (today's `OcrModelId` and `VoiceFallbackModelId`) **shuts down 1 Dec 2026** and then auto-routes to `gemini-3.5-flash-lite`.

- [ ] **Step 1:** Check the live server and the PC stack for `Gemini__*` environment overrides; record what each actually runs.
- [ ] **Step 2:** On the PC stack, read 10 receipt and patti photos with known values on `gemini-3.5-flash-lite` and on `gemini-3.8-flash`; record field-by-field accuracy in `gemini-ocr-model-check-2026-11.md`.
- [ ] **Step 3:** Set `Gemini:OcrModelId` (and, until Task 7 lands, `VoiceFallbackModelId`) to the model the founder approves; set `StructurerModelId` to `gemini-3.1-flash-lite` for the Task 2 comparison only. Settings change in `appsettings.Production.json` and `appsettings.Development.example.json`; the default constants in `GeminiOptions.cs:6-8` updated to match.
- [ ] **Step 4: Commit** `chore(ai): move Gemini OCR off the model that shuts down on 1 Dec`. Ship this to the test stack first, then to production before 1 Dec 2026, even if the rest of the plan is not ready.

### Task 10: Accept and deploy

- [ ] All suites pass (phone and server), output in the PR.
- [ ] **Founder Acceptance Gate** — `[ ]` founder on the TEST app: 10 real notes sorted correctly by Sarvam; a forced Sarvam failure shows "साथी थोड्या वेळात समजून घेईल" and later completes; nothing reaches Gemini (log check).
- [ ] **Deployment** — `[ ]` test stack updated (`/version` SHA + HTTP 200); `[ ]` production only when the test branch is promoted, with `https://api.shramsafal.in/version` SHA and a `DEPLOYMENT_TRACKER.md` row.
