# Shram Sathi Follow-up System — Founder Ruling (design spec)

**Status:** FINAL founder ruling, 2026-08-15. Binding.
**Source:** founder-authored `G:\VALIDATION\Shram_Sathi_Question_System_v1.md` plus the six
decisions issued in session on 2026-08-15.
**Reconciled against:** `feat/dfes-companion` @ `58aa2c5c`, verified file-by-file (see §R).

---

## Product purpose

Shram Sathi is not a questionnaire and not a diary.

Its job is to understand the farmer's spoken work, identify the single most valuable missing detail,
and ask **one** short, relevant follow-up that makes the day's farm memory more useful.

It measures the **completeness of the conversation** — not the quality of the farmer or his farming.

> Shram Sathi should ask the right farmer one natural question about the right work, exactly once,
> without pretending, repeating or corrupting the farm's future memory.

---

## The six decisions

### 1. Execution cooldowns belong to individual logs

Execution-gap questions are tracked against the **specific source log**, not blocked for days.
Monday's and Wednesday's spray logs both missing a dose may **both** be asked.

- The same log must never receive the same question twice.
- Offline retries, reopening the app, or syncing from another device must not create duplicates.
- Day-based cooldowns remain **only** for context questions (crop stage, previous observation,
  learning follow-ups).
- Use source-log identity + question identity to prevent duplicates. **Do not build a parallel
  question-history system** if the existing mechanism can be safely extended.

### 2. Classify work by the information it naturally produces

Five information shapes, not per-activity logic:

| Shape | Examples | May owe | Must not owe |
|---|---|---|---|
| **Input + water** | spraying, fertigation | product, dose, carrier | — |
| **Dry input** | dry fertiliser | product, dose | water |
| **Water only** | irrigation | duration, method, tanker count | product dose |
| **Physical work** | pruning, harvest, weeding, labour | — | dose, water (unless an input was mentioned) |
| **Observation / no-work** | field inspection, declared no-work | observation, reason, learning | execution buckets |

If classification is uncertain, **do not guess** — ask a neutral WHAT clarification.
The selected plot must never be asked again.

### 3. Do not ask the farmer to repeat weather the app already knows

When reliable weather exists for the selected plot and work date:

- WEATHER must not remain something the farmer "owes".
- Preserve system weather separately, **with its source**.
- Ask only whether weather **affected the work**, or whether he saw something different locally.
- The completeness number may rise slightly — acceptable, because the denominator becomes honest.

The plan must define what qualifies as usable weather: correct plot, correct work date, sufficiently
reliable. Missing, stale or uncertain weather **must not** silently remove the bucket.

System weather and farmer-reported local experience remain **distinguishable** — they are not the
same fact.

**Do not silently change historical numbers.** Use a score-version / migration rule so old results
do not drift without explanation.

### 4. Acknowledge work only when recognition confidence is high

High confidence: *"फवारणी केली, समजलं. औषध किती आणि पाणी किती वापरलं?"*
Low confidence: *"आजच्या कामाबद्दल एक गोष्ट सांगा—नेमकं कोणतं काम केलं?"*

The confidence rule is **central and consistent** — each question must not invent its own reading of
"confident". Below the threshold: do not repeat a guessed activity · do not fill activity-dependent
buckets · ask a neutral clarification · preserve the farmer's original speech.

### 5. Numeric certainty is required in v1

Dose, water and cost preserve whether the value was stated normally or explicitly estimated.
Minimum states: **`reported`** · **`approximate`** · **`unknown / no numeric value`**.

- "५०० मिली" → reported · "अंदाजे ५०० मिली" → approximate · "आठवत नाही" → no numeric value

Certainty belongs to **each number**, not the whole log — a farmer may know the water exactly and
only estimate the cost.

Also preserve: quantity · unit · basis (per pump / per acre / whole plot) · the original spoken answer.

**Never** convert "आठवत नाही" into zero. **Never** silently convert approximate into exact.

### 6. Handle filler answers without insulting the farmer

"ठीक आहे" · "काही नाही" · "सगळं बरोबर" are preserved honestly as **unanchored raw responses** and
must not fill the OBSERVATION bucket.

After such an answer: do not tell him it was insufficient · do not ask another question that day ·
do not award observation completeness · close naturally.

- Confident understanding: *"ठीक आहे. आजचं काम समजलं."*
- Otherwise: *"ठीक आहे."*

A real observation contains something **observable and anchored**: *"पानांवरचे डाग वाढले."* ·
*"कीड मागच्या वेळेपेक्षा कमी दिसली."* · *"खालच्या बाजूला ओलावा कमी होता."* ·
*"कालचे डाग आज वाढले नाहीत."*
A specific **"no change"** is valid. Generic positive filler is not.

---

## Farmer-facing Marathi rules

**The word "नोंद" must not appear in farmer-facing language** — it makes the product feel like a
diary or a government form. Internal code may keep `log` / `record`.

**Founder exception, 2026-08-15:** the motivational lines on the listening screen
(`ShramSathiUnderstanding.tsx`) **keep "नोंद" as they are.** Everything else changes.

Language requirements:

- Write directly in natural spoken Marathi; never translate English templates word-for-word.
- Reuse the farmer's own work word: फवारणी · पाणी · छाटणी · तोडणी.
- Prefer short everyday phrases: "केलं, समजलं" · "आणखी एक गोष्ट सांगा".
- Avoid machine language: "माहिती अपूर्ण" · "तपशील भरा" · "प्रक्रिया" · "वर्गीकरण".
- Do not use "सांगाल का?" in every question — it reads as a form.
- Do not imitate or caricature a rural dialect. Clear, familiar Maharashtra Marathi.
- **Do not force one placeholder across nouns with different grammar.** Rain and wind need separate
  copy:
  - *"आज तुमच्या भागात जोराचा पाऊस झाल्याचं दिसतंय. तुमच्या शेतात काही परिणाम झाला का?"*
  - *"आज तुमच्या भागात जोराचा वारा होता असं दिसतंय. तुमच्या शेतात काही परिणाम झाला का?"*

No unresolved placeholder, internal bucket name, or machine-generated phrase may reach the farmer.

---

## Reliability rules (preserve these)

- Save the farmer's original work **before** asking. The follow-up never blocks the save.
- At most **one** companion question within the existing daily scope.
- **Deterministic** priority order — same inputs select the same question.
- WHAT and dose/carrier gaps **outrank** cost and generic context questions.
- Context and learning questions must not consume the opportunity while a more important execution
  gap is known.
- Answer, skip and retry are **idempotent**.
- A skipped question must not damage the streak or delete the original work.
- Preserve: source log · question key · trigger reason · intended bucket · raw answer · extracted
  answer · certainty — using the **smallest extension of existing structures**.
- Prospective agronomic advice stays **blocked** without agronomist approval of the exact wording
  and trigger.
- LEARNING stays **dormant** until farmer belief, observed result and validated agronomic knowledge
  can be kept separate.

---

## Required focused tests

1. Two different spray logs missing dose can each receive a dose question.
2. Retrying or reopening the same log cannot produce a duplicate question.
3. Dry fertiliser is not penalised or questioned for water.
4. Irrigation is not questioned for product dose.
5. Reliable plot weather removes WEATHER from what the farmer owes.
6. Missing or stale weather does **not** remove the bucket.
7. High-confidence parsing uses the work acknowledgement.
8. Low-confidence parsing uses neutral wording and never repeats a guessed activity.
9. Approximate dose, water and cost remain marked approximate after persistence **and sync**.
10. "आठवत नाही" creates no fake numeric value.
11. Filler observation answers are preserved but earn no OBSERVATION bucket.
12. No second question fires after a filler answer or skip.
13. Farmer-facing question copy contains no prohibited "नोंद" wording.
14. Plot is never asked again.
15. Unapproved agronomic advice remains blocked.

No broad tests unrelated to these changes.

---

## Planning boundary

Reuse the current question engine, scoring system, offline flow and approval gates wherever possible.

**Do not** use this work to redesign the scoring system, build a generic conversation platform,
introduce a new AI provider, or refactor unrelated modules.

---

## §R — Reconciliation against the code (verified 2026-08-15)

| Ruling | What already exists | What must change |
|---|---|---|
| **1** per-log cooldown | `QuestionEvent.DailyLogId` already stored (`QuestionEvent.cs:65`). Skip already gets a shorter, clamped cooldown (`dfesQuestionEngine.ts:57`). | Engine queries by date only. Extend selection to exclude by (log id + question key). **No new table.** |
| **2** five work shapes | `OwedDose` / `OwedCarrier` gate on `HasApplicationOperation` (`DfesLensExtractor.cs:242-256`) — a binary application-vs-not. | Replace the binary with the five shapes. Dry fertiliser must stop owing carrier. |
| **3** weather | `CoverWeather` (`DfesLensExtractor.cs:273`) credits only farmer-stated weather / disturbance / weather-tagged observation. A system weather stamp does **not** satisfy it. `ScoreEngineVersion` already stamped per aggregate (`DailyRichnessAggregate.cs:66`, currently `dfes-3`). | Drop WEATHER from the denominator when usable plot weather exists; keep system weather separately with source. Bump to `dfes-4`; historical rows keep their version. |
| **4** confidence | No central confidence rule exists. | Add one, consulted by every question and by the acknowledgement. |
| **5** numeric certainty | `ObservationEvent.Uncertainty` exists (`ObservationEvent.cs:60`) for observations only. Nothing for dose / water / cost. | Add per-number certainty + unit + basis + original speech, through persistence and sync. |
| **6** filler answers | `hasStructuredObs` is boolean; no anchoring test. | Add an anchoring test; preserve raw; award no bucket; close naturally. |
| **Marathi** | "नोंद" appears in 8 farmer-facing places. | Change all except the `ShramSathiUnderstanding.tsx` motivational lines (founder exception). Two strings — "नोंद पाहा" and the referral invite — await founder wording. |
