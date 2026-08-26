# Shram Sathi Follow-up System — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Shram Sathi ask the right farmer one natural question about the right work, exactly once, without pretending, repeating, or corrupting the farm's future memory.

**Architecture:** Six founder rulings extend three existing mechanisms — the question engine (client, pure), the lens extractor (server, scoring), and the question-events table (server, append-only). No new subsystem, no parallel question history, no new AI provider. One score-engine version bump (`dfes-3` → `dfes-4`) carries every scoring change so historical days keep their stamp.

**Tech Stack:** React 19 + TypeScript + Vite + Dexie · .NET 10 / EF Core / PostgreSQL 16 (`ssf` schema, FORCE-RLS) · Vitest 4 · xUnit + FluentAssertions

**Spec:** `docs/superpowers/specs/2026-08-15-shram-sathi-followup-system-design.md`

---

## Global Constraints

- **Doctrine P4 — never fabricate.** "आठवत नाही" never becomes zero. An approximate value never silently becomes exact. No default fills a bucket the farmer did not fill.
- **Doctrine P8 — provenance survives.** Certainty is a *different axis* from provenance; never overload `FieldProvenance` (`'spoken' | 'confirmed' | 'derived' | 'assumed'`) to carry it.
- **One question per day.** `MAX_QUESTIONS_PER_DAY = 1` (`dfesQuestionBank.ts:30`) is structural, not tunable. Per-log scoping must NOT relax it.
- **Per-log exclusion is permanent**, never a longer cooldown. No time component.
- **Score-engine version:** every scoring change in this plan bumps `DfesTuning.ScoreEngineVersion` to `"dfes-4"` exactly once (Task 3), and historical rows keep `dfes-3`.
- **The weather change must live in the extractor roster, never in `DayUnderstandingScore`.** A read-time exclusion rescores every historical day the instant the API deploys — the exact thing the ruling forbids.
- **Farmer-facing Marathi:** no "नोंद" (scope per Gate D). Never `system-ui`/`Arial`. Body `'Noto Sans Devanagari', sans-serif`, headings `'Noto Serif Devanagari', serif`, numerals `'DM Sans', sans-serif`.
- **Approval gate:** all farmer-facing question copy needs `agronomistApproved && marathiApproved` or `approved()` (`dfesQuestionEngine.ts:97-99`) keeps it out of selection entirely.
- **Branch:** `feat/dfes-companion` only. Never push. Commits unsigned by design.
- **commit-msg hook:** body must carry `spec: shram-sathi-followup-system-2026-08-15 (task-N)`; subject ≤72 chars.
- **Stage by explicit path only.** Never `git add .` or `-A`. Pre-existing modified `.snap` files, untracked demo files under `src/clients/mobile-web/`, and ~30 LF→CRLF-churn files under `sync-contract/schemas/payloads-csharp/` must never be staged.

---

## Founder gates — these block specific tasks, not the whole plan

- [ ] **Gate A — reversing the 2026-08-13 soil-fertiliser decision.** On 2026-08-13 the founder was asked directly whether soil-applied fertiliser should still owe the water question and answered **yes, keep asking**. `DfesLensExtractor.cs:183-188` carries a comment forbidding the exact bypass Ruling 2 now requires. **Blocks Task 2.** On confirmation, Task 2 rewrites that comment citing the 2026-08-15 ruling.
- [ ] **Gate B — numeric certainty on the voice path.** A farmer marking a dose "approximate" on the *voice confirm* screen has **no route to the server today**: `manualDraft` is sent only when `provenance.source === 'manual'` (`logSyncMutationService.ts:175-178`), and `AiJob.NormalizedResultJson` is written once at parse and never updated by a confirm. Closing it means the AI must emit certainty at parse time → **AI prompt change + prompt-registry version bump + golden-set delta** (CLAUDE.md Definition of Done). **Blocks Task 7 only.** Tasks 1–6 and 8–10 proceed either way.
- [ ] **Gate C — tightening the observation bar lowers some scores.** Ruling 6 withholds the OBSERVATION bucket from filler. The same test feeds `RichnessStamper` reward points, so a terse-but-real observer loses points too. Two of the founder's three filler examples (`"काही नाही"`, `"सगळं बरोबर"`) already pass today's bar; only `"ठीक आहे"` fails, and only by character count. This pulls against "adoption before accuracy" (2026-08-13). **Blocks Task 9.**
- [ ] **Gate D — "नोंद" sweep scope.** 64 farmer-facing occurrences across 24 files. **(a)** Sathi's surfaces only (~12) · **(b)** all 64 including 9 legally-tagged strings and the founder-verbatim `noWorkDayAcknowledged` · **(c)** all except those two protected groups (~50). **Blocks Task 11.**
- [ ] **Gate E — two Marathi strings the founder owes.** `"नोंद पाहा"` (view the record — he is looking, not speaking) and the referral invite. **Blocks Task 11 completion only.**

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `ShramSafal.Application/.../GetRecentQuestionEvents/RecentQuestionEventDto.cs` | wire DTO for recent question events | add `Guid? dailyLogId` |
| `ShramSafal.Application/.../GetRecentQuestionEvents/GetRecentQuestionEventsHandler.cs` | projects entities → DTO | project `r.DailyLogId` |
| `mobile-web/.../services/dfesQuestionApi.ts` | fetch + POST question events | carry `dailyLogId` both directions |
| `mobile-web/.../services/dfesQuestionEngine.ts` | pure question selection | per-log exclusion; confidence gate; `sourceLogId` |
| `mobile-web/.../components/MeterQuestionHost.tsx` | hosts the question card | send `dailyLogId` on all three outcomes |
| `mobile-web/.../components/LedgerRecognitionPanel.tsx` | builds `DailyQuestionInputs` | add `sourceLogId`, `todayWork`, `parseConfidence` |
| `ShramSafal.Application/.../CreateDailyLog/DfesLensExtractor.cs` | the scoring roster | five work shapes; weather owed-ness; anchoring |
| `ShramSafal.Domain/Dfes/WorkShape.cs` | the five information shapes | **create** |
| `ShramSafal.Domain/Dfes/ObservationAnchor.cs` | anchored-vs-filler test | **create** |
| `ShramSafal.Domain/Dfes/DfesTuning.cs` | tuning constants | `dfes-3` → `dfes-4` |
| `ShramSafal.Application/Ports/IShramSafalRepository.cs` | repository port | add `GetWeatherStampsForDailyLogsAsync` |
| `ShramSafal.Infrastructure/.../ShramSafalRepository.cs` | EF implementation | implement the weather read |
| `ShramSafal.Application/.../CreateDailyLog/DailyRichnessDerivationService.cs` | recompute orchestration | load weather; historical-version guard |
| `mobile-web/src/domain/types/log.types.ts` | client domain types | `NumericFact` / `NumericFacts` |
| `mobile-web/src/domain/ai/contracts/AgriLogResponseSchema.ts` | AI response contract | declare `numbers` on 6 nested schemas |
| `ShramSafal.Application/.../CreateDailyLog/ManualDraftNormalizer.cs` | manual draft → wire shape | allow-list `numbers` |
| `ShramSafal.Domain/Farms/ApplicationInputItem.cs` + 3 siblings | typed ledger children | nullable certainty columns |
| `mobile-web/src/i18n/translations.ts` | central Marathi strings | नोंद sweep (Gate D) |

---

## Task 1: The app tells the server which log a question was about

**Files:**
- Modify: `src/apps/ShramSafal/ShramSafal.Application/UseCases/Dfes/GetRecentQuestionEvents/RecentQuestionEventDto.cs:4-6`
- Modify: `src/apps/ShramSafal/ShramSafal.Application/UseCases/Dfes/GetRecentQuestionEvents/GetRecentQuestionEventsHandler.cs:24-27`
- Modify: `src/clients/mobile-web/src/features/logs/services/dfesQuestionApi.ts:30-37, 75-88`
- Modify: `src/clients/mobile-web/src/features/logs/components/MeterQuestionHost.tsx:61-74`
- Modify: `src/clients/mobile-web/src/features/logs/components/LedgerRecognitionPanel.tsx:190-202`
- Test: `src/clients/mobile-web/src/features/logs/services/__tests__/dfesQuestionApi.test.ts`
- Test: `src/tests/ShramSafal.Domain.Tests/Dfes/GetRecentQuestionEventsHandlerTests.cs`

**Interfaces:**
- Produces: `RecentQuestionEvent.dailyLogId: string | null` and `DailyQuestionInputs.sourceLogId?: string`, both consumed by Task 2.

**Why this is first:** `ssf.question_events.daily_log_id` exists and is indexed (`QuestionEventConfiguration.cs:48`), but **the client has never populated it** — every row ever written is NULL — and the server never returns it. Per-log dedupe is impossible until both ends carry it. **No Dexie bump, no DB migration.**

- [ ] **Step 1: Write the failing client test**

```ts
// dfesQuestionApi.test.ts
it('carries dailyLogId from the server DTO into the engine event', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify([
        { questionKey: 'gap.dose', triggerType: 'Gap', shownAtUtc: null,
          createdAtUtc: '2026-08-15T04:00:00Z', stageConfirmed: null, skipped: false,
          dailyLogId: 'log-abc' },
    ])));
    const events = await fetchRecentQuestionEvents('farm-1');
    expect(events[0].dailyLogId).toBe('log-abc');
});

it('sends dailyLogId when recording an outcome', async () => {
    const spy = vi.mocked(fetch).mockResolvedValueOnce(new Response('{}'));
    await recordQuestionEvent('farm-1', 'plot-1', selected, { skipped: false, dailyLogId: 'log-abc' }, '2026-08-15T04:00:00Z');
    const body = JSON.parse((spy.mock.calls[0][1] as RequestInit).body as string);
    expect(body.dailyLogId).toBe('log-abc');
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd src/clients/mobile-web && npx vitest run src/features/logs/services/__tests__/dfesQuestionApi.test.ts`
Expected: FAIL — `dailyLogId` is `undefined` on the mapped event.

- [ ] **Step 3: Add the field on the server**

```csharp
// RecentQuestionEventDto.cs
public sealed record RecentQuestionEventDto(
    string questionKey, string triggerType, DateTime? shownAtUtc,
    DateTime createdAtUtc, bool? stageConfirmed, bool? skipped,
    Guid? dailyLogId);
```

```csharp
// GetRecentQuestionEventsHandler.cs:24-27
var dtos = rows
    .Select(r => new RecentQuestionEventDto(
        r.QuestionKey, r.TriggerType, r.ShownAtUtc, r.CreatedAtUtc, r.StageConfirmed, r.Skipped,
        r.DailyLogId))
    .ToList();
```

- [ ] **Step 4: Carry it on the client**

```ts
// dfesQuestionApi.ts:30-37
export interface RecentQuestionEventDto {
    questionKey: string;
    triggerType: string;
    shownAtUtc: string | null;
    createdAtUtc: string;
    stageConfirmed: boolean | null;
    skipped: boolean | null;
    dailyLogId: string | null;
}
```

```ts
// dfesQuestionApi.ts:82-87 — inside the .map()
return dtos.map(d => ({
    questionKey: d.questionKey,
    createdAtLocalDate: d.createdAtUtc.slice(0, 10),
    ageDays: Math.floor((now - Date.parse(d.createdAtUtc)) / 86_400_000),
    skipped: d.skipped ?? false,
    dailyLogId: d.dailyLogId ?? null,
}));
```

```ts
// dfesQuestionEngine.ts:35-42 — declare REQUIRED-but-nullable so the compiler
// surfaces every construction site rather than silently defaulting.
export interface RecentQuestionEvent {
    questionKey: string;
    createdAtLocalDate: string;
    ageDays: number;
    skipped: boolean;
    /** ssf.question_events.daily_log_id — null on every row written before this change. */
    dailyLogId: string | null;
}
```

- [ ] **Step 5: Populate it at the one place that knows the log**

```tsx
// LedgerRecognitionPanel.tsx — inside the questionInputs object at :190-202
sourceLogId: savedLog?.id,
```

```tsx
// MeterQuestionHost.tsx — all three outcome calls carry the log id
const sourceLogId = questionInputs.sourceLogId;
const handleAnswer = (option: DfesAnswerOption) => {
    void recordOutcome({ skipped: false, response: option.value,
        stageConfirmed: option.stageConfirmedValue ?? null, dailyLogId: sourceLogId ?? null });
};
// onQuestionInteract → recordOutcome({ skipped: false, dailyLogId: sourceLogId ?? null })
// onDismiss        → recordOutcome({ skipped: true,  dailyLogId: sourceLogId ?? null })
```

```ts
// dfesQuestionEngine.ts:61-83 — add to DailyQuestionInputs
/** The DailyLog this question is about — the per-log dedupe key (Ruling 1). */
sourceLogId?: string;
```

- [ ] **Step 6: Fix every broken fixture**

`dailyLogId` is required-nullable, so these fail to compile until updated — that is the point:
`dfesQuestionEngine.test.ts` (lines 23, 74, 296, 311, 316, 345, 352), `dfesQuestionApi.test.ts:20-30`,
`GetRecentQuestionEventsHandlerTests.cs`.

- [ ] **Step 7: Run both suites**

Run: `cd src/clients/mobile-web && npx vitest run src/features/logs/`
Run: `dotnet test src/tests/ShramSafal.Domain.Tests/ --filter FullyQualifiedName~GetRecentQuestionEvents`
Expected: PASS both.

- [ ] **Step 8: Commit**

```bash
git add src/apps/ShramSafal/ShramSafal.Application/UseCases/Dfes/GetRecentQuestionEvents src/clients/mobile-web/src/features/logs/services/dfesQuestionApi.ts src/clients/mobile-web/src/features/logs/services/dfesQuestionEngine.ts src/clients/mobile-web/src/features/logs/components/MeterQuestionHost.tsx src/clients/mobile-web/src/features/logs/components/LedgerRecognitionPanel.tsx
git commit -F - <<'EOF'
feat(dfes): tell the server which log each question was about

spec: shram-sathi-followup-system-2026-08-15 (task-1)
EOF
```

---

## Task 2: A question asked about one log is never asked about it again

**Files:**
- Modify: `src/clients/mobile-web/src/features/logs/services/dfesQuestionEngine.ts:101-113`
- Test: `src/clients/mobile-web/src/features/logs/services/__tests__/dfesQuestionEngine.test.ts`

**Interfaces:**
- Consumes: `RecentQuestionEvent.dailyLogId`, `DailyQuestionInputs.sourceLogId` (Task 1)
- Produces: `isPerLogScoped(q)`, `askedForLog(q, recent, sourceLogId)`, widened `eligible(q, recent, sourceLogId)`

**The scope rule uses existing bank metadata, not a new list.** `GAP_LENS` (`dfesQuestionBank.ts:95-99`) already maps `WHAT/DOSE/SCOPE/CARRIER/COST → 'Execution'` and `WEATHER/PURPOSE → 'Insight'`, `CONTINUITY → 'Learning'` — exactly Ruling 1's split.

- [ ] **Step 1: Write the failing tests (required tests 1 and 2)**

```ts
const gapDose = (o: Partial<RecentQuestionEvent> = {}): RecentQuestionEvent => ({
    questionKey: 'gap.dose', createdAtLocalDate: '2026-08-10', ageDays: 5,
    skipped: false, dailyLogId: null, ...o,
});

it('asks the dose question again for a DIFFERENT spray log', () => {
    const r = selectDailyQuestion(base({
        sourceLogId: 'log-wed',
        recentEvents: [gapDose({ dailyLogId: 'log-mon', ageDays: 2 })],
    }));
    expect(r?.questionKey).toBe('gap.dose');
});

it('never asks the dose question twice for the SAME log, however old', () => {
    const r = selectDailyQuestion(base({
        sourceLogId: 'log-mon',
        recentEvents: [gapDose({ dailyLogId: 'log-mon', ageDays: 400 })],
    }));
    expect(r?.questionKey).not.toBe('gap.dose');
});

it('falls back to the day cooldown when the old row has no log id', () => {
    const r = selectDailyQuestion(base({
        sourceLogId: 'log-wed',
        recentEvents: [gapDose({ dailyLogId: null, ageDays: 1 })],
    }));
    expect(r?.questionKey).not.toBe('gap.dose');
});

it('keeps day cooldowns for CONTEXT questions even across logs', () => {
    const r = selectDailyQuestion(base({
        sourceLogId: 'log-wed', score: undefined,
        recentEvents: [{ questionKey: 'learning.deepen_hypothesis', createdAtLocalDate: '2026-08-14',
                         ageDays: 1, skipped: false, dailyLogId: 'log-mon' }],
    }));
    expect(r?.questionKey).not.toBe('learning.deepen_hypothesis');
});
```

- [ ] **Step 2: Run and watch them fail**

Run: `cd src/clients/mobile-web && npx vitest run src/features/logs/services/__tests__/dfesQuestionEngine.test.ts`
Expected: FAIL — test 1 returns null (blocked by the 3-day gap cooldown); test 2 returns `gap.dose`.

- [ ] **Step 3: Implement**

```ts
/**
 * Ruling 1 (2026-08-15). Execution-gap questions dedupe per SOURCE LOG, permanently —
 * Monday's and Wednesday's spray logs may BOTH be asked for a dose. Context questions
 * (crop stage, previous observation, learning) keep day-based cooldowns, because they
 * build the relationship rather than repair one record.
 *
 * The split is read from bank metadata already present: GAP_LENS assigns
 * WHAT/DOSE/SCOPE/CARRIER/COST to 'Execution'. No new vocabulary.
 */
function isPerLogScoped(q: DfesQuestion): boolean {
    return q.triggerType === 'Gap' && q.lens === 'Execution';
}

/**
 * Already asked for THIS log — permanent, no time window. Ruling 1 says "the same log
 * must never receive the same question twice"; that has no time component, so this is
 * deliberately NOT expressed as an age comparison.
 *
 * Falls back to false when either side lacks a log id: every question_events row written
 * before Task 1 has daily_log_id NULL, and treating those as "asked for no log" would
 * unblock every gap question at once.
 */
function askedForLog(q: DfesQuestion, recent: RecentQuestionEvent[], sourceLogId?: string): boolean {
    if (!sourceLogId) return false;
    return recent.some(e => e.questionKey === q.questionKey && e.dailyLogId === sourceLogId);
}

function eligible(
    q: DfesQuestion | undefined,
    recent: RecentQuestionEvent[],
    sourceLogId?: string,
): q is DfesQuestion {
    if (!approved(q)) return false;
    if (isPerLogScoped(q)) {
        // Per-log questions: permanent exclusion for this log, and the day cooldown
        // still applies to rows that predate per-log tracking.
        if (askedForLog(q, recent, sourceLogId)) return false;
        const legacyOnly = recent.filter(e => e.dailyLogId === null);
        return !onCooldown(q, legacyOnly);
    }
    return !onCooldown(q, recent);
}
```

Then thread `inputs.sourceLogId` through all eight `eligible(...)` call sites (`:236, 242, 248, 255, 263, 270, 277, 284`).

- [ ] **Step 4: Run to verify they pass**

Run: `cd src/clients/mobile-web && npx vitest run src/features/logs/services/`
Expected: PASS — including every pre-existing engine test.

- [ ] **Step 5: Commit**

```bash
git add src/clients/mobile-web/src/features/logs/services/dfesQuestionEngine.ts src/clients/mobile-web/src/features/logs/services/__tests__/dfesQuestionEngine.test.ts
git commit -F - <<'EOF'
feat(dfes): dedupe execution questions per log, not per day

spec: shram-sathi-followup-system-2026-08-15 (task-2)
EOF
```

---

## Task 3: A retry can never write the same question twice

**Files:**
- Create: `src/apps/ShramSafal/ShramSafal.Infrastructure/Persistence/Migrations/<timestamp>_UniqueQuestionPerLog.cs`
- Modify: `src/apps/ShramSafal/ShramSafal.Application/UseCases/Dfes/RecordQuestionEvent/RecordQuestionEventHandler.cs:43-58`
- Test: `src/tests/ShramSafal.Sync.IntegrationTests/Dfes/QuestionEventIdempotencyTests.cs`

**Why a database guarantee and not just the selector:** `ssf.question_events` is append-only by privilege — `REVOKE UPDATE, DELETE` (`20260713052440_AddDfesDataSpine.cs:256`) — so an upsert is unavailable, and `useDfesQuestion.ts:75` resets its guard on failure, which is exactly the double-write window. Required test 2 demands this hold across retries.

- [ ] **Step 1: Write the failing integration test**

Follow the house idiom exactly: `[Trait("Category", "RequiresPostgres")]` on the class, and every fact opens with `if (SkippedForMissingPostgres()) { return; }` which prints `[SKIPPED] … NO DATABASE WAS EXERCISED` — a loud pass, never a silent skip. Model on `src/tests/ShramSafal.Sync.IntegrationTests/Dfes/AnswerRaisesScoreTests.cs`.

```csharp
[Fact]
public async Task Recording_the_same_question_for_the_same_log_twice_yields_one_row()
{
    if (SkippedForMissingPostgres()) { return; }

    var cmd = BuildCommand(questionKey: "gap.dose", dailyLogId: _logId);
    await Send(cmd);
    await Send(cmd);   // the retry

    var count = await CountAsync(
        "SELECT count(*) FROM ssf.question_events WHERE daily_log_id = @id AND question_key = 'gap.dose'",
        _logId);
    count.Should().Be(1);
}
```

- [ ] **Step 2: Run it and watch it fail**

Run: `dotnet test src/tests/ShramSafal.Sync.IntegrationTests/ --filter FullyQualifiedName~QuestionEventIdempotency`
Expected: FAIL — count is 2. **State the provisioning evidence** (`[PROVISIONED] ssf_…` line + elapsed time) or the run proves nothing.

- [ ] **Step 3: Add the partial unique index**

The predicate is required: every legacy row has `daily_log_id IS NULL` and must not be constrained.
**Do NOT recreate `ix_question_events_daily_log_id`** — it already exists (`20260713052440_AddDfesDataSpine.cs:184-188`).

```csharp
migrationBuilder.Sql("""
    CREATE UNIQUE INDEX ux_question_events_log_question
      ON ssf.question_events (daily_log_id, question_key)
      WHERE daily_log_id IS NOT NULL;
    """);
```

- [ ] **Step 4: Return the existing row on conflict**

```csharp
// RecordQuestionEventHandler.cs — before Guid.NewGuid()/AddQuestionEventAsync
// Ruling 1: "offline retries, reopening the app or syncing from another device must not
// create duplicate questions." The table is append-only by privilege (no UPDATE/DELETE),
// so an upsert is unavailable — check, then insert.
if (cmd.DailyLogId is { } logId)
{
    var existing = await repository.FindQuestionEventAsync(logId, cmd.QuestionKey, ct);
    if (existing is not null) return Result.Success(existing.Id);
}
```

- [ ] **Step 5: Re-run with provisioning evidence**

Run: `dotnet test src/tests/ShramSafal.Sync.IntegrationTests/ --filter FullyQualifiedName~QuestionEventIdempotency`
Expected: PASS, with a `[PROVISIONED]` line in the output.

- [ ] **Step 6: Commit**

```bash
git add src/apps/ShramSafal src/tests/ShramSafal.Sync.IntegrationTests/Dfes/QuestionEventIdempotencyTests.cs
git commit -F - <<'EOF'
fix(dfes): one question row per log, even across retries

spec: shram-sathi-followup-system-2026-08-15 (task-3)
EOF
```

---

## Task 4: Work is classified by the information it naturally produces

> 🛑 **BLOCKED ON GATE A.** This task reverses an explicit 2026-08-13 founder decision. Do not start until the founder has confirmed. On confirmation, this task MUST rewrite the comment at `DfesLensExtractor.cs:183-188` to cite the 2026-08-15 ruling — leaving it is how the next agent reverts this work.

**Files:**
- Create: `src/apps/ShramSafal/ShramSafal.Domain/Dfes/WorkShape.cs`
- Modify: `src/apps/ShramSafal/ShramSafal.Application/UseCases/Logs/CreateDailyLog/DfesLensExtractor.cs:183-256, 68-71`
- Modify: `src/clients/mobile-web/src/features/logs/services/scoreVlog.ts:279-296, 359-394`
- Test: `src/tests/ShramSafal.Domain.Tests/Dfes/DfesLensExtractorWorkShapeTests.cs`

**Interfaces:**
- Produces: `WorkShape` enum; `ClassifyWorkShape(roots, persisted)`; `OwedDose(shape, described)`; `OwedCarrier(shape, described)`

**The classifier runs ONCE over both root lists.** Computing per-list and unioning with `Best()` re-introduces the water obligation for dry fertiliser — see the trap below.

- [ ] **Step 1: Write the failing tests (required tests 3 and 4)**

```csharp
private const string DryFertiliserDay = """
{ "summary": "DAP ek poti takli", "dayOutcome": "WORK_RECORDED",
  "cropActivities": [ { "title": "Fertilizer DAP" } ],
  "inputs": [ { "id": "in-1", "method": "Soil", "productName": "DAP",
                "mix": [ { "id": "m-1", "productName": "DAP", "dose": 50, "unit": "kg" } ] } ],
  "irrigation": [], "labour": [], "machinery": [], "activityExpenses": [] }
""";

[Fact]
public void DryFertiliserDay_never_owes_water()
{
    var day = Run(DryFertiliserDay);
    Dim(day, "CARRIER").Applicable.Should().BeFalse(
        "a soil-applied fertiliser used no water — founder ruling 2026-08-15");
}

[Fact]
public void DryFertiliserDay_still_owes_the_dose()
{
    var day = Run(DryFertiliserDay);
    Dim(day, "DOSE").Applicable.Should().BeTrue();
}

[Fact]
public void IrrigationOnlyDay_never_owes_a_product_dose()
{
    var day = Run(IrrigationOnlyDay);
    Dim(day, "DOSE").Applicable.Should().BeFalse();
}
```

- [ ] **Step 2: Run and watch the first fail**

Run: `dotnet test src/tests/ShramSafal.Domain.Tests/ --filter FullyQualifiedName~WorkShape`
Expected: FAIL on `DryFertiliserDay_never_owes_water` — CARRIER is applicable today.

- [ ] **Step 3: Add the shape enum**

```csharp
namespace AgriSync.ShramSafal.Domain.Dfes;

/// <summary>
/// The five information shapes a day's work can take (founder ruling 2026-08-15,
/// Ruling 2). Exactly one per day. Classified from what the work NATURALLY produces,
/// not from a per-activity list.
/// </summary>
public enum WorkShape
{
    /// <summary>Spraying, fertigation — may owe product, dose AND carrier.</summary>
    InputWithWater,
    /// <summary>Dry fertiliser (method Soil / paste_manual) — may owe dose, NEVER water.</summary>
    DryInput,
    /// <summary>Irrigation — may owe a water measure, NEVER a product dose.</summary>
    WaterOnly,
    /// <summary>Pruning, harvest, weeding, labour — owes neither.</summary>
    PhysicalWork,
    /// <summary>Field inspection or declared no-work — owes no execution bucket.</summary>
    Observation,
}
```

- [ ] **Step 4: Classify once, over both lists**

```csharp
/// <summary>
/// Ruling 2 (2026-08-15). Classified ONCE across BOTH root lists, because
/// PersistedDayRootBuilder projects every input row into a cropActivities title
/// ("Fertilizer DAP"), which Categorize() buckets as "fertigation". Classifying
/// per-list and unioning with Best() would therefore re-apply the water obligation
/// to a soil-applied fertiliser through the persisted path alone.
///
/// inputs[].method is the primary signal and is REQUIRED on every AI-extracted row
/// (AgriLogResponseSchema.ts:459). Titles are the fallback only.
/// </summary>
private static WorkShape ClassifyWorkShape(
    IReadOnlyList<JsonElement> roots, IReadOnlyList<JsonElement> persisted)
{
    var all = roots.Concat(persisted).ToList();
    var inputs = all.SelectMany(r => Arr(r, "inputs")).ToList();

    if (inputs.Any(i => WaterCarriedMethods.Contains(Str(i, "method") ?? "")
                     || string.Equals(Str(i, "carrierMedium"), "water", StringComparison.OrdinalIgnoreCase)))
        return WorkShape.InputWithWater;

    if (inputs.Count > 0) return WorkShape.DryInput;   // method ∈ {Soil, paste_manual}

    if (all.SelectMany(r => Arr(r, "irrigation")).Any()
        || TitleBuckets(all).Contains("irrigation"))
        return WorkShape.WaterOnly;

    // Persisted-only application (no inputs[] anywhere): the method is unknowable.
    // Ruling 2 — "if work classification is uncertain, do not guess". Owe the dose,
    // never the water: that can never ask a dry day for water it did not use.
    if (TitleBuckets(all).Overlaps(ApplicationBuckets)) return WorkShape.DryInput;

    return HasWork(all) ? WorkShape.PhysicalWork : WorkShape.Observation;
}

private static readonly HashSet<string> WaterCarriedMethods =
    new(StringComparer.OrdinalIgnoreCase) { "Spray", "Drip", "Drenching" };
```

- [ ] **Step 5: Rewrite the owed-ness wrappers and the stale comment**

```csharp
// FOUNDER DECISION 2026-08-15 (Ruling 2) — SUPERSEDES the 2026-08-13 decision that
// previously lived here. That decision said a soil-applied input still owes the water
// question, and this comment used to forbid a `method == "Soil"` bypass. The founder
// reversed it on 2026-08-15: work is now classified by the information it naturally
// produces, and a dry input owes no water. Do not revert to the 2026-08-13 behaviour
// without a newer founder ruling.
private static Cover OwedDose(WorkShape shape, Cover described) => shape switch
{
    WorkShape.WaterOnly or WorkShape.PhysicalWork or WorkShape.Observation => Cover.NotApplicable,
    _ => described.Applicable ? described : new Cover(true, 0.0),
};

private static Cover OwedCarrier(WorkShape shape, Cover described) => shape switch
{
    WorkShape.DryInput or WorkShape.PhysicalWork or WorkShape.Observation => Cover.NotApplicable,
    _ => described.Applicable ? described : new Cover(true, 0.0),
};
```

Call sites at `:70-71` become:

```csharp
var shape = ClassifyWorkShape(roots, persisted);
var doseOwed = Dim("DOSE", W_DOSE, OwedDose(shape, Best(CoverDose(roots), CoverDose(persisted))));
var carrierOwed = Dim("CARRIER", W_CARRIER, OwedCarrier(shape, Best(CoverCarrier(roots), CoverCarrier(persisted))));
```

Leave the **lens** dimensions at `:68-69` untouched — they feed the reward economy, which is founder-gated.

- [ ] **Step 6: Mirror the rule client-side**

`scoreVlog.scoreDOSE` (`:279-296`) and `scoreVlog.scoreCARRIER` (`:359-394`) never received the dfes-3 change and have the same dry-fertiliser defect. Apply the same shape rule so the client ranks the right gap. Do **not** widen `isSprayInput` in `dayState.ts:94-98` — it feeds `logHasCategoryWork` → `computeScheduleGap`; add a narrow `classifyWorkShape` in the DFES services folder instead.

- [ ] **Step 7: Run the full Domain suite**

Run: `dotnet test src/tests/ShramSafal.Domain.Tests/`
Expected: PASS. `DfesLensExtractorCompletenessTests.cs:319-334`'s `[Theory]` receipt table carries hard-coded scores and **will move** — update it to the new values and state the delta in the commit body.

- [ ] **Step 8: Commit**

```bash
git add src/apps/ShramSafal/ShramSafal.Domain/Dfes/WorkShape.cs src/apps/ShramSafal/ShramSafal.Application/UseCases/Logs/CreateDailyLog/DfesLensExtractor.cs src/clients/mobile-web/src/features/logs/services/scoreVlog.ts src/tests/ShramSafal.Domain.Tests/Dfes
git commit -F - <<'EOF'
feat(dfes): classify work by what it naturally produces

spec: shram-sathi-followup-system-2026-08-15 (task-4)
EOF
```

---

## Task 5: The farmer is not asked to repeat weather the app already knows

**Files:**
- Modify: `src/apps/ShramSafal/ShramSafal.Application/Ports/IShramSafalRepository.cs:69`
- Modify: `src/apps/ShramSafal/ShramSafal.Infrastructure/Persistence/Repositories/ShramSafalRepository.cs:137`
- Modify: `src/apps/ShramSafal/ShramSafal.Application/UseCases/Logs/CreateDailyLog/DailyRichnessDerivationService.cs:119`
- Modify: `src/apps/ShramSafal/ShramSafal.Application/UseCases/Logs/CreateDailyLog/DfesLensExtractor.cs:34-38, 55-56, 119`
- Modify: `src/apps/ShramSafal/ShramSafal.Domain/Dfes/DfesTuning.cs:40`
- Modify: `src/clients/mobile-web/src/features/logs/services/dfesTuning.ts:24`
- Test: `src/tests/ShramSafal.Domain.Tests/Dfes/DfesLensExtractorWeatherTests.cs`

**No database migration.** `ssf.weather_stamps` exists, is populated on the same unit of work as the log (`CreateDailyLogHandler.cs:492` staged, `:524` flushed, `:530` recompute), and already has a SELECT RLS policy (`20260630040851_AddWeatherStampsTable.cs:51-79`). **Nothing has ever read it** — that is the entire gap.

- [ ] **Step 1: Write the failing tests (required tests 5 and 6)**

```csharp
[Fact]
public void Reliable_plot_weather_removes_WEATHER_from_what_the_farmer_owes()
{
    var day = Run(SprayDay, systemWeather: [Stamp(provider: WeatherProvider.TomorrowIo, plot: PlotId, at: LocalNoon)]);
    Dim(day, "WEATHER").Applicable.Should().BeFalse();
}

[Fact]
public void Missing_weather_does_not_remove_the_bucket()
{
    var day = Run(SprayDay, systemWeather: []);
    Dim(day, "WEATHER").Applicable.Should().BeTrue();
}

[Fact]
public void Mock_provider_weather_does_not_remove_the_bucket()
{
    var day = Run(SprayDay, systemWeather: [Stamp(provider: WeatherProvider.Mock, plot: PlotId, at: LocalNoon)]);
    Dim(day, "WEATHER").Applicable.Should().BeTrue();
}

[Fact]
public void Weather_from_a_different_day_does_not_remove_the_bucket()
{
    var day = Run(SprayDay, systemWeather: [Stamp(provider: WeatherProvider.TomorrowIo, plot: PlotId, at: LocalNoon.AddDays(-3))]);
    Dim(day, "WEATHER").Applicable.Should().BeTrue();
}
```

- [ ] **Step 2: Run and watch them fail**

Run: `dotnet test src/tests/ShramSafal.Domain.Tests/ --filter FullyQualifiedName~ExtractorWeather`
Expected: FAIL on the first — WEATHER is unconditionally applicable today.

- [ ] **Step 3: Add the read port**

```csharp
// IShramSafalRepository.cs — default body keeps ~28 in-tree test doubles compiling,
// matching the file's own convention at :64-68.
Task<IReadOnlyList<WeatherStamp>> GetWeatherStampsForDailyLogsAsync(
    IReadOnlyCollection<Guid> dailyLogIds, CancellationToken ct = default)
    => Task.FromResult<IReadOnlyList<WeatherStamp>>(Array.Empty<WeatherStamp>());
```

```csharp
// ShramSafalRepository.cs — mirrors GetObservationEventsForDailyLogsAsync
public async Task<IReadOnlyList<WeatherStamp>> GetWeatherStampsForDailyLogsAsync(
    IReadOnlyCollection<Guid> dailyLogIds, CancellationToken ct = default)
    => await db.WeatherStamps.AsNoTracking()
        .Where(w => dailyLogIds.Contains(w.DailyLogId))
        .ToListAsync(ct);
```

- [ ] **Step 4: Define "usable" honestly and widen `DayData`**

There is **no** confidence or staleness field on `WeatherStamp`. The only honest signals are the provider and the observation time, so the rule uses exactly those:

```csharp
/// <summary>
/// Ruling 3 (2026-08-15). Weather stops being something the farmer owes ONLY when the
/// app genuinely has it: a real provider (never Mock — MapWeatherProvider maps every
/// unrecognised provider string to Mock, so Mock means "unknown" too), the scored plot,
/// and the scored day. Missing, stale or uncertain weather leaves the bucket owed.
/// There is no confidence field on WeatherStamp; anything richer would be invented.
/// </summary>
private static bool HasUsableWeather(
    IReadOnlyList<WeatherStamp> stamps, Guid? plotId, DateOnly localDate)
    => stamps.Any(s => s.Provider != WeatherProvider.Mock
        && (plotId is null || s.PlotId == plotId)
        && FarmLocalDay.From(s.TimestampProvider) == localDate);
```

```csharp
public sealed record DayData(
    IReadOnlyList<JsonElement> Roots,
    IReadOnlyList<ObservationEvent> Observations,
    IReadOnlyList<JsonElement>? PersistedRoots = null,
    IReadOnlyList<AnsweredGap>? AnsweredGaps = null,
    IReadOnlyList<WeatherStamp>? SystemWeather = null);
```

- [ ] **Step 5: Change the ROSTER only — never `DayUnderstandingScore`**

> 🛑 A read-time exclusion (the shape `NotYetEarnable` uses at `DayUnderstandingScore.cs:96-97`) would rescore **every historical day the instant the API deploys**, before any recompute. That is precisely what Ruling 3 forbids. The change lives in `DfesLensExtractor.Build`'s `possible` list.

```csharp
// alongside doseOwed/carrierOwed at :70-71
var weatherOwed = Dim("WEATHER", W_WEATHER,
    HasUsableWeather(systemWeather, plotId, localDate) ? Cover.NotApplicable : weatherCover);
// …and at :119 the roster uses weatherOwed instead of weather.
// The `insight` lens at :78 keeps `weather` untouched — it feeds the reward economy.
```

- [ ] **Step 6: Guard historical rows**

```csharp
// DailyRichnessDerivationService.RecomputeAsync, before ApplyDerivation.
// Ruling 3: "do not silently change previously final historical numbers." RecomputeAsync
// genuinely reaches old days — a late-synced log recomputes ITS date (CreateDailyLogHandler.cs:530),
// and answering a question recomputes that day (RecordQuestionEventHandler.cs:95).
var scoredUnder = existing?.ScoreEngineVersion;
var applyWeatherRule = scoredUnder is null or DfesTuning.ScoreEngineVersion;
```

- [ ] **Step 7: Bump the score-engine version — four coordinated edits or the build goes red**

`DfesTuning.cs:40` `"dfes-3"` → `"dfes-4"` (add a `<para>` documenting the weather and work-shape changes) · `dfesTuning.ts:24` mirror · `DfesTuningTests.cs:29` · `DayUnderstandingScoreTests.cs:212`.

> **Tell the founder plainly:** nothing in the product *reads* `ScoreEngineVersion`. It is a forensic label. The guard in Step 6 is what actually prevents drift.

- [ ] **Step 8: Run the full Domain suite**

Run: `dotnet test src/tests/ShramSafal.Domain.Tests/`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/apps/ShramSafal src/clients/mobile-web/src/features/logs/services/dfesTuning.ts src/tests/ShramSafal.Domain.Tests/Dfes
git commit -F - <<'EOF'
feat(dfes): stop asking for weather the app already has

spec: shram-sathi-followup-system-2026-08-15 (task-5)
EOF
```

---

## Task 6: Sathi acknowledges the work only when it is sure

**Files:**
- Modify: `src/clients/mobile-web/src/features/logs/services/dfesQuestionEngine.ts:120-127, 212-222`
- Modify: `src/clients/mobile-web/src/features/logs/components/LedgerRecognitionPanel.tsx:190-202`
- Modify: `src/clients/mobile-web/src/features/logs/services/dfesQuestionBank.ts` (one new low-confidence entry)
- Modify: `src/clients/mobile-web/src/features/logs/components/MeterDisplay.tsx:123, 156`
- Test: `src/clients/mobile-web/src/features/logs/services/__tests__/dfesQuestionEngine.confidence.test.ts`

**No migration, no wire change.** `provenance.confidenceScore` is already on every saved log (`LogProvenance.ts:44`, stamped `BackendAiClient.ts:155`), and `LedgerRecognitionPanel` already holds `savedLog`.

**The rule lives in `pack()`** (`dfesQuestionEngine.ts:212`) — every one of the eight priority branches returns through it, so a future question cannot bypass it.

> **Two facts that bound the threshold.** `NormalizeConfidence` defaults an absent value to **0.75** (`AiResponseNormalizer.cs:446`) — absence reads as fairly high. And `AiOrchestrator.cs:1249` already rejects anything below **0.60** (`AiProviderConfig.cs:81`), so a threshold at or below 0.60 is dead code. A manual entry has **no** confidence score; `undefined` must never be read as low, or every manual-entry farmer gets the "I didn't understand" wording.

- [ ] **Step 1: Write the failing tests (required tests 7 and 8)**

```ts
it('names the work when the parse was confident', () => {
    const picked = selectDailyQuestion(base({
        parseConfidence: 0.92, todayWork: { activityMr: 'फवारणी' }, score: scoreWithGap('DOSE'),
    }));
    expect(picked!.resolvedPromptMr).toContain('फवारणी');
});

it('never names a guessed activity when the parse was not confident', () => {
    const picked = selectDailyQuestion(base({
        parseConfidence: 0.65, todayWork: { activityMr: 'फवारणी' }, score: scoreWithGap('DOSE'),
    }));
    expect(picked!.resolvedPromptMr).not.toContain('फवारणी');
});

it('treats a manual entry (no confidence score) as confident, not as unsure', () => {
    const picked = selectDailyQuestion(base({
        parseConfidence: undefined, todayWork: { activityMr: 'छाटणी' }, score: scoreWithGap('COST'),
    }));
    expect(picked!.resolvedPromptMr).toContain('छाटणी');
});
```

- [ ] **Step 2: Run and watch them fail**

Run: `cd src/clients/mobile-web && npx vitest run src/features/logs/services/__tests__/dfesQuestionEngine.confidence.test.ts`
Expected: FAIL — `parseConfidence` and `todayWork` are not recognised inputs.

- [ ] **Step 3: Add the central rule**

```ts
/**
 * Ruling 4 (2026-08-15) — ONE confidence rule, consulted by every question.
 *
 * 0.80 sits above the 0.75 that NormalizeConfidence uses when the model omits the field
 * (AiResponseNormalizer.cs:446), so a default never reads as a measurement. It is also
 * well above the orchestrator's own 0.60 floor (AiProviderConfig.cs:81) — anything at or
 * below that is unreachable, because a lower-confidence parse never reaches the client.
 *
 * A MANUAL entry carries no confidence score at all. `undefined` means "no model guessed
 * anything", which is the most certain case there is — never the least.
 */
const WORK_ACKNOWLEDGEMENT_THRESHOLD = 0.80;

export function isWorkRecognitionConfident(inputs: DailyQuestionInputs): boolean {
    if (inputs.todayWork === undefined) return false;
    if (inputs.parseConfidence === undefined) return true;   // manual entry
    return inputs.parseConfidence >= WORK_ACKNOWLEDGEMENT_THRESHOLD;
}
```

Add to `DailyQuestionInputs`:

```ts
/** The work Sathi believes was done today, in approved Marathi. Absent when nothing was recognised. */
todayWork?: { activityMr: string };
/** meta.provenance.confidenceScore from the saved log. Undefined on a manual entry. */
parseConfidence?: number;
```

Add the token (four coordinated edits per the resolver's contract):

```ts
// TOKEN_VALUES at :120-127 — camelCase only; TOKEN_PATTERN matches [a-zA-Z]+ and a
// non-matching token would reach the farmer verbatim.
['todayActivity', i => (isWorkRecognitionConfident(i) ? i.todayWork?.activityMr : undefined)],
```

`RESOLVER_TOKENS` (`:134`) derives automatically. **Add `todayActivity` to the bank guard's allowed set** in `dfesQuestionEngine.context.test.ts` or the bank test fails.

- [ ] **Step 4: Two bank entries, not one string with an empty token**

An absent token substitutes the empty string and `tidyResolvedPrompt` collapses the gap — so a low-confidence farmer would silently get the high-confidence sentence minus its subject. Ruling 4 says *do not repeat a guessed activity*, which needs a **separate** string:

```ts
// dfesQuestionBank.ts — the DOSE gap, confident and unsure variants
DOSE:        '{todayActivity} केली, समजलं. औषध किती वापरलं?',
DOSE_UNSURE: 'आजच्या कामाबद्दल एक गोष्ट सांगा — औषध किती वापरलं?',
```

`pack()` selects the variant via `isWorkRecognitionConfident(inputs)`.

- [ ] **Step 5: Populate the inputs**

```tsx
// LedgerRecognitionPanel.tsx — inside questionInputs, under the existing questionsEnabled gate
parseConfidence: savedLog?.meta?.provenance?.confidenceScore,
todayWork: recognisedWorkMr(allLogs, plotId, resolvedDate),  // first category with a non-zero
                                                             // count, via getExecutionCountByCategory
                                                             // + CATEGORY_LABEL_MR — the same
                                                             // precedent computePreviousLog uses
```

- [ ] **Step 6: Run the services suite**

Run: `cd src/clients/mobile-web && npx vitest run src/features/logs/`
Expected: PASS, including the bank guard.

- [ ] **Step 7: Commit**

```bash
git add src/clients/mobile-web/src/features/logs
git commit -F - <<'EOF'
feat(dfes): name the work only when Sathi is sure of it

spec: shram-sathi-followup-system-2026-08-15 (task-6)
EOF
```

---

## Task 7: The farmer can answer by speaking again

**Files:**
- Modify: `src/clients/mobile-web/src/features/logs/components/MeterDisplay.tsx:110-160`
- Modify: `src/clients/mobile-web/src/features/logs/components/MeterQuestionHost.tsx`
- Modify: `src/clients/mobile-web/src/core/navigation/mainView.tsx` (route back to the mic)
- Test: `src/clients/mobile-web/src/features/logs/components/__tests__/MeterQuestionHost.respeak.test.tsx`

**This task unblocks Task 9.** Today no bank entry defines `answerOptions`, so the only live outcome is a bare acknowledgement with **no text** — `question_events.response` is NULL on every row ever written, and `AnsweredGap.TryFrom` therefore always returns false. **The answer-raises-score path has never fired in production.**

**Founder ruling 2026-08-15:** the answer is given by **speaking again**, not by tapping a choice — "no taps before he speaks". Tapping the question takes him to the microphone with the question visible, and what he says is parsed by the normal pipeline. The score then rises because he genuinely supplied the fact, not because a tap was counted.

- [ ] **Step 1: Write the failing test**

```tsx
it('takes the farmer to the microphone with the question still visible', async () => {
    const goToMic = vi.fn();
    render(<MeterQuestionHost {...props} onAnswerBySpeaking={goToMic} />);
    await userEvent.click(screen.getByTestId('shramsathi-question'));
    expect(goToMic).toHaveBeenCalledWith(expect.objectContaining({ questionKey: 'gap.dose' }));
});

it('records that the question was shown, without inventing an answer', async () => {
    render(<MeterQuestionHost {...props} />);
    await userEvent.click(screen.getByTestId('shramsathi-question'));
    expect(recordQuestionEvent).toHaveBeenCalledWith(
        expect.anything(), expect.anything(), expect.anything(),
        expect.objectContaining({ skipped: false, response: null }), expect.anything());
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `cd src/clients/mobile-web && npx vitest run src/features/logs/components/__tests__/MeterQuestionHost.respeak.test.tsx`
Expected: FAIL — `onAnswerBySpeaking` is not a recognised prop.

- [ ] **Step 3: Implement the route back to the mic**

The question card becomes the affordance: tapping it records that the question was shown (no fabricated answer) and routes to the recording surface with the question pinned above the microphone so the farmer can see what he is answering. Reuse the existing recording entry point; do not build a second one.

- [ ] **Step 4: Run the components suite**

Run: `cd src/clients/mobile-web && npx vitest run src/features/logs/components/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/clients/mobile-web/src/features/logs src/clients/mobile-web/src/core/navigation/mainView.tsx
git commit -F - <<'EOF'
feat(dfes): answer Sathi by speaking again, not by tapping

spec: shram-sathi-followup-system-2026-08-15 (task-7)
EOF
```

---

## Task 8: Every number remembers how sure the farmer was

**Files:**
- Modify: `src/clients/mobile-web/src/domain/types/log.types.ts`
- Modify: `src/clients/mobile-web/src/domain/ai/contracts/AgriLogResponseSchema.ts` (6 nested schemas)
- Modify: `src/apps/ShramSafal/ShramSafal.Application/UseCases/Logs/CreateDailyLog/ManualDraftNormalizer.cs:49-92`
- Create: `src/apps/ShramSafal/ShramSafal.Domain/Common/NumericCertainty.cs`
- Modify: `ApplicationInputItem.cs`, `IrrigationEntry.cs`, `LabourAssignment.cs`, `MachineryUsage.cs`
- Create: `src/apps/ShramSafal/ShramSafal.Infrastructure/Persistence/Migrations/<timestamp>_AddNumericCertainty.cs`
- Test: `sync-contract/tests/payloads.test.ts`, `src/tests/ShramSafal.Sync.IntegrationTests/Dfes/NumericCertaintyRoundTripTests.cs`

**No Dexie bump** — these ride the stored blob; only indexed paths need a bump (`v23.ts:18`).
**No `create_daily_log.zod.ts` change** — draft rows are `z.unknown()` (`:70`), so a `numbers` key already validates.
**EF migration IS required** — four child tables gain nullable columns.

> 🛑 **`ManualDraftNormalizer` silently eats anything not allow-listed** (`CopyAllowed`, `:169-182`). The wire test will pass and the data will vanish. Adding `numbers` to `InputFields`/`MixFields`/`IrrigationFields`/`LabourFields`/`MachineryFields` is **mandatory**, not optional.

- [ ] **Step 1: Write the failing round-trip test (required tests 9 and 10)**

```csharp
[Fact]
public async Task An_approximate_dose_survives_persistence_and_sync()
{
    if (SkippedForMissingPostgres()) { return; }

    await PushManualDraftAsync(inputs: [ new {
        id = "in-1", method = "Spray", productName = "Mancozeb",
        mix = new[] { new { id = "m-1", productName = "Mancozeb", dose = 500, unit = "ml" } },
        numbers = new { dose = new { certainty = "approximate", spokenText = "अंदाजे ५०० मिली" } },
    }]);

    var row = await ReadApplicationInputItemAsync();
    row.DoseCertainty.Should().Be(NumericCertainty.Approximate);
    row.DoseSpokenText.Should().Be("अंदाजे ५०० मिली");
}

[Fact]
public async Task Do_not_remember_creates_no_numeric_value()
{
    if (SkippedForMissingPostgres()) { return; }

    await PushManualDraftAsync(inputs: [ new {
        id = "in-2", method = "Spray", productName = "Mancozeb",
        mix = new[] { new { id = "m-2", productName = "Mancozeb", unit = "ml" } },
        numbers = new { dose = new { certainty = "unknown", spokenText = "आठवत नाही" } },
    }]);

    var row = await ReadApplicationInputItemAsync();
    row.DoseAmount.Should().BeNull("P4 — an unknown number is never zero");
    row.DoseCertainty.Should().Be(NumericCertainty.Unknown);
}
```

- [ ] **Step 2: Run and watch them fail**

Run: `dotnet test src/tests/ShramSafal.Sync.IntegrationTests/ --filter FullyQualifiedName~NumericCertainty`
Expected: FAIL — the columns do not exist. State the `[PROVISIONED]` evidence.

- [ ] **Step 3: Add the client type**

```ts
// log.types.ts — alongside FieldProvenance (:39). A DIFFERENT axis from provenance:
// provenance says how the system got the value; certainty says how sure the farmer was.
// "अंदाजे ५०० मिली" is spoken AND approximate.
export type NumericCertainty = 'reported' | 'approximate' | 'unknown';
export type NumericBasis = 'per_pump' | 'per_acre' | 'whole_plot' | 'per_litre' | 'per_person_day';

export interface NumericFact {
    certainty: NumericCertainty;
    /** ABSENT when certainty === 'unknown'. Never 0 — P4. */
    quantity?: number;
    unit?: string;
    basis?: NumericBasis;
    /** The farmer's own words for this number. */
    spokenText?: string;
}

/** Key = the sibling numeric field this qualifies: 'dose', 'totalCost', 'waterVolumeLitres'… */
export type NumericFacts = Record<string, NumericFact>;
```

Add `numbers?: NumericFacts;` to `InputMixItem`, `InputEvent`, `IrrigationEvent`, `LabourEvent`, `MachineryEvent`, `ActivityExpenseEvent`. **Certainty belongs to each number, not the log** — a farmer may know the water exactly and only estimate the cost.

- [ ] **Step 4: Declare it in the AI contract**

The nested schemas are `.passthrough()` so it would be accepted silently, but the file's own rule (`:30-34`) says declare it. Mirror `NumericFactSchema` / `NumericFactsSchema` and add `numbers: NumericFactsSchema.optional()` to the same six nested schemas. **Do not touch the top level** — it is `.strict()`.

- [ ] **Step 5: Allow-list it in the normaliser, then persist it**

Add `"numbers"` to `InputFields`, `MixFields`, `IrrigationFields`, `LabourFields`, `MachineryFields` (`ManualDraftNormalizer.cs:49-92`), then add nullable columns and read them in `LedgerDerivationService` beside the existing `ReadDecimal(item, "dose")` calls.

```csharp
// ShramSafal.Domain/Common/NumericCertainty.cs
public enum NumericCertainty { Reported = 0, Approximate = 1, Unknown = 2 }
```

> `CostEntry.Create` **throws** when `amount <= 0` (`CostEntry.cs:95-98`). "आठवत नाही" must therefore never produce a `CostEntry` row at all — the certainty map is the only place an unknown cost can live.

- [ ] **Step 6: Add the contract tests**

Follow the `manualDraft` template exactly — one accept case, one reject case, in `sync-contract/tests/payloads.test.ts`.

- [ ] **Step 7: Run everything**

Run: `dotnet test src/AgriSync.sln` · `cd src/clients/mobile-web && npx vitest run` · `cd sync-contract && npx vitest run`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/clients/mobile-web/src/domain src/apps/ShramSafal sync-contract/tests/payloads.test.ts src/tests
git commit -F - <<'EOF'
feat(dfes): every number remembers how sure the farmer was

spec: shram-sathi-followup-system-2026-08-15 (task-8)
EOF
```

---

## Task 9: A filler answer is kept honestly and earns nothing

> 🛑 **DEPENDS ON TASK 7** (an answer must be givable before it can be classified) and **BLOCKED ON GATE C**.

**Files:**
- Create: `src/apps/ShramSafal/ShramSafal.Domain/Dfes/ObservationAnchor.cs`
- Modify: `src/apps/ShramSafal/ShramSafal.Application/UseCases/Logs/CreateDailyLog/DfesLensExtractor.cs:305-311, 129`
- Test: `src/tests/ShramSafal.Domain.Tests/Dfes/ObservationAnchorTests.cs`

**Today's bar is 8 characters** (`DfesLensExtractor.cs:311`). Two of the founder's three filler examples already clear it — `"काही नाही"` (9) and `"सगळं बरोबर"` (10). Only `"ठीक आहे"` (7) fails, and by luck of length rather than by rule. The bar must become *anchoring*, not length.

- [ ] **Step 1: Write the failing tests (required tests 11 and 12)**

```csharp
[Theory]
[InlineData("ठीक आहे")]
[InlineData("काही नाही")]
[InlineData("सगळं बरोबर")]
public void Filler_earns_no_observation(string text)
    => ObservationAnchor.IsAnchored(text).Should().BeFalse();

[Theory]
[InlineData("पानांवरचे डाग वाढले.")]
[InlineData("कीड मागच्या वेळेपेक्षा कमी दिसली.")]
[InlineData("खालच्या बाजूला ओलावा कमी होता.")]
[InlineData("कालचे डाग आज वाढले नाहीत.")]   // a SPECIFIC "no change" IS an observation
public void An_anchored_noticing_earns_the_bucket(string text)
    => ObservationAnchor.IsAnchored(text).Should().BeTrue();
```

- [ ] **Step 2: Run and watch them fail**

Run: `dotnet test src/tests/ShramSafal.Domain.Tests/ --filter FullyQualifiedName~ObservationAnchor`
Expected: FAIL — the type does not exist.

- [ ] **Step 3: Implement the anchor test**

A real observation names something observable **and** says something about its state or change. The subject and state vocabularies are farmer-facing content, so they carry the same review gate as question copy — **draft them for founder + agronomist review; do not ship an unreviewed Marathi keyword list in code** (the `{weather}` precedent, `dfesQuestionEngine.ts:191-201`).

- [ ] **Step 4: Use it, and close the `hasMeaningfulObs` loophole**

```csharp
|| (NoticingNoteTypes.Contains(o.NoteType) && ObservationAnchor.IsAnchored(o.TextRaw))
```

`hasMeaningfulObs` (`:129`) must change in the same commit or filler still reaches `DayClassification.ObservationDay` (`DayClassifier.cs:47`).

- [ ] **Step 5: Preserve the raw answer, create no observation**

An unanchored answer writes `question_events.response` (append-only, KEEP on erasure) and creates **no** `ObservationEvent`. No new table.

- [ ] **Step 6: Prove no second question fires**

The one-per-day guard (`dfesQuestionEngine.ts:226-229`) is outcome-blind and holds **only because every outcome writes a row**. Add a test pinning that a filler answer still writes one — if a future change skips the write "because it wasn't a real answer", the guard silently opens.

- [ ] **Step 7: Run the Domain suite**

Run: `dotnet test src/tests/ShramSafal.Domain.Tests/`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/apps/ShramSafal/ShramSafal.Domain/Dfes/ObservationAnchor.cs src/apps/ShramSafal/ShramSafal.Application/UseCases/Logs/CreateDailyLog/DfesLensExtractor.cs src/tests/ShramSafal.Domain.Tests/Dfes/ObservationAnchorTests.cs
git commit -F - <<'EOF'
feat(dfes): keep a filler answer honestly, credit it nothing

spec: shram-sathi-followup-system-2026-08-15 (task-9)
EOF
```

---

## Task 10: The plot is never asked again, and advice stays blocked

**Files:**
- Modify: `src/clients/mobile-web/src/features/logs/services/dfesQuestionBank.ts:95-111`
- Test: `src/clients/mobile-web/src/features/logs/services/__tests__/dfesQuestionBank.test.ts`

- [ ] **Step 1: Write the failing tests (required tests 14 and 15)**

```ts
it('never offers the plot question — the farmer already tapped the plot', () => {
    expect(DFES_QUESTION_BANK.find(q => q.questionKey === 'gap.scope')).toBeUndefined();
});

it('keeps prospective spray advice out of selection', () => {
    const q = DFES_QUESTION_BANK.find(x => x.questionKey === 'safety.spray_wind_high')!;
    expect(q.agronomistApproved).toBe(false);
});
```

- [ ] **Step 2: Run and watch the first fail**

Run: `cd src/clients/mobile-web && npx vitest run src/features/logs/services/__tests__/dfesQuestionBank.test.ts`
Expected: FAIL — `gap.scope` still exists.

- [ ] **Step 3: Remove SCOPE from the gap bank**

Delete the `SCOPE` entry from `GAP_PROMPT` (`:102-111`) and `GAP_LENS` (`:95-99`). The server already excludes SCOPE from scoring (`DfesLensExtractor.cs:16-17`), so this aligns the question bank with the scoring it was always meant to serve.

- [ ] **Step 4: Rename the approval flag honestly**

Founder ruling 2026-08-15: the twelve questions carrying `agronomistApproved: true` were never seen by an agronomist. Rename the constant to `shramSafalReviewed` across the bank and the `approved()` gate (`dfesQuestionEngine.ts:97-99`), keeping `agronomistApproved` as a **separate** flag that stays `false` for the four genuinely agronomic entries.

- [ ] **Step 5: Run the services suite**

Run: `cd src/clients/mobile-web && npx vitest run src/features/logs/services/`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/clients/mobile-web/src/features/logs/services
git commit -F - <<'EOF'
feat(dfes): stop asking the plot, label review honestly

spec: shram-sathi-followup-system-2026-08-15 (task-10)
EOF
```

---

## Task 11: Farmer-facing Marathi drops "नोंद"

> 🛑 **BLOCKED ON GATE D** (scope) and **GATE E** (two strings the founder owes).

**Files:** per the Gate D answer. The complete inventory is 64 occurrences across 24 files; `ShramSathiUnderstanding.tsx:29,31,32,34` is **exempt by founder ruling** and keeps "नोंद".

- [ ] **Step 1: Write the failing enforcement test (required test 13)**

```ts
it('no farmer-facing Sathi copy contains नोंद', () => {
    const offenders = DFES_QUESTION_BANK
        .filter(q => q.promptMr.includes('नोंद'))
        .map(q => q.questionKey);
    expect(offenders).toEqual([]);
});
```

- [ ] **Step 2: Run it**

Run: `cd src/clients/mobile-web && npx vitest run src/features/logs/services/__tests__/dfesQuestionBank.test.ts`

- [ ] **Step 3: Apply the sweep at the agreed scope**

Confident replacements already drafted: `आणखी नोंद करा` → `आणखी काही सांगा` · `...आज नोंद करा?` → `...आज सांगणार का?` · `आजपर्यंत X वेळा नोंद झाली` → `आजपर्यंत X वेळा सांगितलं` · `सर्व नोंदी पाहा` → `सर्व कामं पाहा`. **`नोंद पाहा` and the referral invite await founder wording (Gate E).**

> `noWorkDayAcknowledged` (`translations.ts:999`) carries *"FOUNDER-SUPPLIED register, used verbatim — do not paraphrase"* **and** contains नोंदवलं. Do not edit it without an explicit founder instruction.

- [ ] **Step 4: Add the guard so it cannot drift back**

No lint rule or CI check bans the word today. Add the test above to the blocking suite.

- [ ] **Step 5: Run the frontend suite**

Run: `cd src/clients/mobile-web && npx vitest run`
Expected: PASS. Re-run any 5s-timeout file in isolation before believing a failure; never use `--no-file-parallelism`.

- [ ] **Step 6: Commit**

```bash
git add src/clients/mobile-web/src
git commit -F - <<'EOF'
feat(copy): farmer-facing Marathi speaks, it does not file records

spec: shram-sathi-followup-system-2026-08-15 (task-11)
EOF
```

---

## Task 12: The whole gate, green

- [ ] **Step 1: Run both halves**

Run: `dotnet test src/AgriSync.sln` then `cd src/clients/mobile-web && npx vitest run`
Expected: frontend exit 0. Backend: the 49 pre-existing failures are Docker-absent Testcontainers (47) plus 2 in `AiEndpointsTests.cs`, which is byte-identical to `origin/main`. **Classify every failure with evidence; never report a pre-existing failure as new, and never report a new one as pre-existing.**

- [ ] **Step 2: Confirm the score-version story end to end**

A day scored under `dfes-3` keeps its stamp and its number; a day scored after this branch carries `dfes-4`. Prove it with the guard test from Task 5 Step 6.

- [ ] **Step 3: Update the deployment tracker**

One row naming the branch, the migrations (Task 3's unique index, Task 8's certainty columns), and `PENDING` for the prod `/version` SHA.

---

## What this plan explicitly does NOT do

- No scoring redesign. The lens dimensions and the reward economy are untouched; only the roster's owed-ness changes.
- No generic conversation platform. One question, one day, one log.
- No new AI provider. Task 8's voice path is gated (Gate B) precisely so the prompt work is a deliberate decision, not a side effect.
- No fix to `AgriLogResponseSchema.safeParse` failing in production (scalar `confidence` vs `z.record`, unknown `fieldConfidences` against `.strict()`). Real, pre-existing, out of bounds — recorded here so it is not lost.
- No LEARNING activation. It stays dormant until farmer belief, observed result and validated agronomic knowledge can be kept apart.
- No approval screen changes, no harvest/scouting work, no unrelated refactor.
