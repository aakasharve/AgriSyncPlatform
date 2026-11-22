# DFES questions: name his work, then ask what this stage needs (design)

**Spec:** `plr-d10-redesign-real-integration-2026-10-25` · **Date:** 2026-11-21 · **Branch (when built):** `task/plr-d10-dfes-questions`, cut from the test branch after it holds `f3f0071e` (CTO gate).
**Status:** design, not built. Founder decisions recorded below are his; everything marked *(my call)* is the designer's and can be overruled.

## Founder's approval (2026-11-21, in the DFES session, his words as written)

- Request: "improve DFES also with these changes that what it suppose to ask back either AI needed there to understand the context and to make it more relatable context rich question that include the stage wise things from the all the schedule ... it must make the farmer more talkative and more specific than being vague but should not restrict him to talk ... appreciating his each and every effort for growing that crop ... not motivation but kind of appreciation for each work log he said".
- On the approach: "remove that agronomist flag as we have the web search feature ... check each and every document of NRC for that crop and should be confident to say as we are not lying, i want you to build both Pattern and AI all together, freeze was there for new feature this is missing link we cant call it new feature but proving our thesis with more honesty".
- His answers to the four decision questions: who is asked → **"Split by role (Recommended)"**; photo verdict → **"Show the farmer at once"**; NRC downloads → **"Yes, download them"**; this design → **"Approve, start building"**.
- On sources: "download the PDFs, but every time we can't use the PDF as a source of truth ... We need to extract them and store them in the form of schedule only ... directly PDFs are not allowed to publish. Shram Safal will create a schedule out of it, and then only user can see it."

---

## 1. Intent (founder, 2026-11-21, his words summarised)

After every log Sathi should:
1. **Name each piece of work he did** — respect and appreciation for each effort, **not** motivation or cheerleading.
2. **Ask a question that fits where his crop is** in its schedule, so he says more and says it more exactly, without boxing him in. Use what the schedule expects at this stage.
3. Make farming feel **manageable and understandable**.

Two additions he gave via the schedule-making session (2026-11-21):
4. **"Why wasn't this done?"** for a schedule task whose window has fully passed with no matching log (or a different one) — reason + challenge, answer never changes the record.
5. **Optional photo as proof of an observation**, checked against his counts (canes, buds, shoots, bunches, insects per shoot), verdict stored, his words never overwritten.

**Why it matters:** this is the missing link of the thesis — a record gets truer and fuller when the farmer feels heard and is asked the right thing at the right time. The founder ruled it is not a "new feature" under the 2026-11-19 scope freeze.

### Founder decisions already made
- **D-A.** Build **both**: approved **patterns** (filled with his words and the stage) **and AI-written** questions.
- **D-B.** **Remove the agronomist gate.** Replace it with a **source gate**: every agronomic statement (stage, what to look at, thresholds, any advice) must carry a citation to an **ICAR-NRC Grapes** (or other ICAR) document and page, found and read while building. No source → not asked. "We are not lying."
- **D-C.** One question a day stays (he restated it to the schedule session: "within DFES's one-question-a-day rule").
- **D-D (2026-11-21).** **Split by role, one question per person per day.** "Why wasn't this done?" goes only to people who own the plot's schedule (owner, co-owner); stage, count and missing-detail questions go to whoever logged. Needs a person column on `ssf.question_events` and the recent-questions read filtered by person.
- **D-E (2026-11-21).** **The farmer sees the photo verdict at once**, before accuracy is measured. Guard that keeps this honest *(my call)*: a read the model is unsure of, or one that sees less than he counted ("one cane is not ten"), shows "फोटो स्पष्ट नाही" / "फोटो पुरेसा नाही", never "जुळत नाही"; the accuracy test on real photos still runs during the build and its numbers are reported to him.
- **D-F (2026-11-21).** **Download the other public ICAR-NRC grape bulletins** (TB-8, TB-18 and others), each listed with its size before saving, into the schedule kit's sources folder.
- **D-G (2026-11-21).** **PDFs are raw material, never a source of truth to show.** The **Schedule Maker** turns the NRC documents into Shram Safal's own day-by-day, per-variety, actionable schedule; only that schedule reaches the app, and **DFES questions read only that schedule** (its cards, look lines and their sources). No separate library is authored from PDFs in this lane; no PDF text reaches a farmer. The bulletins were downloaded to `G:\Schedule Maker\Source File PDF\NRC website 2026-11-21\` (index `SOURCES.md`) for the Schedule Maker. What DFES needs on each card was handed to that session (`DFES-NEEDS-FROM-THE-SCHEDULE-2026-11-21.md` in the side-session notes folder).
- **Design approved 2026-11-21** with the calls in §9; §5.0 and §9.5 superseded by D-G.

## 2. What exists today (verified on x1 `7981f6ae` + lane `f3f0071e`)

- One question a day at most (phone only: `dfesQuestionBank.ts:30`, `dfesQuestionEngine.ts:362-366`), from a fixed bank of ~10 Marathi sentences, an 8-level priority ladder (Safety, Weather, Stage, Schedule, WeatherReconcile, Gap, Followup, Learning). Gap questions ask for missing numbers (dose, water, cost). Thank-you is only `"{todayActivity} — समजलं."`.
- Shown on the voice result screen inside the Sathi card (`voiceResultView.tsx:133-153` → `LedgerRecognitionPanel` → `MeterQuestionHost`), gated by `VITE_STAGE_QUESTIONS` / `VITE_UNDERSTANDING_METER`, both **on** in release and field-test builds.
- **Bugs that defeat this design and must be fixed first:**
  - **A spoken answer is never saved.** `LedgerRecognitionPanel.tsx:213` reads `savedLog.transcriptSnapshot.raw`; no production code writes `transcriptSnapshot`. The words are on `savedLog.fullTranscript`.
  - **The day guard uses the UTC date** (`dfesQuestionApi.ts:90`, 00:00–05:30 IST counts as yesterday) and compares against `savedLog.date` (`voiceResultView.tsx:139`), so a log for a past day bypasses it.
  - **The stage question can never fire:** the panel never passes `stageContext` / `lastStageConfirm` (`LedgerRecognitionPanel.tsx:243-267`).
- Server `RecordQuestionEventHandler.cs:53-59` hard-rejects any event without `agronomistApproved && marathiApproved`. `ssf.question_events` is insert-only and has **no** column for the question's words, its sources, a reason code, a challenge note or a photo id (`QuestionEvent.cs:65-93`; only a never-set `PhotoSubmitted` bool).
- Schedule on the phone (`ClientPlanEngine.ts:126-142`): day number, stage (`StageTemplate`: name, code, dayStart, dayEnd, notes), planned items by category; **no product and no "look" field**; template has `sourceLabel?` / `check?` (`scheduler.types.ts:139-140`). The schedule-making session is producing grape cards with sources and structured "look" lines (`G:\Schedule Maker\METHOD-pdf-to-schedule.md` §5, step 8) — **not yet in the app**.
- Past-day logging exists: "त्या दिवसाचं काम सांगा" (`PastDayTell.tsx`), `onDay.ts`; server refuses only dates after the farm's tomorrow.
- Photos: generic attachments linked by `LinkedEntityId/Type` (`Attachment.cs:33-34`); the packet-photo pattern attaches to the DailyLog and carries `attachmentId` on the answer. Nothing links a photo to an observation or a question event.
- Server schedule matcher marks a step Overdue one day after its planned day (`ScheduledWorkMatcher.cs:209`) — conflicts with the founder's window rule; DFES will not use "overdue" for the why-question.

## 3. Goals, non-goals, anti-goals

**Goals**
- G1. Every saved log shows one **appreciation line** naming each piece of work he logged, in his words, nothing he did not say.
- G2. The day's one question can be a **stage question** drawn from the plot's schedule for this window, asking him to look, count or describe — sourced.
- G3. A **why-not** question for a card whose window has fully passed without a matching log (or with a different one): voice + 8 tap reasons + optional challenge.
- G4. An **optional photo** on observation questions, stored as evidence linked to the observation, checked against his count, verdict stored.
- G5. Question and appreciation **text comes from the AI writer when it passes the guard**, otherwise from approved patterns; offline is always patterns.
- G6. Every agronomic line shown carries its **source** (document + page), stored with the question event.
- G7. Spoken answers are kept.

**Non-goals (this lane)**
- Reminders before a window closes ("उद्या शेवटचा दिवस") — the notification system is generic English timers; separate lane.
- Changing the /10 score or its roster. Answers keep never moving the number.
- Crops other than grapes for stage questions and sources (patterns degrade to today's bank for other crops).
- Rewriting founder-locked FINAL strings that are not part of this flow.

**Anti-goals (would be failure even if it works)**
- Nagging: more than one question a day, re-asking a skipped question soon, a question that blocks saving (P9).
- Shaming: "you did not follow the schedule", a photo verdict that calls him wrong in front of others.
- Praise or motivation words ("शाब्बास", "खूप छान", "keep it up"); emoji; any "AI" wording on screen.
- Any agronomic statement without a source; any number or product he did not say (P4); English in Marathi mode.
- Breaking installed phones (P11): no new top-level keys in the parse response; old question-event posts still accepted.

## 4. Approaches considered

| | Approach | Trade-off | Verdict |
|---|---|---|---|
| A | Patterns only (approved once, slots filled) | Safe, free, offline; repetitive | part of the pick |
| B | AI writes every sentence | Natural; needs guard, golden set, cost per log; offline impossible | part of the pick |
| **C** | **AI writer first, patterns as fallback and offline** | Both; more parts | **Founder's pick (D-A)** |

Where the AI writer runs *(my call)*:
- ~~Inside the voice-parse call~~ — would add a top-level key to the parse response (installed phones' schema is `.strict()` at top level → whole log loses validation, P11) and tie question quality to the parse prompt's golden set.
- ~~In the browser~~ — exposes a key, no server log, no cost control.
- **A separate server step after the log is saved** — own prompt, own golden set, own registry row; failure falls back to patterns silently. **Picked.**

## 5. Design

### 5.0 Source library *(founder D-B; **superseded by D-G**: the "library" is the Schedule Maker's published schedule — stages, cards, look lines with `askFarmer`, `count`, `photo` and `sources` — read by the app; the text below remains only as the field list DFES needs)*
- A small JSON library of **cited lines** per crop stage: `{id, crop, stageCode, dayFrom, dayTo, kind: look|why|count|threshold|caution, textMr, textEn, sources:[{doc, page}]}`. Grapes first.
- Built from the ICAR-NRC Grapes documents. Already on the PC (in the schedule kit): Book on Grape (2023), Chotanagpur POP (2026), GAP Table Grapes (2013), POP Wine Grapes. To fetch (founder must approve each download): Technical Bulletin 8 (IPM, 2007), Technical Bulletin 18 (foundation pruning, 2021), others found on the NRC publications page.
- Reuse the schedule kit's cards and look lines when they land (same source discipline: "every line has a source; thresholds copied, never invented"). Until then, the library is seeded from the four documents on disk, every line with doc + page.
- **Gate:** a stage / why / photo question may be shown only if every agronomic line it uses has ≥1 source. Patterns that state no agronomy (appreciation, "what did you see?") need no source.

### 5.1 Fix first (small, needed by everything)
1. Keep spoken answers: settle with `savedLog.fullTranscript` (fallback `transcriptSnapshot.raw`).
2. Day guard: compare the question event's **farm-local date** (IST) with **today's** farm-local date, not `savedLog.date`.
3. Pass `stageContext` from the plot's schedule into the engine so stage questions can fire.

### 5.2 Appreciation line (G1)
- Built from the saved record: work types / titles, inputs as named (product + amount as said), water (hours), labour (counts as said), machinery, expenses. **Excludes** items tagged `plannedOnly` (they are named as "उद्याचं काम नोंदवलं" style, pattern-approved).
- Pattern form: a short sentence that lists what he did, in his words, plus one respectful closing clause (approved by the founder; no praise adjectives).
- AI form: same content, more natural Marathi, validated (5.5).
- Shown every log, on the Sathi card, above the question. **Not** a question; not counted in the one-a-day rule.

### 5.3 The day's question (G2, G3, G4)
Priority ladder kept, with two new producers and one changed gate:
1. Safety / Weather — unchanged rule, but now **enabled only when sourced** (D-B replaces their agronomist flag).
2. **Stage** — the plot's current stage and day number; question built from the stage's cited look/count lines ("आज काड्यांवर कळ्या किती फुटल्यात? 10 काड्या मोजून सांगा" style — wording approved as pattern, or AI-written within the cited line). Answer by voice; tap options only where a cited line gives the categories.
3. **Why-not (schedule deviation)** — fires for a schedule card whose window has **fully passed** (card's `n1`, else planned day + matcher tolerance) with no matching log or a different product/dose/part; **never** while the window or stage is open; asked **once per card**.
   - Voice first, never voice only: big mic + tap reasons (founder's words): पाऊस आला / औषध मिळालं नाही / मजूर मिळाले नाहीत / पैसे कमी पडले / वेळ गेली-विसरलो / दुकानदार किंवा तज्ज्ञाने वेगळं सांगितलं / केलं, पण नोंद केली नाही / दुसरं काही. Optional "अडचण" by voice or typing.
   - "केलं, पण नोंद केली नाही" opens the existing past-day flow (`PastDayTell`) **for that card's day** — no new back-dating mechanism.
   - Stored on the question event (reason code + challenge). The record is never changed by the answer.
4. Gap (dose / water / cost) — unchanged, gets the appreciation lead-in.
5. Followup of an open observation — unchanged trigger; **offers the optional photo** (5.6).
6. Learning — unchanged.

Cadence *(founder D-C, D-D)*: one question per **person** per farm-local day; why-not only to the plot's schedule owners; a skip cools down 3 days (existing); a why-not card is asked once ever.

### 5.4 Text source per question
1. AI writer result if present for this log and it passed the guard → show it.
2. Else the approved pattern with slots filled.
3. Else today's bank sentence.
The question event stores which (`pattern` / `ai` / `bank`) and the exact words shown.

### 5.5 AI writer (G5)
- **Server step** after the log is saved: input = the log's parsed record (the stored answer), plot's crop + stage + day number, the cited library lines for this window, any open observation, the last 14 days of question events (to avoid repeats), the one-a-day state. Output JSON: `{appreciationMr, question:{kind, textMr, answerMode, sourceIds[]}|null}`.
- **Guard (deterministic, server):** Devanagari only for Marathi; every product, number and work named appears in the record or in a cited line used; every agronomic clause maps to a `sourceIds` entry; no advice verb unless copied from a cited line; blacklist of praise/motivation words and AI wording; length caps; at most one question. Any failure → drop the AI text, use the pattern.
- Provider: the same voice-structurer provider resolution the parse uses; a failed call never delays the screen (patterns show first, AI text replaces them if it arrives in time — *(my call: arrive-in-time window ~2 s, else keep the pattern for this log)*).
- **Prompt registry:** new row `DfesQuestionWriter v1.0`; **golden set** of ≥ 20 real-shaped logs (including the founder's 2026-11-20 23:08 log) with checks: names every logged work, nothing invented, cites sources, no praise words, Marathi only. Must run on the model prod really uses (see the private proposal note on which model that is).
- Cost: one short text call per saved log; measured during the golden-set run, reported before deploy.

### 5.6 Observation photo proof (G4)
- On the followup and stage-count questions, an optional "फोटो काढा" button (never required). The photo is uploaded through the existing attachment path linked to the **DailyLog**, and its `attachmentId` is stored on the question event (same pattern as the packet photo).
- **Check:** a vision read of the photo against what he said ("10 पैकी 7 काड्यांवर कळ्या फुटल्या"). Verdict: जुळतं / जुळत नाही / फोटो स्पष्ट नाही / फोटो पुरेसा नाही. Rule: **a photo confirms only what it shows** (one cane is not ten). His words are never changed.
- Accuracy is unmeasured; the verdict is computed, stored and **shown to the farmer at once (founder D-E)**, with the unsure-read guard in D-E.

### 5.7 Data and contracts
- **Migration (additive, nullable, insert-only table `ssf.question_events`):** `asked_user_id` (founder D-D), `prompt_text`, `prompt_origin` (`bank|pattern|ai`), `source_refs` (jsonb), `deviation_reason_code`, `deviation_challenge`, `schedule_card_ref`, `photo_attachment_id`, `photo_check_verdict`, `photo_check_detail` (jsonb). Old phones keep posting without them (P11).
- **Server gate change:** `RecordQuestionEventHandler` no longer rejects on `agronomistApproved`; it rejects an event whose question **states agronomy** (kinds `stage_look`, `safety`, `weather`, `photo_check`) with empty `source_refs`, and keeps the Marathi-approved rule for `bank|pattern` text. Kinds that state no agronomy (`stage_open` "आज बागेत काय दिसलं?", `why_not` about his own schedule, gap, followup, learning) need no source. The `agronomist_approved` column stays for history; new rows write the truth (false).
- New endpoint for the AI writer (e.g. `POST /shramsafal/dfes/sathi-line`), farm-scoped like the question-events routes.
- Sync / pull: nothing new on `/sync/push`; question events are their own route.

## 6. Constraints
Doctrine P4, P7, P8, P9, P11; TAP-1 (voice first, never voice only); no "AI" wording; Marathi mode Marathi only; one question a day; founder-approved Marathi for patterns (picture page at :3060, ticked once); prompt-registry + golden set for the writer; CTO is the merge gate; additive migration needs the CTO's sight; nothing deploys before the founder's acceptance on real phones.

## 7. Build order
1. 5.1 fixes (+ tests).
2. 5.0 library seed (grapes, from the 4 docs on disk; more after download approval) + source gate (phone bank + server handler + migration).
3. 5.2 appreciation (patterns) + 5.3 stage and why-not producers (patterns) + picture page for the founder to tick patterns.
4. 5.5 AI writer + guard + golden set + registry row.
5. 5.6 photo capture + link + stored verdict (display per founder decision).

## 9. Calls settled after the builder check *(my calls unless marked)*

1. **Schedule cards for the why-not question.** This lane uses today's plot schedule templates (`scheduler.types.ts`: `startDay`/`endDay`/`toleranceDays`, category level). A card's window closes at `endDay + toleranceDays` (day numbers from the plot schedule's reference date); "राहिलं" only after that; never while the window or the stage is open. "वेगळं झालं" (different product / dose / part) waits until the schedule kit's cards, which carry products, are in the app (schedule lane). **Any schedule the plot follows counts** (his own, a dealer's, a published one): the why-not question only says what his own schedule said; it states no agronomy, so it needs no source.
2. **Season position.** Stage-look questions match the library by **day number since the plot schedule's reference date** for the grape fruit-pruning schedule (the kit's "pruning day = day 1"). A plot with no reference date, or on a schedule the library is not keyed to, gets **no** `stage_look` question (fail closed, P4); `stage_open` ("आज बागेत काय दिसलं?") is still allowed.
3. **The phone chooses; the AI only words it.** The phone's ladder, cooldowns and once-per-card rule pick the question kind and its cited lines; the writer writes the appreciation and rewords that one question within those lines. Text arriving after ~2 s is kept for history but never replaces what is already on screen for this log.
4. **Photo check storage.** A separate append-only table `ssf.question_photo_checks` (question event id, attachment id, his stated count, the read count, verdict, model, read-at). The answer row is saved first and never waits for the check. The vision model is chosen by a measured test on real photos (like the 2026-11-19 OCR lab), not assumed.
5. **Who checks the library lines.** Every cited line is re-read by a **second, independent reader** (a fresh reviewer that opens the cited page and confirms the line says it); a line that fails is dropped. The **Marathi** of every line a farmer can see goes on the founder's picture page with the patterns, ticked once.
6. **Writer model and golden set.** The writer uses the same provider resolution as the voice parse. Its golden set runs on **both** Sarvam `sarvam-105b-conversations` and the current Gemini GA id, and both numbers are reported; which one ships is the founder's call at acceptance.
7. **Stage questions with an empty library stretch** fall back to `stage_open` (no agronomy, no source), so a plot is never silent and never told something unsourced.

## 8. Left to the builder
File and type names; pattern slot syntax; the library's exact JSON shape and file location; the guard's word lists (seeded from FINAL-strings vocabulary); test layout; the picture-page layout (existing approval-page tooling).
