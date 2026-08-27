# DFES Farmer-Facing Deploy Readiness — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Take `feat/dfes-companion` from "code is correct but invisible" to "a farmer opens the app, logs his day, and the number he sees is real, earnable, and does not go backwards."

**Architecture:** The Day Understanding Score is computed server-side from `ssf.daily_richness_aggregates`, rebuilt idempotently by `DailyRichnessDerivationService.RecomputeAsync(farmId, logDate)`. This plan adds **one new fact source** to that existing spine — the farmer's answers to Sathi's questions — rather than creating a second scoring path. It then stops a pull-path regression that silently erases the companion's familiarity counter, and finally wires the feature flags into the production build so the work is actually visible.

**Tech Stack:** .NET 10 / EF Core / PostgreSQL 16 (`ssf` schema, forced RLS) · React 19 + TypeScript + Vite + Dexie · xUnit + FluentAssertions · Vitest 4

**Spec:** `docs/superpowers/specs/` — this plan continues `2026-08-13-dfes-truthful-number-and-merge-readiness.md`.

## Founder rulings, 2026-08-14

| # | Ruling | Effect on this plan |
|---|---|---|
| **A** | Answering Sathi's question must raise the day's score | Tasks 1–4 |
| **1 — C** | Launch to **10–20 personally chosen farmers**. Shared-handset exposure is **out of scope by segment definition**: *"this does not happen that a farmer shares phone — if that is the case we are not building this app for them."* | Pilot gate. Risk **accepted, not fixed** — recorded in "Out of scope" |
| **2** | *"Reward honesty and mark its consistency — no score needed for such days."* A declared no-work day earns no score but keeps the farmer's consistency | Task 5 (pull fix) + Task 6 (UI state) |
| **3** | The twelve questions were **reshaped by a real agronomist in the founder's contact**. Treat as genuine; **remove the sign-off gate.** New requirement: questions must be **context-rich** — wired to weather and the previous log — not generic | Sign-off task **deleted**; replaced by Task 7 |
| **4 — B** | Calibration sitting happens **after the pilot starts**, not before | Gate A moves after launch |

## Global Constraints

- **Never fabricate a number.** Doctrine `P4`. A gap answer may only fill the dimension the farmer actually answered. No inference, no defaults, no multiplying a rate by hours.
- **`agronomistApproved: true` may not be asserted by a code constant** for any question whose answer changes agronomic advice. Twelve questions currently do; they are gated in Task 6, not silently shipped.
- **Marathi body:** `'Noto Sans Devanagari', sans-serif` · headings `'Noto Serif Devanagari', serif` · numerals/brand `'DM Sans', sans-serif`. Never `system-ui`/`Arial`.
- **No secrets in git.** Flag values go into the deploy environment, never a tracked `.env`.
- **Branch:** all work on `feat/dfes-companion`. Nothing to `main`.
- **Commits unsigned by design** (CLAUDE.md 2026-08-08). Never claim otherwise.
- **Score range 0–10**, target `9`. Monotonic: adding a fact may never lower the score.

---

## Verified Starting State (read this before changing anything)

Established by reading the code on this branch, 2026-08-14:

| Claim | Verdict | Evidence |
|---|---|---|
| The `/10` score is server-fetched and immune to the Dexie pull-wipe | ✅ **safe** | `useDayUnderstanding.ts:61` → `GET /shramsafal/day-understanding` |
| Answering a question persists to the server | ✅ **works** | `dfesQuestionApi.ts:49` → `RecordQuestionEventHandler` |
| Answering a question raises the score | ❌ **no** | `DayUnderstandingScore.cs` / `DfesLensExtractor.cs` contain zero `QuestionEvent` references |
| A manual-entry day cannot score as well as a voice day | ✅ **already fixed** | `DailyRichnessDerivationService.cs:93-102` — persisted root built for **every** log from all typed children (task-7, 2026-08-13) |
| The pull replaces the whole log record with no field preservation | ❌ **defect** | `logsReconciler.ts:70` full `db.logs.put`; `existing` read at `:60` only for timestamps, never merged |
| `understanding` is dropped on pull | ❌ **defect** | `toDailyLog()` `:175-214` returns no `understanding` key |
| Two live DFES surfaces read the dropped field | ❌ **defect** | `meterArrival.ts:59`, `closureReceiptProjection.ts:146` |
| `dayOutcome` is hardcoded on pull | ❌ **defect** | `logsReconciler.ts:186` `dayOutcome: 'WORK_RECORDED'` |
| DFES flags exist in the production build config | ❌ **absent** | none of the 7 `VITE_*` flags appear in `.env.production.example` |

## Task 0 result — STILL BROKEN (settled 2026-08-14, database + code)

**A manual-entry day cannot score. This is confirmed, not suspected.**

Live `agrisync_dfes` — every voice log persists a typed child; **every manual log persists none**:

```
date       | log      | src    | tasks | labour | irrig | mach
2026-08-14 | b84a7c2a | manual |   0   |   0    |   0   |  0     (x8 on this date)
2026-08-13 | 5f09a0af | voice  |   0   |   1    |   0   |  0
2026-08-13 | 6aea90f0 | manual |   0   |   0    |   0   |  0
2026-08-13 | cf42b94b | voice  |   0   |   1    |   0   |  0
2026-08-13 | e35ca25b | voice  |   0   |   1    |   0   |  0
```

Mechanism, at `LedgerDerivationService.cs:32-45` — the **sole** writer of `labour_assignments`, `irrigation_entries` and `machinery_usages`:

```csharp
public async Task<DerivationOutcome> DeriveAsync(
    DailyLog log, AiJob sourceJob, ...)          // :33  requires an AI job
{
    ArgumentNullException.ThrowIfNull(sourceJob); // :36
    if (string.IsNullOrWhiteSpace(sourceJob.NormalizedResultJson)) // :40 bails
        ...
    using var doc = JsonDocument.Parse(sourceJob.NormalizedResultJson); // :45 the ONLY source
```

A manual entry has no AI job, so no typed child is ever written. `PersistedDayRootBuilder` then finds nothing, `DfesLensExtractor` has neither an AI root nor a persisted root, and the day lands as `UnaccountedDay` — which is precisely what today's aggregate shows (`2026-08-14 | exec 0 | ins 0 | UnaccountedDay | has_work=f`).

**Correction to two earlier statements in this file's history.** An initial report said manual entry persists nothing — correct. A later correction claimed that was wrong because `CreateLog.ts:59-69` sends the complete draft and `DailyRichnessDerivationService.cs:93-102` reads persisted children for every log. **Both of those facts are true and the conclusion drawn from them was still wrong:** the client does send the whole draft, and the scorer would read typed children if they existed — but nothing on the server ever converts a *manual* draft into those children. The 2026-08-13 task-7 fix widened what the scorer *reads*; it did not create anything for it to read on the manual path.

**Consequence for this plan:** per Task 0 Step 4, this outranks every other task here. It is now **Task 0b**, and Tasks 1–8 are downstream of it.

---

## Task 0b: A manual day persists what the farmer entered

**Files:**
- Create: `src/apps/ShramSafal/ShramSafal.Application/UseCases/Logs/CreateDailyLog/ManualDraftNormalizer.cs`
- Modify: `src/apps/ShramSafal/ShramSafal.Application/UseCases/Logs/CreateDailyLog/CreateDailyLogHandler.cs:502`
- Test: `src/tests/ShramSafal.Domain.Tests/Dfes/ManualDraftNormalizerTests.cs`

**Approach — reuse, do not duplicate.** `CreateDailyLogHandler.EvidenceArrayKeys` (`:539-543`) already names the arrays the AI schema uses: `labour, inputs, irrigation, observations, plannedTasks, cropActivities, machinery, activityExpenses`. The manual draft built in `ManualEntry.tsx:261` uses **the same bucket names**. So the manual draft can be normalised into the same wire shape `DeriveAsync` already consumes, and every persistence path is reused unchanged.

**Provenance is the hard constraint.** The synthetic job must declare itself manual. It may never carry a model version, prompt version or extractor SHA, because doctrine `P8` requires that a typed figure entered by hand be distinguishable forever from one inferred by a model. A manual row must read as `source: manual`, never as an AI derivation.

**No-multiply rule still holds (`P4`).** A labour row with no explicitly entered total is *not* given one. The existing behaviour — refusing to multiply a rate by hours — must survive this change; the normaliser copies only values the farmer actually typed.

- [ ] **Step 1: Write the failing test** — a manual draft with one labour row carrying an explicit total normalises to a wire object `DeriveAsync` accepts, and a labour row with no total emits no cost.
- [ ] **Step 2: Run it and watch it fail.**
- [ ] **Step 3: Implement `ManualDraftNormalizer.ToWireJson(draft)`** and call `DeriveAsync` with a manual-provenance job when `SourceAiJobId` is null.
- [ ] **Step 4: Re-run the Task 0 query** — a filled manual day must show non-zero children and a non-zero score.
- [ ] **Step 5: Commit.**

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `ShramSafal.Domain/Dfes/AnsweredGap.cs` | Value type: one gap dimension a farmer answered on a date | **create** |
| `ShramSafal.Application/.../DfesLensExtractor.cs` | Add `AnsweredGaps` to `DayData`; credit answered dimensions | modify |
| `ShramSafal.Application/.../DailyRichnessDerivationService.cs` | Load answered gaps, pass into `DayData` | modify |
| `ShramSafal.Application/.../RecordQuestionEvent/RecordQuestionEventHandler.cs` | After storing the event, recompute the day | modify |
| `ShramSafal.Application/Ports/IShramSafalRepository.cs` | `GetAnsweredGapsAsync(farmId, date, ct)` | modify |
| `ShramSafal.Infrastructure/.../ShramSafalRepository.cs` | Implement the query over `ssf.question_events` | modify |
| `mobile-web/src/features/sync/pull/reconcilers/logsReconciler.ts` | Preserve device-only fields across a pull | modify |
| `mobile-web/.env.production.example` | Document the 7 DFES flags | modify |

---

## Task 0: Reproduce before fixing

**Files:** none — this task writes no production code.

**Interfaces:**
- Consumes: a running local stack (API + web + `agrisync` on :5433)
- Produces: a written verdict recorded in this plan under "Task 0 result" that Tasks 1–6 depend on

- [ ] **Step 1: Save a manual day with real content**

Log in as the seeded test user, pick a plot, open manual entry, and enter **all** of: one labour row with an explicitly typed total, one irrigation, one input with a product name, one machinery row, one observation note. Save.

- [ ] **Step 2: Read what actually persisted**

```sql
SELECT l.id, l.log_date,
       (SELECT count(*) FROM ssf.log_tasks       t WHERE t.daily_log_id = l.id) AS tasks,
       (SELECT count(*) FROM ssf.log_labour      x WHERE x.daily_log_id = l.id) AS labour,
       (SELECT count(*) FROM ssf.log_irrigation  x WHERE x.daily_log_id = l.id) AS irrigation,
       (SELECT count(*) FROM ssf.log_machinery   x WHERE x.daily_log_id = l.id) AS machinery
FROM ssf.daily_logs l
WHERE l.log_date = CURRENT_DATE
ORDER BY l.created_at_utc DESC;
```

- [ ] **Step 3: Read the score the farmer would see**

```sql
SELECT local_date, score, classification, contributing_flags
FROM ssf.daily_richness_aggregates
WHERE local_date = CURRENT_DATE;
```

- [ ] **Step 4: Record the verdict in this file**

Write one of these two lines under a new `## Task 0 result` heading, with the query output pasted beneath it:

- `CONFIRMED FIXED — a filled manual day produces typed children and scores > 0. No manual-entry work needed.`
- `STILL BROKEN — a filled manual day produced <N> typed children and scored <S>.` **If this line is written, stop and re-plan.** A manual day that cannot score is a higher priority than every other task here, and its fix is not yet designed.

- [ ] **Step 5: Commit the finding**

```bash
git add docs/superpowers/plans/2026-08-14-dfes-farmer-facing-deploy-readiness.md
git commit -m "docs(dfes): record Task 0 runtime verdict on manual-entry scoring"
```

---

## Task 1: An answered gap becomes a scoreable fact (domain)

Founder ruling **A**. A gap question already knows which dimension it fills — `GAP_LENS` in `dfesQuestionBank.ts` maps `WHAT/DOSE/SCOPE/CARRIER/COST → Execution`, `WEATHER/PURPOSE → Insight`, `CONTINUITY → Learning`. When the farmer answers, that dimension is genuinely known and must count.

**Files:**
- Create: `src/apps/ShramSafal/ShramSafal.Domain/Dfes/AnsweredGap.cs`
- Test: `src/tests/ShramSafal.Domain.Tests/Dfes/AnsweredGapTests.cs`

**Interfaces:**
- Produces: `AnsweredGap` record with `string Dimension` and `DateOnly LocalDate`; static `AnsweredGap.TryFrom(string questionKey, string? response, DateOnly date, out AnsweredGap gap)` returning `false` for skip/acknowledge outcomes.

- [ ] **Step 1: Write the failing test**

```csharp
using AgriSync.ShramSafal.Domain.Dfes;
using FluentAssertions;
using Xunit;

public class AnsweredGapTests
{
    [Fact]
    public void TryFrom_extracts_the_dimension_from_a_gap_question_key()
    {
        var ok = AnsweredGap.TryFrom("gap.DOSE.spray", "250ml", new DateOnly(2026, 8, 14), out var gap);

        ok.Should().BeTrue();
        gap.Dimension.Should().Be("DOSE");
        gap.LocalDate.Should().Be(new DateOnly(2026, 8, 14));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void TryFrom_rejects_an_empty_response_so_a_skip_never_scores(string? response)
    {
        var ok = AnsweredGap.TryFrom("gap.DOSE.spray", response, new DateOnly(2026, 8, 14), out _);

        ok.Should().BeFalse();
    }

    [Fact]
    public void TryFrom_rejects_a_non_gap_question_key()
    {
        var ok = AnsweredGap.TryFrom("safety.spray_wind_high", "yes", new DateOnly(2026, 8, 14), out _);

        ok.Should().BeFalse();
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `dotnet test src/tests/ShramSafal.Domain.Tests/ --filter FullyQualifiedName~AnsweredGapTests`
Expected: FAIL — `The type or namespace name 'AnsweredGap' could not be found`

- [ ] **Step 3: Write minimal implementation**

```csharp
namespace AgriSync.ShramSafal.Domain.Dfes;

/// <summary>
/// One gap dimension the farmer explicitly answered on a given day.
///
/// This is a FACT the farmer supplied, not an inference: it is created only from
/// a question whose key names a gap dimension AND whose response carries content.
/// A skip or a bare acknowledgement yields nothing, so silence never scores.
/// Doctrine P4 — nothing here is fabricated.
/// </summary>
public sealed record AnsweredGap(string Dimension, DateOnly LocalDate)
{
    private const string GapPrefix = "gap.";

    public static bool TryFrom(
        string questionKey,
        string? response,
        DateOnly localDate,
        out AnsweredGap gap)
    {
        gap = default!;

        if (string.IsNullOrWhiteSpace(response)) return false;
        if (string.IsNullOrWhiteSpace(questionKey)) return false;
        if (!questionKey.StartsWith(GapPrefix, StringComparison.Ordinal)) return false;

        var rest = questionKey[GapPrefix.Length..];
        var dot = rest.IndexOf('.');
        var dimension = dot < 0 ? rest : rest[..dot];
        if (dimension.Length == 0) return false;

        gap = new AnsweredGap(dimension, localDate);
        return true;
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `dotnet test src/tests/ShramSafal.Domain.Tests/ --filter FullyQualifiedName~AnsweredGapTests`
Expected: PASS — 5 tests

- [ ] **Step 5: Commit**

```bash
git add src/apps/ShramSafal/ShramSafal.Domain/Dfes/AnsweredGap.cs src/tests/ShramSafal.Domain.Tests/Dfes/AnsweredGapTests.cs
git commit -m "feat(dfes): add AnsweredGap — a farmer-supplied gap answer as a scoreable fact"
```

---

## Task 2: The extractor credits answered gaps

**Files:**
- Modify: `src/apps/ShramSafal/ShramSafal.Application/UseCases/Logs/CreateDailyLog/DfesLensExtractor.cs`
- Test: `src/tests/ShramSafal.Domain.Tests/Dfes/DfesLensExtractorAnsweredGapTests.cs`

**Interfaces:**
- Consumes: `AnsweredGap` from Task 1
- Produces: `DfesLensExtractor.DayData` gains a fourth member `IReadOnlyCollection<AnsweredGap> AnsweredGaps`. All existing construction sites must pass `[]` unless updated by Task 3.

- [ ] **Step 1: Write the failing test**

```csharp
[Fact]
public void An_answered_DOSE_gap_raises_the_score_and_never_lowers_it()
{
    var day = MinimalWorkDay();                        // existing helper: one activity, no dose
    var withoutAnswer = ScoreOf(day with { AnsweredGaps = [] });
    var withAnswer    = ScoreOf(day with
    {
        AnsweredGaps = [new AnsweredGap("DOSE", new DateOnly(2026, 8, 14))]
    });

    withAnswer.Should().BeGreaterThan(withoutAnswer);
}

[Fact]
public void An_answered_gap_never_exceeds_what_logging_it_directly_would_earn()
{
    var answered = ScoreOf(MinimalWorkDay() with
    {
        AnsweredGaps = [new AnsweredGap("DOSE", new DateOnly(2026, 8, 14))]
    });
    var logged = ScoreOf(WorkDayWithDose());           // existing helper

    answered.Should().BeLessThanOrEqualTo(logged);
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `dotnet test src/tests/ShramSafal.Domain.Tests/ --filter FullyQualifiedName~DfesLensExtractorAnsweredGapTests`
Expected: FAIL — `DayData` has no `AnsweredGaps` member

- [ ] **Step 3: Write minimal implementation**

Add the member to `DayData`, then credit each answered dimension at the same weight the dimension already carries, but **only when the day did not already earn it** (so answering cannot double-count):

```csharp
// DfesLensExtractor.DayData
public readonly record struct DayData(
    IReadOnlyCollection<JsonElement> Roots,
    IReadOnlyCollection<JsonElement> Observations,
    IReadOnlyCollection<JsonElement> PersistedRoots,
    IReadOnlyCollection<AnsweredGap> AnsweredGaps);

// inside Build(), AFTER the existing per-dimension scoring and BEFORE the rollup:
//
// An answered gap credits the dimension the farmer actually answered, at the
// dimension's own weight, and ONLY when the day has not already earned it.
// Never additive on top of a logged fact — answering is a second route to the
// same point, not a bonus. Keeps the score monotonic (P4, and the Task 1 ruling).
foreach (var gap in data.AnsweredGaps)
{
    switch (gap.Dimension)
    {
        case "WHAT"    when !covered.What:    covered.What    = true; earned += W_WHAT;    break;
        case "DOSE"    when !covered.Dose:    covered.Dose    = true; earned += W_DOSE;    break;
        case "CARRIER" when !covered.Carrier: covered.Carrier = true; earned += W_CARRIER; break;
        case "COST"    when !covered.Cost:    covered.Cost    = true; earned += W_COST;    break;
        case "WEATHER" when !covered.Weather: covered.Weather = true; earned += W_WEATHER; break;
        default: break;   // unknown dimension credits nothing — never guess
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `dotnet test src/tests/ShramSafal.Domain.Tests/`
Expected: PASS — full Domain suite, 1212+ tests, zero failures

- [ ] **Step 5: Commit**

```bash
git add src/apps/ShramSafal/ShramSafal.Application/UseCases/Logs/CreateDailyLog/DfesLensExtractor.cs src/tests/ShramSafal.Domain.Tests/Dfes/DfesLensExtractorAnsweredGapTests.cs
git commit -m "feat(dfes): credit an answered gap at its own weight, never double-counted"
```

---

## Task 3: Answering a question recomputes the day

**Files:**
- Modify: `src/apps/ShramSafal/ShramSafal.Application/Ports/IShramSafalRepository.cs`
- Modify: `src/apps/ShramSafal/ShramSafal.Infrastructure/Persistence/Repositories/ShramSafalRepository.cs`
- Modify: `src/apps/ShramSafal/ShramSafal.Application/UseCases/Logs/CreateDailyLog/DailyRichnessDerivationService.cs`
- Modify: `src/apps/ShramSafal/ShramSafal.Application/UseCases/Dfes/RecordQuestionEvent/RecordQuestionEventHandler.cs`
- Test: `src/tests/ShramSafal.Sync.IntegrationTests/Dfes/AnswerRaisesScoreTests.cs`

**Interfaces:**
- Consumes: `AnsweredGap` (Task 1), `DayData.AnsweredGaps` (Task 2)
- Produces: `Task<IReadOnlyList<AnsweredGap>> GetAnsweredGapsAsync(Guid farmId, DateOnly localDate, CancellationToken ct)`

- [ ] **Step 1: Write the failing integration test**

```csharp
[Fact]
public async Task Answering_a_gap_question_raises_the_stored_day_score()
{
    var farmId = await Seed.FarmWithOneLoggedActivityAsync();
    var date = DateOnly.FromDateTime(DateTime.UtcNow);

    var before = await ReadScoreAsync(farmId, date);

    await Send(new RecordQuestionEventCommand(
        FarmId: farmId, PlotId: Seed.PlotId,
        QuestionKey: "gap.DOSE.spray", Response: "250ml",
        Outcome: "answered", ShownAtUtc: DateTime.UtcNow));

    var after = await ReadScoreAsync(farmId, date);

    after.Should().BeGreaterThan(before);
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `dotnet test src/tests/ShramSafal.Sync.IntegrationTests/ --filter FullyQualifiedName~AnswerRaisesScoreTests`
Expected: FAIL — `after` equals `before`

> **Guard against a known past failure mode:** this suite has previously reported `Passed!` in ~1 second while creating **zero** databases. Before trusting a green run, confirm the run actually provisioned a database (`SELECT datname FROM pg_database WHERE datname LIKE 'ssf_it_%'`) and that the elapsed time is plausible.

- [ ] **Step 3: Write the implementation**

Repository query — RLS applies, so this must run inside the caller's tenant scope:

```csharp
public async Task<IReadOnlyList<AnsweredGap>> GetAnsweredGapsAsync(
    Guid farmId, DateOnly localDate, CancellationToken ct)
{
    var rows = await db.QuestionEvents
        .AsNoTracking()
        .Where(e => e.FarmId == farmId && e.LocalDate == localDate)
        .Select(e => new { e.QuestionKey, e.Response })
        .ToListAsync(ct);

    var gaps = new List<AnsweredGap>();
    foreach (var r in rows)
    {
        if (AnsweredGap.TryFrom(r.QuestionKey, r.Response, localDate, out var gap))
        {
            gaps.Add(gap);
        }
    }
    return gaps;
}
```

In `DailyRichnessDerivationService.RecomputeAsync`, load them and pass them through:

```csharp
var answeredGaps = await repository.GetAnsweredGapsAsync(farmId, localDate, ct);
var data = new DfesLensExtractor.DayData(roots, observations, persistedRoots, answeredGaps);
```

In `RecordQuestionEventHandler`, after the event is stored, rebuild the day. `RecomputeAsync` rebuilds the whole aggregate from scratch and is safe to call any number of times:

```csharp
// The farmer just told us something true about this day. The number he is
// looking at must reflect it before he looks away — founder ruling A,
// 2026-08-14. RecomputeAsync is idempotent (see its own contract note).
await dailyRichnessDerivation.RecomputeAsync(command.FarmId, localDate, ct);
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `dotnet test src/tests/ShramSafal.Sync.IntegrationTests/ --filter FullyQualifiedName~AnswerRaisesScoreTests`
Expected: PASS — and the run provisions a real database (see the guard in Step 2)

- [ ] **Step 5: Commit**

```bash
git add src/apps/ShramSafal src/tests/ShramSafal.Sync.IntegrationTests
git commit -m "feat(dfes): answering Sathi's question raises the day score (founder ruling A)"
```

---

## Task 4: The client refetches the score after an answer

**Files:**
- Modify: `src/clients/mobile-web/src/features/logs/hooks/useDfesQuestion.ts:65`
- Test: `src/clients/mobile-web/src/features/logs/hooks/__tests__/useDfesQuestion.refetch.test.ts`

**Interfaces:**
- Consumes: the server behaviour from Task 3
- Produces: `useDfesQuestion` accepts an optional `onAnswered?: () => void` invoked **after** `recordQuestionEvent` resolves; `DayUnderstandingCard` passes a refetch trigger into it.

- [ ] **Step 1: Write the failing test**

```ts
it('notifies the caller after the answer is recorded, so the score can refetch', async () => {
    const onAnswered = vi.fn();
    const { result } = renderHook(() => useDfesQuestion({ farmId, plotId, onAnswered }));

    await act(() => result.current.answer(anOption));

    expect(recordQuestionEvent).toHaveBeenCalled();
    expect(onAnswered).toHaveBeenCalledTimes(1);
});

it('does not notify when recording fails, so the number never moves on a failed write', async () => {
    vi.mocked(recordQuestionEvent).mockRejectedValueOnce(new Error('offline'));
    const onAnswered = vi.fn();
    const { result } = renderHook(() => useDfesQuestion({ farmId, plotId, onAnswered }));

    await act(() => result.current.answer(anOption));

    expect(onAnswered).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src/clients/mobile-web && npx vitest run src/features/logs/hooks/__tests__/useDfesQuestion.refetch.test.ts`
Expected: FAIL — `onAnswered` is not a recognised option

- [ ] **Step 3: Write minimal implementation**

```ts
await recordQuestionEvent(farmId, plotId, selected, outcome, shownAtRef.current);
// Only after the server has the answer — a failed write must never move the
// number, or the farmer is shown a score the server does not agree with.
onAnswered?.();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd src/clients/mobile-web && npx vitest run src/features/logs/hooks/__tests__/useDfesQuestion.refetch.test.ts`
Expected: PASS — 2 tests

- [ ] **Step 5: Commit**

```bash
git add src/clients/mobile-web/src/features/logs
git commit -m "feat(dfes): refetch the day score after an answer is accepted by the server"
```

---

## Task 5: The pull stops erasing the companion's memory

`logsReconciler.ts:70` replaces the whole record. `toDailyLog` rebuilds it from the server DTO alone, so every device-only field is dropped on the **first pull after a successful sync** — not only on a wipe. Two live DFES surfaces read one of those fields.

**Files:**
- Modify: `src/clients/mobile-web/src/features/sync/pull/reconcilers/logsReconciler.ts`
- Test: `src/clients/mobile-web/src/features/sync/pull/reconcilers/__tests__/logsReconciler.preserve.test.ts`

**Interfaces:**
- Produces: no signature change. `reconcileLogs` merges device-only fields from the existing row instead of discarding them.

- [ ] **Step 1: Write the failing test**

```ts
it('preserves the understanding stamp across a pull, so the familiarity counter never regresses', async () => {
    await db.logs.put({
        id: 'log-1', schemaVersion: 22, date: '2026-08-14',
        log: { id: 'log-1', date: '2026-08-14', understanding: { score: 72 } } as DailyLog,
    });

    await reconcileLogs(db, pullPayloadWith({ id: 'log-1' }), plotLookup, new Set());

    const after = await db.logs.get('log-1');
    expect(after!.log.understanding).toEqual({ score: 72 });
});

it('preserves an honest no-work declaration, so the farmer is not punished for it', async () => {
    await db.logs.put({
        id: 'log-3', schemaVersion: 22, date: '2026-08-14',
        log: { id: 'log-3', date: '2026-08-14', dayOutcome: 'NO_WORK_DECLARED' } as DailyLog,
    });

    await reconcileLogs(db, pullPayloadWith({ id: 'log-3' }), plotLookup, new Set());

    const after = await db.logs.get('log-3');
    expect(after!.log.dayOutcome).toBe('NO_WORK_DECLARED');
});

it('preserves a local deletion, so a deleted log does not resurrect', async () => {
    await db.logs.put({
        id: 'log-2', schemaVersion: 22, date: '2026-08-14', isDeleted: 1,
        log: { id: 'log-2', date: '2026-08-14', deletion: { deletedAtISO: 'x' } } as DailyLog,
    });

    await reconcileLogs(db, pullPayloadWith({ id: 'log-2' }), plotLookup, new Set());

    const after = await db.logs.get('log-2');
    expect(after!.log.deletion).toBeDefined();
    expect(after!.isDeleted).toBe(1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src/clients/mobile-web && npx vitest run src/features/sync/pull/reconcilers/__tests__/logsReconciler.preserve.test.ts`
Expected: FAIL — `understanding` is `undefined`; `deletion` is `undefined`

- [ ] **Step 3: Write minimal implementation**

In `reconcileLogs`, after `const existing = await db.logs.get(log.id);` and the freshness check, merge before writing:

```ts
// The server does not know about these fields, so a full replace DESTROYS them
// on the first pull after a successful sync — on the farmer's own phone, with
// no wipe involved. `understanding` feeds meterArrival.ts (Sathi's familiarity
// counter) and closureReceiptProjection.ts; erasing it makes the companion
// forget days the farmer actually logged.
const merged: DailyLog = existing?.log
    ? {
        ...log,
        understanding:     existing.log.understanding     ?? log.understanding,
        fullTranscript:    existing.log.fullTranscript    ?? log.fullTranscript,
        manualTotalCost:   existing.log.manualTotalCost   ?? log.manualTotalCost,
        weatherStamp:      existing.log.weatherStamp      ?? log.weatherStamp,
        phaseAtLogTime:    existing.log.phaseAtLogTime    ?? log.phaseAtLogTime,
        dayNumberAtLogTime: existing.log.dayNumberAtLogTime ?? log.dayNumberAtLogTime,
        deletion:          existing.log.deletion          ?? log.deletion,
        // `toDailyLog` hardcodes 'WORK_RECORDED' (:186). Without this line, a day
        // the farmer honestly declared as no-work comes back from the server as a
        // WORK day with nothing in it — classified UnaccountedDay, earning nothing
        // and eventually breaking his streak. Honesty must not cost him anything
        // (founder ruling 2, 2026-08-14).
        dayOutcome:        existing.log.dayOutcome        ?? log.dayOutcome,
        machinery:         existing.log.machinery?.length         ? existing.log.machinery         : log.machinery,
        activityExpenses:  existing.log.activityExpenses?.length  ? existing.log.activityExpenses  : log.activityExpenses,
        plannedTasks:      existing.log.plannedTasks?.length      ? existing.log.plannedTasks      : log.plannedTasks,
        disturbance:       existing.log.disturbance       ?? log.disturbance,
        meta:              { ...log.meta, ...existing.log.meta },
      }
    : log;

await db.logs.put({
    id: merged.id,
    schemaVersion: VersionRegistry.DB_SCHEMA_VERSION,
    log: merged,
    date: merged.date,
    verificationStatus: merged.verification?.status,
    createdByOperatorId: merged.meta?.createdByOperatorId,
    isDeleted: merged.deletion ? 1 : 0,
    serverModifiedAtUtc: serverModified,
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd src/clients/mobile-web && npx vitest run src/features/sync/pull/`
Expected: PASS — the new file plus every existing pull test, zero failures

- [ ] **Step 5: Commit**

```bash
git add src/clients/mobile-web/src/features/sync/pull
git commit -m "fix(sync): stop the pull from erasing device-only log fields on the farmer's own phone"
```

---

## Task 6: A declared no-work day shows consistency, not a score

Founder ruling 2 — *reward honesty, mark consistency, no score for such days.*

**Most of this already exists and must not be rebuilt.** `RichnessStamper.cs:45-54` already gives a `DeclaredNoWorkDay` `AdvancesBar: false` (no score contribution) while `StreakRules.Default` (`StreakRules.cs:15`) sets `AdvanceOnDeclaredNoWork: true` and `NeutralOnRestDay: true` — an external blocker like rain **advances** the streak, a chosen rest day is **neutral**, and neither breaks it. The domain already rewards honesty exactly as ruled.

What is missing is the **screen**: nothing in `shramsathi/` reads the classification, so a no-work day renders a bare number instead of a consistency message.

**Files:**
- Modify: `src/clients/mobile-web/src/infrastructure/api/resources/DfesResource.ts` (surface `classification` on the DTO)
- Modify: `src/clients/mobile-web/src/features/logs/components/shramsathi/DayUnderstandingCard.tsx`
- Modify: `src/clients/mobile-web/src/i18n/translations.ts`
- Test: `src/clients/mobile-web/src/features/logs/components/shramsathi/__tests__/DayUnderstandingCard.noWork.test.tsx`

**Interfaces:**
- Consumes: `DayUnderstandingDto` gains `classification: string`
- Produces: no new exports

- [ ] **Step 1: Write the failing test**

```tsx
it('shows consistency instead of a number when the farmer honestly declared no work', () => {
    render(<DayUnderstandingCard {...props} />, {
        wrapper: withDayUnderstanding({ score: 0, classification: 'DeclaredNoWorkDay', streak: 6 }),
    });

    expect(screen.queryByTestId('day-understanding-value')).toBeNull();
    expect(screen.getByTestId('day-understanding-nowork')).toBeInTheDocument();
});

it('still shows the number on an ordinary work day', () => {
    render(<DayUnderstandingCard {...props} />, {
        wrapper: withDayUnderstanding({ score: 6, classification: 'BasicWorkDay', streak: 6 }),
    });

    expect(screen.getByTestId('day-understanding-value')).toHaveTextContent('6');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src/clients/mobile-web && npx vitest run src/features/logs/components/shramsathi/__tests__/DayUnderstandingCard.noWork.test.tsx`
Expected: FAIL — the number renders regardless of classification

- [ ] **Step 3: Write minimal implementation**

```tsx
// Founder ruling 2 (2026-08-14): a day the farmer honestly declared as no-work
// earns NO score — showing him a 0 would punish the honesty we are trying to
// build. His consistency is what we acknowledge instead. The streak itself is
// already preserved server-side (StreakRules.AdvanceOnDeclaredNoWork).
if (data.classification === 'DeclaredNoWorkDay') {
    return (
        <SurfaceSection tone="calm">
            <p data-testid="day-understanding-nowork">{t('dfes.noWorkDayAcknowledged')}</p>
            <p>{t('dfes.consistencyKept', { days: data.streak })}</p>
        </SurfaceSection>
    );
}
```

Marathi copy (founder-supplied register — no score words, no judgement):

```ts
noWorkDayAcknowledged: 'आज काम नाही — तुम्ही सांगितलं, मी नोंदवलं.',
consistencyKept: 'सलग {days} दिवस तुम्ही न चुकता सांगताय.',
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd src/clients/mobile-web && npx vitest run src/features/logs/components/shramsathi/`
Expected: PASS — new file plus every existing shramsathi test

- [ ] **Step 5: Commit**

```bash
git add src/clients/mobile-web/src
git commit -m "feat(dfes): acknowledge an honest no-work day with consistency, never a score"
```

---

## Task 7: Questions speak the context they already know

Founder ruling 3. The engine **already receives** weather (`DailyQuestionInputs.weather`), crop stage, a schedule gap, an open observation and a weather-reconcile signal (`dfesQuestionEngine.ts:61-75`), and it uses them to **choose** which question to ask. But `resolvePrompt` (`:107-112`) substitutes only `{crop}`, `{observation}` and `{category}` — so the chosen question still **speaks** generically. Weather is packed into `SelectedQuestion.weatherContext` (`:119`) and never reaches the farmer's ear. There is no previous-log input at all.

**Files:**
- Modify: `src/clients/mobile-web/src/features/logs/services/dfesQuestionEngine.ts`
- Modify: `src/clients/mobile-web/src/features/logs/services/dfesQuestionBank.ts` (prompt copy)
- Test: `src/clients/mobile-web/src/features/logs/services/__tests__/dfesQuestionEngine.context.test.ts`

**Interfaces:**
- Produces: `DailyQuestionInputs` gains `previousLog?: { activityMr: string; daysAgo: number }`. `resolvePrompt` gains `{weather}`, `{lastActivity}`, `{daysAgo}`.

- [ ] **Step 1: Write the failing test**

```ts
it('speaks the weather it already used to choose the question', () => {
    const picked = selectDailyQuestion(inputsWith({
        weather: { conditionText: 'पाऊस' },
    }));

    expect(picked!.resolvedPromptMr).toContain('पाऊस');
});

it('refers to what the farmer did last time', () => {
    const picked = selectDailyQuestion(inputsWith({
        previousLog: { activityMr: 'फवारणी', daysAgo: 3 },
    }));

    expect(picked!.resolvedPromptMr).toContain('फवारणी');
});

it('never leaves an unfilled token visible to the farmer', () => {
    const picked = selectDailyQuestion(inputsWith({ weather: undefined, previousLog: undefined }));

    expect(picked!.resolvedPromptMr).not.toMatch(/\{[a-zA-Z]+\}/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src/clients/mobile-web && npx vitest run src/features/logs/services/__tests__/dfesQuestionEngine.context.test.ts`
Expected: FAIL — tokens are not substituted; the third test fails on a leftover `{weather}`

- [ ] **Step 3: Write minimal implementation**

```ts
/**
 * Resolve the Marathi prompt against everything the engine already knows.
 *
 * Founder ruling 3 (2026-08-14): a question must be context-rich, not generic.
 * The engine has always USED weather and stage to pick the question; it never
 * SPOKE them. It does now.
 *
 * Every token is stripped when its context is absent — a farmer must never see
 * a raw `{weather}`, and a sentence that reads oddly without its clause is a
 * copy problem to fix in the bank, not a reason to print a placeholder.
 */
function resolvePrompt(promptMr: string, inputs: DailyQuestionInputs): string {
    return promptMr
        .replace('{crop}', inputs.crop)
        .replace('{observation}', inputs.openObservation?.summary ?? '')
        .replace('{category}', inputs.scheduleContext?.categoryLabelMr ?? '')
        .replace('{weather}', inputs.weather?.conditionText ?? '')
        .replace('{lastActivity}', inputs.previousLog?.activityMr ?? '')
        .replace('{daysAgo}', inputs.previousLog ? String(inputs.previousLog.daysAgo) : '')
        .replace(/\s{2,}/g, ' ')
        .replace(/\s+([,.?!])/g, '$1')
        .trim();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd src/clients/mobile-web && npx vitest run src/features/logs/services/`
Expected: PASS

- [ ] **Step 5: Rewrite the prompts to use the context**

The mechanism is worthless without copy that uses it. Each of the 16 `promptMr` strings is rewritten to reference weather and/or the previous log where the question genuinely depends on it. Example shape — **not to be shipped without founder approval of the Marathi**:

- before: `'फवारणी किती प्रमाणात केली?'`
- after: `'{daysAgo} दिवसांपूर्वी {lastActivity} केली होती — आज {weather} आहे. प्रमाण किती ठेवलं?'`

**This step produces a draft for founder review, not final copy.** Write the 16 drafts to `G:\VALIDATION\shram-sathi-context-rich-prompts.md` and stop. The founder's agronomist reshaped the current wording; the context-rich rewrite must go back through the same eyes.

- [ ] **Step 6: Commit the mechanism (not the unreviewed copy)**

```bash
git add src/clients/mobile-web/src/features/logs/services/dfesQuestionEngine.ts src/clients/mobile-web/src/features/logs/services/__tests__/dfesQuestionEngine.context.test.ts
git commit -m "feat(dfes): let a question speak the weather and previous log it already knows"
```

---

## Task 8: Make the work visible in production

**Files:**
- Modify: `src/clients/mobile-web/.env.production.example`
- Modify: `_COFOUNDER/Projects/AgriSync/Operations/DEPLOYMENT_TRACKER.md`

**Interfaces:**
- Consumes: Tasks 1–6 complete and green
- Produces: a documented flag set the deploy environment must supply

- [ ] **Step 1: Document the seven flags**

```dotenv
# --- DFES / Shram Sathi companion (Track C) -------------------------------
# All default OFF. Set to 1 ONLY after the Founder Acceptance Gate is ticked.
# Turning these on is what makes the companion visible to farmers.
VITE_UNDERSTANDING_METER=0
VITE_STAGE_QUESTIONS=0
VITE_DISCIPLINE_SYSTEM=0
VITE_VOICE_CONTINUITY=0
VITE_DAILY_LOOP=0
VITE_INTELLIGENCE_INSIGHTS=0
VITE_TASK_CLOSE_CONFIRM=0
```

- [ ] **Step 2: Run the full gate**

Run: `dotnet test src/AgriSync.sln` then `cd src/clients/mobile-web && npx vitest run`
Expected: exit 0 on both. Re-run any timeout-flagged frontend file in isolation before accepting a failure as real — this suite produces load-induced 5s timeouts under memory pressure.

- [ ] **Step 3: Add the deployment tracker row**

One row naming the branch, the flag set, and `PENDING` for the prod `/version` SHA.

- [ ] **Step 4: Commit**

```bash
git add src/clients/mobile-web/.env.production.example
git commit -m "chore(dfes): document the seven companion flags for the production build"
```

---

## Founder Acceptance Gate — must be ticked before any deploy step

Founder ruling 4 = **B**: calibration happens *after* the pilot starts, so it is no longer a launch gate.

- [ ] **Gate A — context-rich Marathi approved.** The 16 rewritten prompts from Task 7 Step 5 go back through the founder's agronomist. **Blocks Task 7 Step 5 only** — the other tasks ship without it, with the current approved wording.
- [ ] **Gate B — pilot roster.** Founder names the 10–20 farmers. Ruling 1 = C.
- [ ] **Gate C — merge verdict.** `feat-dfes-companion.md` branch manifest `Merge verdict` flipped from `NO` to `YES` by the founder.
- [ ] **Gate D — flags on.** Founder authorises which of the seven flags go to `1` in the production environment.

### After the pilot is live

- [ ] **Calibration sitting.** Founder grades ~20 real days against the number; target `9` is confirmed or changed. Until this happens, `9` is an engineering guess and must be described that way in any founder-facing report.

## Deployment

- [ ] **Deploy via the `/deploy` plugin** (never hand-rolled — founder ruling 2026-07-13).
- [ ] **Record prod evidence:** `/version` SHA and HTTP status in `DEPLOYMENT_TRACKER.md`.
- [ ] **Rebuild the APK.** The Android build bundles web assets at build time; a web deploy never reaches existing APK users. Run `android-release.yml` after the web deploy is prod-proven.

---

## Explicitly out of scope

The `feat/server-authoritative-architecture` branch documents ~50 further defects (`docs/superpowers/specs/2026-08-14-PHASE-A-DATA-OWNERSHIP-MATRIX.md` on that branch). **Three were verified to also exist here and are fixed above:** §4.1 field destruction and §4.3 deletion resurrection (Task 5), and the `dayOutcome: 'WORK_RECORDED'` hardcode at `logsReconciler.ts:186` (Task 5, pulled in by founder ruling 2).

**The remainder are a separate programme and are not addressed here** — harvest sales never persisted, income stored as expenditure, plaintext voice clips, orphaned media, no presigned upload path.

### Accepted risk, not fixed: shared-handset exposure (that document's §4.8)

The client has no per-farmer localStorage namespace, does not clear it on logout, and never deletes a database. On a handset shared between two farmers, the second can see the first's harvest, procurement and finance data.

**Founder ruling 1 (2026-08-14):** *"this does not happen that a farmer shares phone — if that is the case we are not building this app for them."* The target user owns his handset; a sharing household is outside the product's segment.

This is recorded as an **accepted risk with a segment boundary**, not a resolved defect. The code path is unchanged. Two consequences follow and should be revisited if either becomes false:
1. The pilot roster (Gate B) must be farmers who own their handset — which ruling 1 already asserts.
2. If the product later targets FPO/FPC shared devices or a family plan, this becomes a launch blocker again and must be re-opened before that segment is enabled.
