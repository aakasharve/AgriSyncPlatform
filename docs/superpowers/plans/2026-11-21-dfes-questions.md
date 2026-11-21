# DFES Questions (name his work, ask what this stage needs) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After every log Sathi names each piece of work the farmer logged, then asks one sourced, stage-aware question a day (or "why wasn't this done?"), worded by an AI writer behind a guard with approved patterns as fallback, with an optional photo proof of observations.

**Architecture:** The phone keeps choosing the question (existing ladder in `dfesQuestionEngine.ts`, two new producers); the Schedule Maker's published schedule (stages, cards, sourced look lines; JSON in `sync-contract/schedules/`) feeds both phone and server; the server records richer question events (additive migration) and replaces the agronomist gate with a source gate; a new server step writes the appreciation and rewords the chosen question, checked by a deterministic guard; photos go through the existing attachment path and a server vision check.

**Tech Stack:** React 19 + TypeScript + Vitest (phone), .NET 10 + EF Core + xUnit (server), PostgreSQL 16, Sarvam chat / Gemini (text + vision).

**Spec:** `docs/superpowers/specs/2026-11-21-dfes-questions-design.md` (approved by the founder 2026-11-21; decisions D-A..D-F, calls §9). Spec id for commits: `plr-d10-redesign-real-integration-2026-10-25`.

## Global Constraints

- Branch `task/plr-d10-dfes-questions`, cut from the test branch **only after the CTO confirms it holds `f3f0071e`**; push every commit; never merge, never `main`, never force; report the head SHA to the CTO session.
- Doctrine P4 (nothing he did not say), P7, P8, P9 (never blocks a save, no nagging), P11 (installed phones keep working: no new top-level parse-response key; old question-event posts accepted).
- One question per **person** per farm-local (IST) day (D-C, D-D); a skip cools down 3 days; a why-not card is asked once ever; why-not only to seats holding `AUTHORITY.planWork`.
- No source → no agronomy-stating question (kinds `stage_look`, `safety`, `weather`, `photo_check`). Kinds `stage_open`, `why_not`, `gap`, `followup`, `learning` need no source.
- Marathi mode shows Marathi only; no emoji; no "AI" wording; no praise or motivation words (blacklist: शाब्बास, खूप छान, छान, उत्तम, अभिनंदन, भारी, keep it up, great, well done, good job).
- Tap reasons, verbatim (founder): पाऊस आला / औषध मिळालं नाही / मजूर मिळाले नाहीत / पैसे कमी पडले / वेळ गेली-विसरलो / दुकानदार किंवा तज्ज्ञाने वेगळं सांगितलं / केलं, पण नोंद केली नाही / दुसरं काही. Challenge label: अडचण.
- Photo verdicts, verbatim: जुळतं / जुळत नाही / फोटो स्पष्ट नाही / फोटो पुरेसा नाही; shown to the farmer at once (D-E); an unsure read or a photo that shows less than he counted never says जुळत नाही.
- PDFs are never a source of truth to show (founder D-G): DFES reads only the Schedule Maker's published schedule (stages, cards, look lines and their `sources`); a line marked `ourChoice` is never used; no PDF text reaches a farmer. The NRC bulletins are already downloaded for the Schedule Maker (`G:\Schedule Maker\Source File PDF\NRC website 2026-11-21\`).
- Unset inherited `ConnectionStrings__*` in every shell; never touch Postgres `:5433`; real-Postgres tests only on the CTO cluster `:55700` (`G:\agrisync-scratch\pg-orch`, `pg-run.lock`, drop databases after with `C:\agrisync-wt\.scratch-orch\dropdbs2.sh`); check free disk first; TEMP/TMP to `E:\APPS\Running App Versions\.tmp-aiparse`.
- Phone folder uses a `node_modules` junction to `E:\APPS\Running App Versions\agrisync-plr-x1\src\clients\mobile-web\node_modules`; never delete the lane folder recursively, never `git worktree remove`.
- Commits: Conventional Commits, subject ≤ 72 chars, body, `spec: plr-d10-redesign-real-integration-2026-10-25`, `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; never `--no-verify`.

## Change Surface

| Surface | Answer |
|---|---|
| **DB** | One additive migration: nullable columns on insert-only `ssf.question_events` (`asked_user_id uuid`, `prompt_text text`, `prompt_origin text`, `question_kind text`, `source_refs jsonb`, `schedule_card_ref text`, `deviation_reason_code text`, `deviation_challenge text`, `photo_attachment_id uuid`) and a new append-only table `ssf.question_photo_checks`. Grants follow the table's existing insert-only model. |
| **Backend** | `QuestionEvent` + configuration; `RecordQuestionEventCommand`/`Handler` (source gate, asked user, new fields); recent-events read filtered by caller; new `POST /shramsafal/dfes/sathi-line` (writer + guard + prompt file); photo check (port, Gemini implementation, handler, read endpoint). |
| **Frontend** | Spoken-answer and day-guard fixes; source library loader; engine gate + two producers (stage, why-not); appreciation line; Sathi card text source (AI → pattern → bank); why-not reasons UI; photo button + verdict line; pattern strings. |
| **Cross-cutting** | `sync-contract/schedules/` (the Schedule Maker's published schedule, shared by phone and server; fixture first); prompt-registry row `DfesQuestionWriter v1.0` + golden set; founder picture page (:3060) for pattern and library Marathi; P11 (old phones post unchanged events and still get accepted). |

## Review Focus

1. **A log saved for a past day** (via "त्या दिवसाचं काम सांगा") must not let a second question appear today, and must not ask a stage question for today's stage about that old day — Task 1 and Task 6 tests pin it.
2. **Two people logging on one farm the same day** each get at most one question, and a worker never gets "why wasn't this done?" — Task 3 (server filter) and Task 7 (role) tests pin it.
3. **A log whose only work is a future task** (`plannedOnly`) gets no "work done" appreciation for it, only the "noted for tomorrow" clause — Task 5 test pins it.
4. **The AI writer naming a product or number not in his log** (e.g. "Confidor" when he said "कॉर्नफिल्ड") is dropped by the guard and the pattern shows — Task 8 test pins it.
5. **A photo of one cane when he said "10 पैकी 7"** shows "फोटो पुरेसा नाही", never "जुळत नाही" — Task 9 test pins it.

---

### Task 1: Keep spoken answers and fix the day guard

**Files:**
- Modify: `src/clients/mobile-web/src/features/logs/components/LedgerRecognitionPanel.tsx:212-218`
- Modify: `src/clients/mobile-web/src/features/logs/services/dfesQuestionApi.ts:90`
- Modify: `src/clients/mobile-web/src/features/logs/components/voiceResult/voiceResultView.tsx:139` and the form-save caller in `savedView.tsx` (pass today, not the log's date)
- Test: `src/clients/mobile-web/src/features/logs/components/__tests__/LedgerRecognitionPanel.spokenAnswer.test.tsx`, `src/clients/mobile-web/src/features/logs/services/__tests__/dfesQuestionApi.localDate.test.ts`

**Interfaces:**
- Produces: `spokenAnswerText(savedLog): string | undefined` exported from `LedgerRecognitionPanel.tsx` (returns `savedLog.fullTranscript` trimmed, else `transcriptSnapshot.raw`); `createdAtLocalDate` computed with `getDateKey(createdAtUtc)` from `core/domain/services/DateKeyService.ts`.

- [ ] **Step 1: Write the failing tests**
  - `spokenAnswerText({ fullTranscript: ' 10 पैकी 7 काड्यांवर कळ्या ' })` → `'10 पैकी 7 काड्यांवर कळ्या'`; `spokenAnswerText({})` → `undefined`.
  - Rendering the panel with a pending stashed answer and a saved log carrying only `fullTranscript` calls `settlePendingQuestionAnswer({ transcript: <that text> })` once.
  - `fetchRecentQuestionEvents` maps `createdAtUtc: '2026-11-20T20:00:00Z'` to `createdAtLocalDate: '2026-11-21'`.
  - `voiceResultView` passes `todayLocalDate === getDateKey()` even when `savedLog.date` is `'2026-11-10'`.
- [ ] **Step 2: Run and see them fail:** `npx vitest run src/features/logs/components/__tests__/LedgerRecognitionPanel.spokenAnswer.test.tsx src/features/logs/services/__tests__/dfesQuestionApi.localDate.test.ts` → FAIL.
- [ ] **Step 3: Implement** the three changes above.
- [ ] **Step 4: Run them plus `dfesQuestionEngine.test.ts` and `LedgerRecognitionPanel.test.tsx`** → PASS.
- [ ] **Step 5: Commit** `fix(dfes): keep spoken answers and count one question per IST day`.

### Task 2: Read the Schedule Maker's published schedule (cards, look lines, sources)

**Files:**
- Create: `sync-contract/schedules/README.md` (the contract: link to `DFES-NEEDS-FROM-THE-SCHEDULE-2026-11-21.md`, field list) and `sync-contract/schedules/grapes-fruit-pruning.fixture.json` (the Schedule Maker's early 15-day slice, copied as delivered; the full season replaces it when the Schedule Maker publishes)
- Create: `src/clients/mobile-web/src/domain/schedule/scheduleCards.ts`
- Modify: `src/apps/ShramSafal/ShramSafal.Infrastructure/ShramSafal.Infrastructure.csproj` (embed `sync-contract/schedules/*.json`, `LogicalName` `Schedules.<file>`)
- Create: `src/apps/ShramSafal/ShramSafal.Infrastructure/AI/Dfes/ScheduleCardLibrary.cs`
- Test: `src/clients/mobile-web/src/domain/schedule/__tests__/scheduleCards.test.ts`, `src/tests/ShramSafal.Domain.Tests/AI/Dfes/ScheduleCardLibraryTests.cs`

**Interfaces:**
- Produces (TS), shapes exactly as the contract: `interface SourceRef { docId: string; page: string }`; `interface LookLine { id: string; when: string; where: string; looksLike: string; count?: { what: string; unit: string; sampleSize: number; outOf?: number }; threshold?: string; ifThen?: { if: string; then: string }[]; askFarmer: string; photo?: { shoot: string; confirms: string; minimumSample: number }; sources: SourceRef[]; ourChoice?: boolean }`; `interface ScheduleCard { id: string; varieties: string[]; n0: number; n1: number; type: 'once'|'daily'|'conditional'; category: string; products: { name: string; aliasesMr: string[]; aliasesEn: string[]; dose?: string; per?: string; carrierWaterL?: number }[]; part?: string; look: LookLine[]; sources: SourceRef[] }`; `interface StageBand { code: string; nameMr: string; nameEn: string; dayFrom: number; dayTo: number; sources: SourceRef[] }`; `loadSchedule(crop: string, season: string): { stages: StageBand[]; cards: ScheduleCard[] } | null`; `sourcedLookLinesForDay(schedule, dayNumber: number, variety?: string): { card: ScheduleCard; line: LookLine }[]` (drops `ourChoice` lines and lines with no source); `lineById(schedule, id: string): LookLine | undefined`.
- Produces (C#): `ScheduleCardLibrary.SourcedLookLinesForDay(string crop, string season, int dayNumber, string? variety)`, `ScheduleCardLibrary.TryGetLine(string id, out LookLine line)`.

- [ ] **Step 1: Get the fixture.** Take the Schedule Maker's 15-day slice in the agreed shape (ask that session if it is not delivered yet; until then this task waits — do not author schedule content in this lane).
- [ ] **Step 2: Write the failing tests** (both sides read the same file): every `sourcedLookLinesForDay` result has `sources.length >= 1` and no `ourChoice`; an `ourChoice` line in the fixture is never returned; day 12 returns only lines whose card window contains 12; a variety the card does not list is excluded; card ids are unique; `textMr`-type fields contain no Latin letters except product names.
- [ ] **Step 3: Run and see them fail;** implement the loaders; run → PASS (`npx vitest run src/domain/schedule`; `dotnet test src/tests/ShramSafal.Domain.Tests --filter FullyQualifiedName~ScheduleCardLibraryTests`).
- [ ] **Step 4: Commit** `feat(dfes): read Shram Safal's own schedule cards, never the PDFs`.

### Task 3: Richer question events, source gate, one per person (server + migration)

**Files:**
- Modify: `src/apps/ShramSafal/ShramSafal.Domain/Dfes/QuestionEvent.cs`, `src/apps/ShramSafal/ShramSafal.Infrastructure/Persistence/Configurations/QuestionEventConfiguration.cs`
- Create: `src/apps/ShramSafal/ShramSafal.Domain/Dfes/QuestionPhotoCheck.cs` + configuration
- Create: migration `AddDfesQuestionContext` (via `dotnet ef migrations add AddDfesQuestionContext --context ShramSafalDbContext -c Release`)
- Modify: `RecordQuestionEventCommand.cs`, `RecordQuestionEventHandler.cs:53-59`, `DfesQuestionEndpoints.cs:18`, `GetRecentQuestionEventsHandler.cs` (filter by caller)
- Test: `src/tests/ShramSafal.Domain.Tests/Dfes/RecordQuestionEventSourceGateTests.cs`; real-PG `src/tests/ShramSafal.Sync.IntegrationTests/Dfes/QuestionEventContextRealPostgresTests.cs`

**Interfaces:**
- Produces: command gains optional trailing params `string? PromptText = null, string? PromptOrigin = null, string? QuestionKind = null, IReadOnlyList<SourceRefDto>? SourceRefs = null, string? ScheduleCardRef = null, string? DeviationReasonCode = null, string? DeviationChallenge = null, Guid? PhotoAttachmentId = null`; `QuestionEvent.AskedUserId` set from `CallerUserId` (never from the body); `QuestionKinds.StatesAgronomy(string kind): bool` true for `stage_look|safety|weather|photo_check`; `QuestionPhotoCheck.Create(questionEventId, attachmentId, statedCount?, readCount?, verdict, model, readAtUtc)` with verdict ∈ `matches|does_not_match|unclear|not_enough`.

- [ ] **Step 1: Write the failing tests**
  - an old-phone body (`agronomistApproved: true`, `marathiApproved: true`, no new fields) is accepted (P11);
  - `agronomistApproved: false`, kind `stage_open`, no sources → accepted;
  - kind `stage_look` with empty `SourceRefs` → `InvalidCommand`; with one source → accepted and `source_refs` stored;
  - `PromptOrigin` `pattern` or `bank` with `MarathiApproved: false` → `InvalidCommand`; `ai` with `MarathiApproved: false` → accepted;
  - `AskedUserId == CallerUserId` even if the body names another user;
  - recent events for caller A exclude caller B's rows on the same farm.
- [ ] **Step 2: Run and see them fail.**
- [ ] **Step 3: Implement** domain fields, configuration (snake_case columns listed in Change Surface, `jsonb` for `source_refs` and photo detail), the migration, the handler gate (replaces the `AgronomistApproved` check; keep `agronomist_approved` stored as sent), the caller filter.
- [ ] **Step 4: Real-Postgres test on `:55700`**: migrate a fresh database, insert a question event with every new column as the application role, assert UPDATE/DELETE still denied on both tables. Drop the databases after.
- [ ] **Step 5: Run** `dotnet test src/tests/ShramSafal.Domain.Tests` and `src/tests/AgriSync.ArchitectureTests` → PASS; migration file contains only `AddColumn`/`CreateTable`/grant SQL (no drop, no rename).
- [ ] **Step 6: Commit** `feat(dfes): question events keep words, sources and who was asked`.

### Task 4: Phone sends the new fields; source gate replaces the agronomist gate

**Files:**
- Modify: `src/clients/mobile-web/src/features/logs/services/dfesQuestionBank.ts` (add `kind: QuestionKind` and optional `sourceIds?: string[]` per entry; the four inert entries keep `agronomistApproved:false` until Task 6 gives them sources)
- Modify: `src/clients/mobile-web/src/features/logs/services/dfesQuestionEngine.ts:140-170` (`SelectedQuestion` and `approved`)
- Modify: `src/clients/mobile-web/src/features/logs/services/dfesQuestionApi.ts:46-79`
- Test: `src/clients/mobile-web/src/features/logs/services/__tests__/dfesQuestionEngine.sourceGate.test.ts`, `dfesQuestionApi.body.test.ts`

**Interfaces:**
- Consumes: `lineById` (Task 2, from the schedule cards).
- Produces: `type QuestionKind = 'stage_open'|'stage_look'|'why_not'|'gap'|'followup'|'learning'|'safety'|'weather'|'photo_check'`; `SelectedQuestion` gains `kind: QuestionKind; promptOrigin: 'bank'|'pattern'|'ai'; sourceRefs: SourceRef[]; scheduleCardRef: string | null`; `QuestionOutcome` gains `deviationReasonCode?: string|null; deviationChallenge?: string|null; photoAttachmentId?: string|null`; `isAllowed(q: DfesQuestion, sourceRefs: SourceRef[]): boolean` = `q.marathiApproved && (!statesAgronomy(q.kind) || sourceRefs.length > 0)`.

- [ ] **Step 1: Failing tests:** a `stage_look` entry with no resolvable sources is never selected; with a source it is selected even though `agronomistApproved` is false; `recordQuestionEvent` body carries `promptText === selected.resolvedPromptMr`, `promptOrigin`, `questionKind`, `sourceRefs`, `scheduleCardRef`, and the three outcome fields.
- [ ] **Step 2: Run, fail; implement; run** with the existing `dfesQuestionEngine*.test.ts` and `dfesQuestionBank.test.ts` → PASS (update only the assertions that named the agronomist gate, and say so in the commit body).
- [ ] **Step 3: Commit** `feat(dfes): a cited source, not an agronomist flag, lets a question through`.

### Task 5: The appreciation line (patterns)

**Files:**
- Create: `src/clients/mobile-web/src/domain/dfes/appreciation.ts`, `src/clients/mobile-web/src/domain/dfes/sathiPatterns.ts`
- Modify: `src/clients/mobile-web/src/features/logs/components/MeterDisplay.tsx:118-170` (render the line above the question on the `sathi` look; render it alone when there is no question)
- Test: `src/clients/mobile-web/src/domain/dfes/__tests__/appreciation.test.ts`

**Interfaces:**
- Produces: `interface AppreciationLine { textMr: string; textEn: string; namedItems: string[]; plannedNames: string[] }`; `buildAppreciation(record: Pick<AgriLogResponse,'cropActivities'|'inputs'|'irrigation'|'labour'|'machinery'|'activityExpenses'>): AppreciationLine | null` — names in record order: work types/titles (skipping `plannedOnly`), input product names exactly as stored, water hours, labour counts by kind, machine and hours, expense amounts; `plannedOnly` titles go to `plannedNames`; `null` when nothing was logged. Pattern strings live in `sathiPatterns.ts` with `marathiApproved: false` until the founder ticks them (Task 10).

- [ ] **Step 1: Failing test with the founder's real 2026-11-20 23:08 record** (copy the stored answer used in `PlrAiParseFixTests.cs`, with weeding tagged `plannedOnly`): `namedItems` contains `घड बांधणी`, `शेंडा`, `कराटे`, `कॉर्नफिल्ड`, `2-19-19-19`, `Calcium Nitrate`, `2 तास`, `8 बायका`, `2 गडी`, `4 तास`, `₹500`; `plannedNames` equals `['खुरपणी']`; `textMr` contains none of the blacklist words and no Latin letters except product names he said; a record with only the weeding row → `namedItems` empty, `plannedNames` `['खुरपणी']`.
- [ ] **Step 2: Run, fail; implement; run → PASS.**
- [ ] **Step 3: Commit** `feat(dfes): Sathi names each piece of work he logged`.

### Task 6: Stage question producer

**Files:**
- Create: `src/clients/mobile-web/src/features/logs/services/dfesStageQuestion.ts`
- Modify: `dfesQuestionBank.ts` (entries `stage.look` kind `stage_look`, `stage.open` kind `stage_open`), `dfesQuestionEngine.ts` (P3 tier uses the producer), `LedgerRecognitionPanel.tsx:243-267` (pass the context)
- Test: `src/clients/mobile-web/src/features/logs/services/__tests__/dfesStageQuestion.test.ts`

**Interfaces:**
- Consumes: `scheduleTemplateForPlot`, `calculateDayNumber` (`features/scheduler/planning/ClientPlanEngine.ts:110,77`), `loadSchedule`, `sourcedLookLinesForDay` (Task 2).
- Produces: `interface StageQuestionContext { kind: 'stage_look'|'stage_open'; dayNumber: number | null; lines: { card: ScheduleCard; line: LookLine }[] }`; `computeStageQuestion(plot, todayLocalDate: string): StageQuestionContext` — `stage_look` only when the plot's template is the grape fruit-pruning schedule and it has a reference date and `sourcedLookLinesForDay` returns ≥ 1 line; otherwise `stage_open`.

- [ ] **Step 1: Failing tests:** pruning reference `2026-10-15`, today `2026-10-26` (day 12) → `stage_look` with the day-12 lines and their sources; no reference date → `stage_open`, `lines: []`; a non-grape template → `stage_open`; a log saved for `2026-10-20` while today is `2026-10-26` still uses day 12 (today), never day 6.
- [ ] **Step 2: Run, fail; implement; run with engine tests → PASS.**
- [ ] **Step 3: Commit** `feat(dfes): a stage question from the plot's schedule and cited lines`.

### Task 7: "Why wasn't this done?" producer and answer UI

**Files:**
- Create: `src/clients/mobile-web/src/features/logs/services/dfesWhyNot.ts`, `src/clients/mobile-web/src/features/logs/components/WhyNotAnswer.tsx`
- Modify: `dfesQuestionBank.ts` (entry `schedule.why_not`, kind `why_not`, priority tier 4 replacing `schedule.category_planned_not_done`), `dfesQuestionEngine.ts`, `MeterQuestionHost.tsx` (route the tap reasons and the past-day action)
- Test: `src/clients/mobile-web/src/features/logs/services/__tests__/dfesWhyNot.test.ts`, `src/clients/mobile-web/src/features/logs/components/__tests__/WhyNotAnswer.test.tsx`

**Interfaces:**
- Consumes: `derivePlannedItemsForDay`, `getExecutionCountByCategory` (as used in `dfesScheduleWindow.ts:89-130`), `holdsAuthority(farm, AUTHORITY.planWork)` (`core/session/farmAuthorities.ts:76`).
- Produces: `interface MissedCard { cardRef: string; category: string; dayNumber: number; dateKey: string; nameMr: string }`; `findMissedCard(input: { template; referenceDate: string; logs: DailyLog[]; todayLocalDate: string; askedCardRefs: Set<string>; canPlan: boolean }): MissedCard | null` — uses the schedule card (`type: 'once'`, window closes after `n1`) when the plot follows a published Shram Safal schedule, otherwise today's one-time expectations (window closes at `targetDayFromRef + (toleranceDays ?? 0)`); periodic expectations never; category-level match; `cardRef = '<templateId>:<operationTypeId>:<targetDayFromRef>'`.
- `WhyNotAnswer` props: `{ card: MissedCard; onReason(code: WhyNotReason, challenge: string | null): void; onDidItNotLogged(dateKey: string): void; onSpeak(): void }`; `type WhyNotReason = 'rain'|'input_unavailable'|'labour_unavailable'|'money_short'|'time_forgot'|'advised_otherwise'|'done_not_logged'|'other'` mapped 1:1 to the eight founder labels.

- [ ] **Step 1: Failing tests:** window still open (today ≤ target + tolerance) → `null`; passed with no matching log → card; passed with a matching-category log inside the window → `null`; `askedCardRefs` has it → `null`; `canPlan: false` → `null`; a periodic expectation → `null`. UI: eight buttons with the exact labels, a big mic, an optional अडचण text box; tapping "केलं, पण नोंद केली नाही" calls `onDidItNotLogged(card.dateKey)` and records reason `done_not_logged`.
- [ ] **Step 2: Run, fail; implement;** wire `onDidItNotLogged` to the existing past-day flow: `onSpeak({ purpose: 'addToDay', context: { date: dateKey } })` (as `ReflectPage.tsx:323-326`).
- [ ] **Step 3: Run → PASS. Commit** `feat(dfes): ask once why a passed schedule task was not done`.

### Task 8: AI writer (server) with guard, and the phone's text source

**Files:**
- Create: `src/apps/ShramSafal/ShramSafal.Application/UseCases/Dfes/WriteSathiLine/{WriteSathiLineCommand,WriteSathiLineHandler,SathiLineGuard}.cs`, port `ShramSafal.Application/Ports/External/ISathiLineWriter.cs`
- Create: `src/apps/ShramSafal/ShramSafal.Infrastructure/AI/Dfes/SathiLineWriter.cs`, prompt `src/apps/ShramSafal/ShramSafal.Infrastructure/AI/Prompts/dfes/sathiLine.v1.md`
- Modify: `DfesQuestionEndpoints.cs` (route `POST /shramsafal/dfes/sathi-line`), DI registration
- Create: `src/clients/mobile-web/src/features/logs/hooks/useSathiLine.ts`; modify `MeterDisplay.tsx` text source
- Create: golden set `src/tests/ai-eval/sathi-line/cases/*.json` (≥ 20) + runner `src/tests/ai-eval/sathi-line/sathiLine.golden.test.ts` (skips unless `SATHI_GOLDEN=1`)
- Test: `src/tests/ShramSafal.Domain.Tests/Dfes/SathiLineGuardTests.cs`, `WriteSathiLineHandlerTests.cs`; phone `useSathiLine.test.ts`

**Interfaces:**
- Consumes: `ScheduleCardLibrary` (Task 2); the saved log's stored parse (`ai_jobs.normalized_result_json` by `aiJobId`, or the daily log content for a typed log).
- Produces: request `{ farmId, plotId, aiJobId?: string, dailyLogId?: string, question: { kind, questionKey, sourceIds: string[], scheduleCardRef?: string } | null }` → response `{ appreciationMr: string | null, questionMr: string | null, origin: 'ai', model: string }` or `204` when the guard drops both; `ISathiLineWriter.WriteAsync(SathiLineContext ctx, CancellationToken) : Task<SathiLineDraft>`; `SathiLineGuard.Check(SathiLineDraft draft, SathiLineContext ctx) : GuardResult { bool AppreciationOk; bool QuestionOk; IReadOnlyList<string> Reasons }`.
- Guard rules (each a test): Devanagari only except product names present in the record; every product name, number and work named appears in the record or in a used cited line; no blacklist word; no advice verb (`फवारा`, `टाका`, `द्या`, `करा` as imperatives) unless copied from a used cited line; question ≤ 160 chars, appreciation ≤ 220 chars; exactly one `?` in the question; never the words AI/एआय/मशीन/robot.
- Phone `useSathiLine(args): { appreciationMr?: string; questionMr?: string }` — starts when the parse result arrives; results later than 2 000 ms after the Sathi card mounts are ignored for display.

- [ ] **Step 1: Failing guard tests** using the founder's real record: a draft naming "Confidor" → `QuestionOk/AppreciationOk` false (he said कॉर्नफिल्ड); a draft with "शाब्बास" → false; a draft naming every logged work and asking "आज घडांवर काय दिसलं?" → true; an English sentence in Marathi mode → false.
- [ ] **Step 2: Failing handler tests** with a fake `ISathiLineWriter`: guard-pass → 200 with the text; guard-fail → 204; writer throws → 204 within the request, never 500.
- [ ] **Step 3: Implement** handler, guard, endpoint, writer (same provider resolution as the voice structurer; Sarvam via `SarvamChatClient.CompleteAsync`, Gemini via a configured text model id), prompt file (rules mirror the guard; cites only the passed lines).
- [ ] **Step 4: Phone hook test:** a response at 1 500 ms replaces the pattern text; at 2 500 ms it does not.
- [ ] **Step 5: Golden set:** 20+ cases (include the founder's 23:08 and 22:56 logs, a typed log, a log with only a future task, a labour-only log, a log with two sprays in one tank); run on the test stack with `SATHI_GOLDEN=1` against **Sarvam 105B** and against the **current Gemini GA id**; record pass counts per model in the notes folder; add the registry row `| DfesQuestionWriter | v1.0 | AI/Prompts/dfes/sathiLine.v1.md + SathiLineGuard | <date> | golden: Sarvam X/N, Gemini Y/N | new prompt; phone picks the question, the writer only words it |` to `_COFOUNDER/memory/prompt-registry.md` (hand the row to the CTO if the write hook refuses the base checkout).
- [ ] **Step 6: Run all → PASS. Commit** `feat(dfes): server writes Sathi's line behind a guard, patterns as fallback`.

### Task 9: Observation photo proof and its check

**Files:**
- Modify: `MeterDisplay.tsx` / `MeterQuestionHost.tsx` (optional "फोटो काढा" on kinds `followup` and `stage_look` whose look line has a `photo` field), using `captureAttachment` (`application/use-cases/CaptureAttachment.ts:133`) linked to the DailyLog
- Create: server port `IObservationPhotoReader`, `Infrastructure/AI/Dfes/GeminiObservationPhotoReader.cs` (config `Gemini:PhotoCheckModelId`), `UseCases/Dfes/CheckObservationPhoto/*`, read route `GET /shramsafal/question-events/{id}/photo-check`
- Create: phone `features/logs/services/photoCheckApi.ts` and the verdict line
- Test: `src/tests/ShramSafal.Domain.Tests/Dfes/PhotoVerdictRuleTests.cs`, `CheckObservationPhotoHandlerTests.cs`; phone `photoCheck.test.tsx`

**Interfaces:**
- Produces: `PhotoVerdictRule.Decide(int? statedCount, int? statedOutOf, int? readCount, double confidence, bool coversStatedSample) : PhotoVerdict` with `matches|does_not_match|unclear|not_enough`; Marathi labels fixed (Global Constraints).

- [ ] **Step 1: Failing rule tests:** confidence < 0.7 → `unclear`; `coversStatedSample: false` (one cane in the photo, he said 10) → `not_enough`; read 7 of 10 vs stated 7 of 10 → `matches`; read 3 of 10 vs stated 7 of 10 with confidence ≥ 0.7 and full sample → `does_not_match`.
- [ ] **Step 2: Failing handler tests** with a fake reader: one `question_photo_checks` row written per photo; the answer row is never updated; reader failure → no row, nothing shown.
- [ ] **Step 3: Implement;** the phone shows the verdict line at once when it arrives (D-E) and "फोटो ठेवला" until then.
- [ ] **Step 4: Accuracy test** on real photos when the founder supplies them (target ≥ 50): record per-verdict agreement with a human count in the notes folder; report to the founder.
- [ ] **Step 5: Run → PASS. Commit** `feat(dfes): optional photo proof of an observation, checked and shown`.

### Task 10: Founder picture page, full verification, push

**Files:**
- Create: approval page under the existing approval-page tooling (`build\shoot.cjs` + `build.cjs`, served on `http://localhost:3060`): every pattern string a farmer can see, plus real screen pictures of the Sathi card (appreciation + stage question, why-not with reasons, photo verdict), BEFORE/AFTER labelled, auto-saved ticks.

- [ ] **Step 1:** Build the page; after the founder ticks, flip `marathiApproved` on exactly the ticked strings (one commit).
- [ ] **Step 2: Verify:** `dotnet build src/AgriSync.Bootstrapper` (0 errors); `dotnet test src/tests/AgriSync.ArchitectureTests` (all pass); `dotnet test src/tests/ShramSafal.Domain.Tests` (all pass, report count vs 4626 baseline); real-PG test from Task 3 on `:55700`; phone `npx tsc --noEmit` (no error in touched files) and scoped `npx vitest run` for every touched folder; `node scripts/check-file-sizes.mjs` (no new offender).
- [ ] **Step 3:** Push `task/plr-d10-dfes-questions`; send the CTO session the head SHA, the migration name, the golden-set numbers per model and the open items.
- [ ] **Step 4: Founder Acceptance Gate** — `[ ]` founder checks on 4–5 real phones (owner, mukadam, worker): appreciation names his work, one question per person, why-not only for the owner, photo verdict shows. Not deployed by this lane.
