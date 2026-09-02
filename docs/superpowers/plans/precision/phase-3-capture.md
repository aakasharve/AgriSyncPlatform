# Phase 3 — Capture, at implementation precision

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or
> superpowers:executing-plans. Execute task-by-task; every `- [ ]` is binary.
>
> **Authorities, in order (later wins):**
> 1. `docs/superpowers/mockups/2026-09-01-labour-r1/DECISIONS-2026-09-02-founder-master-review.md`
> 2. `docs/superpowers/plans/2026-09-01-labour-v2-r1-human-execution-layer.md` (Global Constraints + Phase 3 + the 2026-09-02 additions)
> 3. `docs/superpowers/plans/2026-09-01-labour-v2-r1-PHASE0-FINDINGS.md` (file:line ground truth — re-verified for this rewrite; corrected anchors are noted inline)
> 4. `docs/superpowers/plans/2026-09-01-labour-v2-r1-REVISION-1.md` — the nine settled product questions are FENCED; nothing here reopens one.

**Branch:** `feat/labour-v2-r1`. Nothing merges to `main` without the founder gate.

**Every file:line below was re-verified on this branch on 2026-09-02.** Corrections against
the earlier plan text: the labour door is `simpleRoutes.tsx:84-91` (plan said 83-89), the hub
hero button is `LabourHub.tsx:325` (plan said 325-334 — the `<button onClick={onGoToLog}` opens
at :325), the auto-submit effect is `AppRouter.tsx:214-228` with its founder-ruling comment at
:194-213, the generic-confirm branch is `mainView.tsx:480-499` (`hasActiveLogContext ?` at :480,
`attendanceOnly` at :497), the fake save is `LabourFeature.tsx:196`, its button `Attendance.tsx:103`,
and handler DI lives in `ShramSafal.Api/DependencyInjection.cs` (`AddCostEntryHandler` at :148),
**not** `ShramSafal.Infrastructure/DependencyInjection.cs` as Phase 0's step 11 said.

---

## Phase-3 Change Surface

- **DB:** ONE migration of its own — Task 3.6's `AddEngagedThroughToLabourAssignments`
  (nullable FK column + index on the SHIPPED `ssf.labour_assignments`; no GRANT — Postgres
  privileges are per-table; no RLS change — policies name tables and rows, not columns;
  the mandatory guard is the APPLICATION farm check, per Phase 0 UNKNOWN 1). For
  attendance itself: none. Phase 3 *consumes* the Phase 2 Task 2.5 edit of the unshipped
  `20260831180408`/`20260831185516` migrations (verified unshipped again for this rewrite:
  `git log origin/main -- "*AddAttendanceMarks*"` → empty). Phase 3 adds **no** migration, no
  RLS, no GRANT — the creating migration already ships ENABLE+FORCE RLS (`20260831180408:52-53`),
  both policies (:55-76) and grants (:86-97). The corrections table is append-only **via GRANT**
  (SELECT+INSERT only, `20260831185516`) and Phase 3 never touches that.
- **Backend:** one new use case (`RecordAttendanceMark`), one sync dispatch case + handler
  method in `PushSyncBatchHandler`, the crew-link domain member + factory/handler
  pass-through (Task 3.6), two new port members (throwing / staged default bodies),
  two repository implementations, one pull-carriage extension, one DI registration, one
  architecture pin.
- **Frontend:** anchor gate (labourAnchor.ts + LabourHub + simpleRoutes), ladder + copy modules,
  `AttendanceResult.tsx`, deletion of the AppRouter auto-submit, `MarkAttendanceCommand`,
  Dexie **v25**, pull reconciler, `EditSurfaceRegistry` row, real save for `Attendance.tsx`,
  deletion of the `जतन झाले` lie.
- **Cross-cutting:** sync-contract (`mutation-types.json` + `attendance_mark.zod.ts` +
  regenerated catalogs), parity/catalog test constants, `RejectionPolicy` code list.

**Ordering (hard):** Task 3.5a MAY NOT start until Phase 2 Task 2.5 has landed the hours
columns + `HoursBasis` on the unshipped migration and domain — a wire contract behind
`PayloadHasOnly` + the parity gate + `sinceVersion` is far harder to widen than a table
(Phase 0 STEP 0). Tasks 3.1–3.4b have no Phase 2 dependency and may run first.
Task 3.6 (the crew link) is independent of 2.5 but MUST land before Phase 4 Task 1 —
Phase 4's crew rows consume `LabourAssignment.EngagedThroughFieldOperatorId`.

**Hard rules that void this phase if broken** (from the Global Constraints; restated, not
replaced): the हजेरी ledger is never gated by capture state; no farmer-facing permission
vocabulary; the register stays clean (no money, no totals — Phase 4's concern, but nothing
here may feed it money); never compute money or day-fractions; blank(unknown) ≠ absent
(`Unmarked` is a fourth state, wire absence = Unmarked, never a guess); offline intent is
never rendered as saved — **P10: acknowledged = reconstructable without the originating
device**; the shared mic shell and the existing `ShramSathiUnderstanding` processing screen
(`features/logs/components/shramsathi/ShramSathiUnderstanding.tsx`, rendered at
`mainView.tsx:654` under `FEATURE_FLAGS.dailyLoop`) are REUSED, never rebuilt; no R1 read
path consumes `AttendanceMark.Value`.

---

## Interfaces

### PRODUCED by Phase 3 (other phases build on these)

**Wire / contract**
- Sync mutation `attendance.mark` — descriptor
  `{ "name": "attendance.mark", "ownerAggregate": "AttendanceMark", "sinceVersion": "0.9.0", "payloadSchema": "AttendanceMark" }`
  in `sync-contract/schemas/mutation-types.json`; generated `SyncMutationName.AttendanceMark`
  ( = `"attendance.mark"`) in both generated catalogs.
- `AttendanceMarkPayload` (zod, `sync-contract/schemas/payloads/attendance_mark.zod.ts`):
  `{ attendanceMarkId: ZGuid, farmId: ZGuid, fieldOperatorId: ZGuid, workDate: 'YYYY-MM-DD', dayMark?: 'Full'|'Half'|'Absent', nightMark?: 'Worked'|'NotWorked', hoursWorked?: number>0, extraHours?: number>0, resolvedLabourAssignmentId?: ZGuid }`
  — absent enum key = `Unmarked` ("nobody said"), by design. Generated C# sibling
  `AttendanceMarkPayload.cs`.
- Sync failure code **`ShramSafal.AttendanceContradiction`** (PERMANENT in `RejectionPolicy`).

**Backend (namespace `ShramSafal.Application.UseCases.Labour.RecordAttendanceMark`)**
```csharp
public enum AttendanceDayOutcome { Recorded = 0, Contradicted = 1 }

public sealed record DayFactCandidate(
    Guid LabourAssignmentId, string? Task, string? PlotName, DayMark Day, NightMark Night);

public sealed record AttendanceDayContradiction(
    Guid FieldOperatorId, string DisplayNameAtAttach, DateOnly WorkDate,
    IReadOnlyList<DayFactCandidate> Candidates);

public sealed record RecordAttendanceMarkResult(
    AttendanceDayOutcome Outcome, Guid? AttendanceMarkId, AttendanceDayContradiction? Contradiction);

public sealed record RecordAttendanceMarkCommand(
    Guid AttendanceMarkId, Guid FarmId, Guid FieldOperatorId, DateOnly WorkDate,
    DayMark Day, NightMark Night, decimal? HoursWorked, decimal? ExtraHours,
    Guid? ResolvedLabourAssignmentId, Guid RecordedByUserId);

public sealed class RecordAttendanceMarkHandler(
    IShramSafalRepository repository, IIdGenerator idGenerator, IClock clock)
{
    public Task<Result<RecordAttendanceMarkResult>> HandleAsync(
        RecordAttendanceMarkCommand command, CancellationToken ct = default);
}
```
- Port members on `IShramSafalRepository` (both with **default bodies**, per the 28-implementor rule):
```csharp
public sealed record AttendanceEngagementFact(Guid LabourAssignmentId, string? Task, LabourShift? Shift);

Task<IReadOnlyList<AttendanceEngagementFact>> GetAttendanceEngagementFactsAsync(
    FarmId farmId, Guid fieldOperatorId, DateOnly workDate, CancellationToken ct = default)
    => throw new NotSupportedException(...);   // throwing — "no contradiction" is a positive claim

Task AddAttendanceMarkCorrectionAsync(AttendanceMarkCorrection correction, CancellationToken ct = default)
    => throw new NotSupportedException(...);   // staged add, no SaveChanges (caller commits)

Task<List<AttendanceMark>> GetAttendanceMarksChangedSinceAsync(
    IEnumerable<Guid> farmIds, DateTime sinceUtc, CancellationToken ct = default)
    => Task.FromResult(new List<AttendanceMark>());  // pull carriage; empty default mirrors GetFinanceCorrectionsChangedSinceAsync(:174-175)
```
- Pull carriage: `AttendanceMarkDto(Guid Id, Guid FarmId, Guid FieldOperatorId, string WorkDate, string? DayMark, string? NightMark, decimal? HoursWorked, decimal? ExtraHours, string? HoursBasis, Guid RecordedByUserId, DateTime RecordedAtUtc, DateTime ModifiedAtUtc)`
  carried as `IReadOnlyList<AttendanceMarkDto> AttendanceMarks` on `SyncPullResponseDto`
  (inserted after `JobCards`, before `DegradedComponents`).

**Crew link (Task 3.6 — Phase 4's crew aggregate rows consume THESE, exactly)**
```csharp
Guid? LabourAssignment.EngagedThroughFieldOperatorId { get; }   // null = nobody said through whom — never "no mukadam"
// trailing optional on BOTH factories (repo idiom LabourAssignment.cs:142-144):
static LabourAssignment LabourAssignment.Create(..., string? costSpokenText = null,
    Guid? engagedThroughFieldOperatorId = null)
static LabourAssignment LabourAssignmentFactory.FromParsed(..., string? costSpokenText = null,
    Guid? engagedThroughFieldOperatorId = null)
// DB (NEW migration — ssf.labour_assignments SHIPPED 2026-06-29, edit-in-place is not licensed):
ssf.labour_assignments.engaged_through_field_operator_id  uuid NULL
    REFERENCES ssf.field_operators("Id") ON DELETE RESTRICT   // + ix_labour_assignments_engaged_through
```
- zod: `LabourItemSchema` (create_daily_log payload) gains `engagedThroughFieldOperatorId: ZGuid.optional()`
  appended LAST, so the regenerated `LabourItem` record gains a trailing
  `Guid? EngagedThroughFieldOperatorId = null` and every existing construction keeps compiling.

**Frontend**
- `features/labour/labourAnchor.ts`:
  `type LabourAnchor = { state: 'anchored'; headcount: number; logId: string } | { state: 'no-anchor' }`;
  `resolveLabourAnchor(history: readonly DailyLog[], todayKey: string): LabourAnchor`.
- `features/labour/attendanceCopy.ts`: `ATTENDANCE_COPY` (all founder-approved strings, listed in Task 3.2).
- `features/labour/attendanceLadder.ts`: `selectLadderRung({ anchorHeadcount, spokenCount, workerNames }): 1|2|3|4`.
- `features/labour/attendanceContradiction.ts`:
  `findDayContradictions(events: readonly LabourEvent[]): DayContradiction[]` with
  `type DayContradiction = { name: string; facts: Array<{ shift: 'full'|'half'|'night'; sourceEventId: string }> }`.
- `features/labour/components/AttendanceResult.tsx` — props in Task 3.4b.
- `application/usecases/sync/MarkAttendanceCommand.ts`:
  `MarkAttendanceCommand.enqueue(payload: AttendanceMarkPayload): Promise<string>` (value-keyed `clientRequestId`, Task 3.5c).
- Dexie **v25** store `attendanceMarks: 'id, farmId, workDate, [farmId+workDate]'` +
  `AttendanceMarkCacheRecord { id; farmId; fieldOperatorId; workDate; payload: AttendanceMarkDto; updatedAt: string }`.
- `features/labour/data/attendanceLocal.ts`:
  `getLocalAttendanceMarks(farmId: string): Promise<LocalAttendanceMark[]>` where
  `type LocalAttendanceMark = { fieldOperatorId: string; workDate: string; dayMark?: string; nightMark?: string; hoursWorked?: number; extraHours?: number; source: 'server' | 'queue' }`
  — **`source: 'queue'` is unsynced intent; Phase 4's register must render it with the existing
  unsynced treatment, never as saved.** (Phase 4 consumes this + the pull carriage.)
- `EditSurfaceRegistry`: route union gains `'labour'`; `attendance.mark` registered to it.
- `Attendance.tsx` props change: `onSave: (marks: ManualAttendanceMark[]) => void` with
  `type ManualAttendanceMark = { fieldOperatorId: string; status: PresenceStatus }` (exported from `Attendance.tsx`).

### CONSUMED from other phases / existing code

- **Phase 2 Task 2.5** (blocking for 3.5a-d only):
  `AttendanceMark.Create(Guid id, FarmId farmId, Guid fieldOperatorId, DateOnly workDate, DayMark day, NightMark night, UserId recordedByUserId, DateTime recordedAtUtc, decimal? hoursWorked = null, decimal? extraHours = null, LabourTimeBasis hoursBasis = LabourTimeBasis.Unspecified)`;
  `AttendanceMark.Amend(DayMark day, NightMark night, decimal? hoursWorked, decimal? extraHours, LabourTimeBasis hoursBasis, UserId amendedByUserId, DateTime amendedAtUtc)` returning
  `AttendanceMarkPreviousValues(DayMark Day, NightMark Night, decimal? HoursWorked, decimal? ExtraHours, LabourTimeBasis HoursBasis)`;
  properties `HoursWorked`, `ExtraHours`, `HoursBasis`; correction constants
  `AttendanceMarkCorrection.HoursWorkedField = "hours_worked"`, `.ExtraHoursField = "extra_hours"`,
  `AttendanceMarkCorrection.FormatHours(decimal hours, LabourTimeBasis basis)` (→ `"3.5|Explicit"`)
  and the per-field-nullable `AttendanceMarkCorrection.Create` (hours fields may carry a null
  original). `Amend` takes the basis positionally; the `RecordAttendanceMarkHandler` call site
  passes the same basis it derives for `Create` (Explicit when hours are stated, else Unspecified).
  Amend REFUSES null-ing a present hours value (`ArgumentException`) — R1 ships no un-say path;
  the handler maps that refusal to `InvalidCommand`, never a 500 (see 3.5b.3).
- **Phase 2 Tasks 2.1/2.2:** `LabourManagementGate.IsAllowedAsync(IShramSafalRepository repository, Guid farmId, Guid userId, DateTime nowUtc, CancellationToken ct = default)`
  — the POST-2.2 signature (Phase 2 executes first and threads the clock through every call
  site). `RecordAttendanceMarkHandler` passes `clock.UtcNow` from its injected `IClock`,
  exactly as Phase 2's Task 2.2 interface note prescribes for this seventh call site.
- Existing: `EstablishFarmScopeForDerivationAsync` (`PushSyncBatchHandler.cs:1088` — private,
  same file as the new handler method), `PayloadHasOnly`/`DeserializePayload` idiom
  (`:1513-1524` region of `HandleAddCostEntryAsync`, which starts at :1497), commit point
  `repository.SaveChangesAsync` (`AddCostEntryHandler.cs:213`; port `IShramSafalRepository.cs:298`),
  `GetAttendanceMarkAsync`/`AddAttendanceMarkAsync`/`GetAttendanceMarksForFarmInWindowAsync`
  (`IShramSafalRepository.cs:919-938`, impls `ShramSafalRepository.cs:1577-1610` — note the
  file is `Persistence/Repositories/ShramSafalRepository.cs`), `GetFieldOperatorByIdAsync`
  (`:847-848`), cross-farm guard idiom (`AttachFieldOperatorHandlerTests`/`AttachFieldOperatorHandler.cs:100-118`),
  agreement idiom (`GetLabourDataHandler.cs:602-612`), `toAttendanceOnlyDraft`
  (`features/logs/attendanceDraft.ts:46-66`), `resolveLabourHeadcount` (`domain/logs/labourHeadcount.ts:62`),
  `mutationQueue.enqueue` (`MutationQueue.ts:101-105`), `fetchFieldOperators` + `FieldOperator`
  (`fieldOperatorClient.ts:90-131`), `syncTranslations.mr.onPhone` = `लक्षात ठेवलं ✓`
  (`i18n/syncTranslations.ts:233`), `ShramSathiUnderstanding` (mainView import :67, render :654).

All frontend paths below are relative to `src/clients/mobile-web/src/`; backend paths to
`src/apps/ShramSafal/`; tests to `src/tests/`. Frontend test command:
`cd src/clients/mobile-web && npx vitest run <file>`; backend:
`dotnet test src/tests/<project>/<project>.csproj --filter "FullyQualifiedName~<name>"`.

---

## Task 3.1 — The labour mic anchor gate

The Labour mic is a verification instrument: no explicit labour anchor → no mic. **Anchor
(client mirror of the server rule):** a non-deleted log dated today whose
`verification.status` is neither `DRAFT` nor `PENDING` (the client's two "nobody accepted
this yet" states — the server rule is `CurrentVerificationStatus != Draft`,
`Logs/DailyLog.cs:106-111`) AND whose labour carries a stated headcount
(`resolveLabourHeadcount` non-null — mirrors `LabourAssignment.WorkerCount:63`). A Draft log
carrying a parsed 12 is NOT an anchor. A log with no `verification` record is NOT an anchor —
unknown is not accepted (trust rule 3). The Task 0.4-Q5 fallback (`headcount_certainty`
columns) is NOT taken: the confirm screen shows the farmer the headcount (the ManualEntry
labour bucket renders `count`), so the CTO anchor from REVISION-1 stands.

**The gate disables ONLY the recorder** (Correction 11 / final direction §7): the hero goes
inactive with the approved reason; the route, hub, हजेरी वही tile and `HajeriLedger` are
untouched. The no-work-day door (`काम झालं नाही, पण मजूर आले`) is Phase 4 Task 4.2; the
anchor type deliberately stays a two-state union so Phase 4 adds its entry without reshaping.

**Files**
- Create: `features/labour/labourAnchor.ts`
- Create: `features/labour/attendanceCopy.ts` (started here, extended in 3.2/3.3)
- Create: `features/labour/__tests__/labourAnchor.test.ts`
- Modify: `features/labour/components/LabourHub.tsx` — props `interface Props` at :53,
  hero button at :325
- Modify: `features/labour/components/LabourFeature.tsx` — hub mount at :161-176
- Modify: `core/navigation/simpleRoutes.tsx` — `onGoToLog` at :84-91
- Modify: `features/labour/components/__tests__/LabourHub.test.tsx`,
  `core/navigation/__tests__/labour-log-intent.test.tsx`

**Interfaces** — Produces `LabourAnchor`, `resolveLabourAnchor`, `ATTENDANCE_COPY.noAnchorReason`.
Consumes `DailyLog`/`LogVerificationStatus` (`domain/types/log.types.ts:723,582`),
`resolveLabourHeadcount`, `getDateKey` (`core/domain/services/DateKeyService`).

**Steps**

- [ ] **3.1.1 — failing test.** Write `features/labour/__tests__/labourAnchor.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { LogVerificationStatus, type DailyLog } from '../../../domain/types/log.types';
import { resolveLabourAnchor, NO_ANCHOR_TEST_IDS } from '../labourAnchor';

const TODAY = '2026-09-02';

function log(partial: Partial<DailyLog>): DailyLog {
    return {
        id: 'log-1', date: TODAY,
        context: { selection: [] },
        dayOutcome: 'WORK_RECORDED',
        cropActivities: [], irrigation: [], labour: [], inputs: [], machinery: [],
        financialSummary: { totalLabourCost: 0, totalInputCost: 0, totalMachineryCost: 0, grandTotal: 0 },
        ...partial,
    } as DailyLog;
}
const confirmed = { status: LogVerificationStatus.CONFIRMED, required: false };
const labour12 = [{ id: 'l1', type: 'hired', count: 12 } as DailyLog['labour'][number]];

describe('resolveLabourAnchor — the mic is a verification instrument', () => {
    it('a Draft log carrying a parsed 12 is NOT an anchor', () => {
        const h = [log({ labour: labour12, verification: { status: LogVerificationStatus.DRAFT, required: true } })];
        expect(resolveLabourAnchor(h, TODAY).state).toBe('no-anchor');
    });
    it('the same log after confirmation IS the anchor, headcount carried forward', () => {
        const h = [log({ labour: labour12, verification: confirmed })];
        expect(resolveLabourAnchor(h, TODAY)).toEqual({ state: 'anchored', headcount: 12, logId: 'log-1' });
    });
    it('a confirmed log whose labour never stated a count is NOT an anchor (unknown is not zero)', () => {
        const h = [log({ labour: [{ id: 'l1', type: 'hired' } as DailyLog['labour'][number]], verification: confirmed })];
        expect(resolveLabourAnchor(h, TODAY).state).toBe('no-anchor');
    });
    it('a log with no verification record is NOT an anchor (unknown is not accepted)', () => {
        expect(resolveLabourAnchor([log({ labour: labour12 })], TODAY).state).toBe('no-anchor');
    });
    it("yesterday's confirmed log does not anchor today", () => {
        const h = [log({ date: '2026-09-01', labour: labour12, verification: confirmed })];
        expect(resolveLabourAnchor(h, TODAY).state).toBe('no-anchor');
    });
    it('a deleted log does not anchor', () => {
        const h = [log({ labour: labour12, verification: confirmed, deletion: { deletedAtISO: 't', deletedByOperatorId: 'o', reason: 'r' } })];
        expect(resolveLabourAnchor(h, TODAY).state).toBe('no-anchor');
    });
    it('two confirmed engagements sum their STATED counts only', () => {
        const h = [
            log({ id: 'a', labour: labour12, verification: confirmed }),
            log({ id: 'b', labour: [{ id: 'l2', type: 'hired', count: 4 } as DailyLog['labour'][number], { id: 'l3', type: 'hired' } as DailyLog['labour'][number]], verification: confirmed }),
        ];
        expect(resolveLabourAnchor(h, TODAY)).toEqual({ state: 'anchored', headcount: 16, logId: 'a' });
    });
    it('exports stable test ids for the hub gate assertions', () => {
        expect(NO_ANCHOR_TEST_IDS.reason).toBe('labour-no-anchor-reason');
    });
});
```

- [ ] **3.1.2 — see it fail.** `cd src/clients/mobile-web && npx vitest run src/features/labour/__tests__/labourAnchor.test.ts`
  → expected: `Failed to resolve import "../labourAnchor"`.

- [ ] **3.1.3 — implement.** Create `features/labour/attendanceCopy.ts`:

```ts
/**
 * Labour V2 R1 — the founder-approved farmer-facing strings for the capture
 * flow, harvested verbatim from his 2026-09-02 master review
 * (docs/superpowers/mockups/2026-09-01-labour-r1/DECISIONS-2026-09-02-founder-master-review.md)
 * and the D1–D3-locked mockups. NO OTHER farmer-facing Marathi may be invented
 * on these surfaces; a missing string is a founder question, never a guess.
 * Numerals follow his convention: Latin digits (DM Sans) for quantities.
 */
export const ATTENDANCE_COPY = {
    /** State B — the reason under the inactive hero. Not a permission word anywhere. */
    noAnchorReason: 'आजच्या कामात किती जण होते ते अजून समजलं नाही. आधी आजचं काम सांगा.',
    understoodHeading: 'ShramSafalला समजलं',
    /** D9.5 provenance chips. */
    youSaidChip: 'तुम्ही सांगितलं',
    explicitChip: 'स्पष्ट माहिती',
    /** Rung 2 — count known, nobody named (mockup 05, locked as drawn). */
    rungWho: (n: number) => `या ${n} जणांमध्ये कोण होते?`,
    /** Rung 3 — remainder (founder harvest, supersedes the mockup's unapproved line). */
    rungRemainder: 'यांच्याशिवाय अजून कोण होते?',
    /** Rung 4 — the only question left (founder harvest). */
    rungConfirm: 'हे बरोबर आहे का?',
    /** Pre-save honesty line (founder harvest). */
    preSaveHonesty: '"बरोबर" दाबेपर्यंत काहीही जतन होणार नाही.',
    confirmButton: 'बरोबर',
    editButton: 'बदल करा',
    /** State D — the contradiction question (founder harvest + mockup 04). */
    contradictionTitle: 'एक गोष्ट स्पष्ट करा',
    contradictionBody: (name: string, first: string, second: string) =>
        `${name} आज दोन कामांत दिसतोय — एकात ${first}, दुसऱ्यात ${second}. आजची हजेरी कोणती?`,
    contradictionReassurance: 'एकदाच स्पष्ट करा; दोन्ही कामांच्या नोंदी तशाच राहतील.',
    /** Approved mark vocabulary — the only words the contradiction slots may hold. */
    markWord: { full: 'पूर्ण', half: 'अर्धा', night: 'रात्र' } as const,
} as const;
```

  Create `features/labour/labourAnchor.ts`:

```ts
/**
 * Labour V2 R1 Task 3.1 — the labour mic anchor.
 *
 * "Labour mic is a verification instrument. No explicit labour anchor → no
 * mic." (Global Constraints.) The anchor is the CLIENT mirror of the server
 * rule — DailyLog.CurrentVerificationStatus != Draft AND a stated
 * LabourAssignment.WorkerCount — expressed over the local history the hub
 * already receives. It gates ONLY the recorder: never the Labour route, the
 * hub, the हजेरी वही tile, or HajeriLedger (Correction 11).
 *
 * The two-state union is deliberate: Phase 4's explicitly-entered no-work-day
 * flow ("काम झालं नाही, पण मजूर आले") ADDS its own entry without reshaping this.
 */
import { LogVerificationStatus, type DailyLog } from '../../domain/types/log.types';
import { resolveLabourHeadcount } from '../../domain/logs/labourHeadcount';

export type LabourAnchor =
    | { state: 'anchored'; headcount: number; logId: string }
    | { state: 'no-anchor' };

export const NO_ANCHOR_TEST_IDS = { reason: 'labour-no-anchor-reason' } as const;

/** The client's "nobody accepted this yet" statuses. Everything else — V2
 *  CONFIRMED/VERIFIED/DISPUTED/CORRECTION_PENDING and the V1 approved tiers —
 *  is a human having taken the count on. */
const UNACCEPTED = new Set<LogVerificationStatus>([
    LogVerificationStatus.DRAFT,
    LogVerificationStatus.PENDING,
]);

export function resolveLabourAnchor(
    history: readonly DailyLog[], todayKey: string,
): LabourAnchor {
    let headcount = 0;
    let anchorLogId: string | null = null;
    for (const log of history) {
        if (log.date !== todayKey || log.deletion) continue;
        const status = log.verification?.status;
        // No verification record = unknown = not accepted (rule 3: unknown is not zero).
        if (!status || UNACCEPTED.has(status)) continue;
        const stated = log.labour
            .map((e) => resolveLabourHeadcount(e))
            .filter((n): n is number => n != null);
        if (stated.length === 0) continue; // labour with no stated count anchors nothing
        headcount += stated.reduce((a, b) => a + b, 0);
        anchorLogId = anchorLogId ?? log.id;
    }
    return anchorLogId ? { state: 'anchored', headcount, logId: anchorLogId } : { state: 'no-anchor' };
}
```

- [ ] **3.1.4 — run and pass.** Same vitest command → all green.

- [ ] **3.1.5 — failing hub/door tests.** Add to
  `features/labour/components/__tests__/LabourHub.test.tsx` (follow that file's existing
  render harness) a `describe('Task 3.1 — anchor gates ONLY the recorder')` with three
  assertions, and one new case in `core/navigation/__tests__/labour-log-intent.test.tsx`:

```tsx
// LabourHub.test.tsx — inside the existing harness; anchor prop is new
it('no anchor: hero inactive, approved reason rendered, ledger tile untouched', () => {
    renderHub({ anchor: { state: 'no-anchor' } });          // via the file's render helper
    const hero = screen.getByRole('button', { name: /बोलून हजेरी घ्या/ });
    expect(hero).toBeDisabled();
    expect(screen.getByTestId('labour-no-anchor-reason').textContent)
        .toContain('आजच्या कामात किती जण होते ते अजून समजलं नाही');
    // Correction 11: the reason never gates the register door.
    expect(screen.getByText('तपासा')).toBeInTheDocument();
});
it('anchored: hero active, no reason card', () => {
    renderHub({ anchor: { state: 'anchored', headcount: 12, logId: 'x' } });
    expect(screen.getByRole('button', { name: /बोलून हजेरी घ्या/ })).toBeEnabled();
    expect(screen.queryByTestId('labour-no-anchor-reason')).toBeNull();
});
```
```tsx
// labour-log-intent.test.tsx — the door itself refuses without an anchor
it('onGoToLog does nothing when today has no anchor (defence behind the disabled hero)', () => {
    const ctx = ctxWith('labour');
    (ctx as unknown as { history: unknown[] }).history = [];   // no logs today
    const node = renderLabourRoute(ctx) as React.ReactElement<{ children: React.ReactElement<{ onGoToLog: () => void }> }>;
    node.props.children.props.onGoToLog();
    expect(ctx.setLogIntent).not.toHaveBeenCalled();
    expect(ctx.setCurrentRoute).not.toHaveBeenCalled();
});
```
  Note: the two existing assertions in `labour-log-intent.test.tsx:26-42` must be updated to
  seed an anchored `ctx.history` (one confirmed log with `count`), or they now fail — that is
  the intended behaviour change, not collateral.

- [ ] **3.1.6 — see them fail.** `npx vitest run src/features/labour/components/__tests__/LabourHub.test.tsx src/core/navigation/__tests__/labour-log-intent.test.tsx`
  → expected: unknown prop `anchor` has no effect / `setLogIntent` WAS called.

- [ ] **3.1.7 — implement the gate.**
  - `LabourHub.tsx`: add to `interface Props` (:53): `anchor?: import('../labourAnchor').LabourAnchor;`
    (type-only import at top: `import type { LabourAnchor } from '../labourAnchor';` and
    `import { ATTENDANCE_COPY } from '../attendanceCopy';` plus `NO_ANCHOR_TEST_IDS`).
    At the hero (:325), derive `const heroInactive = anchor?.state === 'no-anchor';` and change
    the button to:

```tsx
<button type="button" disabled={heroInactive} onClick={heroInactive ? undefined : onGoToLog}
    className={`relative flex w-full items-center gap-4 overflow-hidden rounded-[24px] p-5 text-left transition-transform ${heroInactive
        ? 'bg-slate-100 shadow-none'
        : 'bg-gradient-to-br from-emerald-500 to-emerald-700 shadow-[0_16px_32px_-12px_rgba(5,150,105,0.65)] active:scale-[0.99]'}`}>
```
    with the three inner `<span>` text colours switched to `text-slate-400` when inactive
    (state B mockup: grey hero, not hidden), and immediately AFTER the button:

```tsx
{heroInactive && (
    <div data-testid={NO_ANCHOR_TEST_IDS.reason}
        className="rounded-xl border border-amber-200 border-l-[3px] border-l-amber-600 bg-amber-50 p-3 text-[13.5px] leading-relaxed text-amber-800">
        {ATTENDANCE_COPY.noAnchorReason}
    </div>
)}
```
    The reason is a card on the hub — never a modal, never an interstitial (state B "must not").
    `anchor` absent (the `?preview=labour` bare mount) keeps today's behaviour: hero active.
  - `LabourFeature.tsx`: above the return, `const anchor = React.useMemo(() => resolveLabourAnchor(history ?? [], getDateKey()), [history]);`
    (imports: `resolveLabourAnchor` from `../labourAnchor`, `getDateKey` from
    `../../../core/domain/services/DateKeyService`) and pass `anchor={anchor}` to `<LabourHub>` (:161).
  - `simpleRoutes.tsx` `onGoToLog` (:84-91) becomes:

```tsx
onGoToLog={() => {
    // Labour V2 R1 Task 3.1 — the labour mic is a VERIFICATION instrument.
    // No anchor → no mic. This is the door (the hub hero is already drawn
    // inactive with the approved reason); gating here as well means no future
    // caller of onGoToLog can walk past the rule. It gates ONLY the recorder:
    // the labour route, hub and हजेरी वही render regardless (Correction 11).
    if (resolveLabourAnchor(ctx.history ?? [], getDateKey()).state !== 'anchored') return;
    ctx.setLogIntent('labour');
    ctx.setCurrentRoute('main');
}}
```
    with imports `import { resolveLabourAnchor } from '../../features/labour/labourAnchor';`
    and `import { getDateKey } from '../domain/services/DateKeyService';`.

- [ ] **3.1.8 — run and pass** the three test files; then the full suite:
  `npx vitest run` → green; `npm run typecheck` → clean.

- [ ] **3.1.9 — commit.**
  `feat(labour): gate the labour mic on an explicit anchor (Task 3.1)`

---

## Task 3.2 — Context carried forward: the four rungs, by field name

The labour parse receives farm, date, engagement and reported headcount as *known* and is
scoped to resolving composition. The rung is a pure function of three already-existing
fields: the parse's `count` (`AgriLogResponseSchema.ts:456` — verified: `count` sits in
`LabourEventSchema`), `workerNames` (:479, declared so Zod cannot strip it), and the anchor
headcount (server mirror: `LabourAttendanceDraftDto.Headcount`, `LabourDataDto.cs:293-305`,
`int?`, 0 reserved for genuine no-labour). Rule 15 binds: no rung may re-ask plot, crop,
work, or an already-known headcount.

| Rung | Condition (by field name) | Labour asks |
|---|---|---|
| 1 | `count == null && anchorHeadcount == null` | nothing — mic unavailable (Task 3.1 owns the copy) |
| 2 | known count, `workerNames.length === 0` | `ATTENDANCE_COPY.rungWho(n)` |
| 3 | `workerNames.length < known count` | `ATTENDANCE_COPY.rungRemainder` |
| 4 | `workerNames.length >= known count` | `ATTENDANCE_COPY.rungConfirm` |

**Files**
- Create: `features/labour/attendanceLadder.ts`
- Create: `features/labour/__tests__/attendanceLadder.test.ts`

**Interfaces** — Produces `selectLadderRung`. Consumes `ATTENDANCE_COPY` (3.1).

**Steps**

- [ ] **3.2.1 — failing test.** `features/labour/__tests__/attendanceLadder.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { selectLadderRung } from '../attendanceLadder';

describe('selectLadderRung — only the missing facts are asked (rule 15)', () => {
    it('nothing understood anywhere → rung 1 (Labour unavailable)', () => {
        expect(selectLadderRung({ anchorHeadcount: undefined, spokenCount: undefined, workerNames: [] })).toBe(1);
    });
    it('only a count → rung 2 (WHO)', () => {
        expect(selectLadderRung({ anchorHeadcount: 12, spokenCount: undefined, workerNames: [] })).toBe(2);
    });
    it('count + some people → rung 3 (only the remainder)', () => {
        expect(selectLadderRung({ anchorHeadcount: 12, spokenCount: undefined, workerNames: ['गणेश', 'शंकर'] })).toBe(3);
    });
    it('full composition → rung 4 (only बरोबर?)', () => {
        expect(selectLadderRung({ anchorHeadcount: 2, spokenCount: undefined, workerNames: ['गणेश', 'शंकर'] })).toBe(4);
    });
    it('the spoken count outranks the anchor for rung selection — but never overwrites it', () => {
        expect(selectLadderRung({ anchorHeadcount: 12, spokenCount: 2, workerNames: ['गणेश', 'शंकर'] })).toBe(4);
    });
    it('a transcript naming only people still resolves (names without a count ride the anchor)', () => {
        expect(selectLadderRung({ anchorHeadcount: 3, spokenCount: undefined, workerNames: ['गणेश'] })).toBe(3);
    });
});
```

- [ ] **3.2.2 — see it fail.** `npx vitest run src/features/labour/__tests__/attendanceLadder.test.ts`
  → module-not-found.

- [ ] **3.2.3 — implement.** `features/labour/attendanceLadder.ts`:

```ts
/**
 * Labour V2 R1 Task 3.2 — the adaptive ladder (founder D1–D3, locked as drawn).
 *
 * A pure function: the rung is derived from what is ALREADY KNOWN, so the
 * screen can only ever ask for the facts it is missing (trust rule 15 — never
 * make the farmer answer questions the database wants). The spoken count wins
 * for RUNG SELECTION only; storage keeps both statements (Task 3.3).
 */
export type LadderRung = 1 | 2 | 3 | 4;

export interface LadderInput {
    /** Today's accepted engagement headcount — resolveLabourAnchor().headcount. */
    anchorHeadcount: number | undefined;
    /** resolveLabourHeadcount over the parse's labour events, undefined when unstated. */
    spokenCount: number | undefined;
    /** The people named as present, each exactly as spoken. */
    workerNames: readonly string[];
}

export function selectLadderRung({ anchorHeadcount, spokenCount, workerNames }: LadderInput): LadderRung {
    const known = spokenCount ?? anchorHeadcount;
    if (known == null) return 1;
    if (workerNames.length === 0) return 2;
    if (workerNames.length < known) return 3;
    return 4;
}
```

- [ ] **3.2.4 — run and pass**, then commit.
  `feat(labour): four-rung ladder context for the labour parse (Task 3.2)`

---

## Task 3.3 — Disagreement preserved; the contradiction becomes ONE question

Two distinct facts, two distinct treatments — do not conflate them:

1. **Headcount disagreement** (farmer says 10 where the anchored log said 12): BOTH statements
   are preserved; `sourceText` + `systemInterpretation` (both on `LabourEvent`,
   `log.labour.types.ts:138-139`, and in the parse schema) are rendered inside the confirm and
   **settled by बरोबर / बदल करा — never a separate question** (D9.5, founder file verbatim:
   the violet line is the *reading*; बरोबर accepts it, बदल करा corrects it). The anchor
   engagement is never mutated by this flow; the new statement lands as its own record
   (Task 3.4b's save); the owner sees both in तपासा. Rule 1: no silent overwrite.
2. **Mark-plane contradiction** (गणेश appears in two of today's works with different day
   facts — एकात पूर्ण, दुसऱ्यात अर्धा): surfaced as the approved one-question card
   (`एक गोष्ट स्पष्ट करा`) whose ANSWER buttons are the two candidate facts themselves
   (mockup 04: पूर्ण / अर्धा). The answer travels as `resolvedLabourAssignmentId` + the
   chosen day/night on the mark (Task 3.5); both engagement records stay exactly as stated —
   the reassurance line says so. The server runs the authoritative twin of this check
   (Task 3.5b); this client pre-check exists so the question is normally answered AT CAPTURE,
   not days later at sync.

**Files**
- Create: `features/labour/attendanceContradiction.ts`
- Create: `features/labour/__tests__/attendanceContradiction.test.ts`

**Interfaces** — Produces `findDayContradictions`, `DayContradiction`. Consumes
`LabourEvent.shiftId` (`AgriLogResponseSchema.ts:453` / `log.labour.types.ts`) — noting the
Phase 0 C4 fact: **the voice pipeline never emits `shift`**, so today this fires only between
events that carry a `shiftId` from manual entry or sync-pull. That is correct behaviour, not
a gap to paper over: a contradiction that cannot arise asks nothing.

**Steps**

- [ ] **3.3.1 — failing test.** `features/labour/__tests__/attendanceContradiction.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { findDayContradictions } from '../attendanceContradiction';
import type { LabourEvent } from '../../../domain/types/log.labour.types';

const ev = (id: string, names: string[], shiftId?: string): LabourEvent =>
    ({ id, type: 'hired', workerNames: names, shiftId } as unknown as LabourEvent);

describe('findDayContradictions — deterministic, never AI-produced', () => {
    it('the founder case: one man, full in one work, half in another → ONE contradiction', () => {
        const out = findDayContradictions([ev('a', ['गणेश'], 'full'), ev('b', ['गणेश'], 'half')]);
        expect(out).toEqual([{
            name: 'गणेश',
            facts: [
                { shift: 'full', sourceEventId: 'a' },
                { shift: 'half', sourceEventId: 'b' },
            ],
        }]);
    });
    it('two consistent contexts ask nothing (the GetLabourDataHandler:602-612 rule)', () => {
        expect(findDayContradictions([ev('a', ['गणेश'], 'full'), ev('b', ['गणेश'], 'full')])).toEqual([]);
    });
    it('an event with no shift makes no claim and raises no question', () => {
        expect(findDayContradictions([ev('a', ['गणेश'], 'full'), ev('b', ['गणेश'])])).toEqual([]);
    });
    it('same NAME across people is per-name only — never merged identities (rule 10 lives at resolution, not here)', () => {
        const out = findDayContradictions([ev('a', ['गणेश', 'शंकर'], 'full'), ev('b', ['शंकर'], 'night')]);
        expect(out.map(c => c.name)).toEqual(['शंकर']);
    });
    it('at most one contradiction per person per day, facts listed once per engagement', () => {
        const out = findDayContradictions([ev('a', ['गणेश'], 'full'), ev('b', ['गणेश'], 'half'), ev('c', ['गणेश'], 'half')]);
        expect(out).toHaveLength(1);
        expect(out[0].facts).toHaveLength(3);
    });
});
```

- [ ] **3.3.2 — see it fail** (module-not-found), then implement
  `features/labour/attendanceContradiction.ts`:

```ts
/**
 * Labour V2 R1 Task 3.3 — the deterministic per-person day-fact comparison.
 *
 * The server twin lives in RecordAttendanceMarkHandler and is authoritative;
 * this copy exists so the question is answered AT CAPTURE (state D) instead
 * of surfacing days later on the sync path. Same rule as the server's तपासा
 * idiom (GetLabourDataHandler.cs:602-612): collect, Distinct, report only
 * when MORE than one fact survives. It is a comparison of two things the
 * farmer already said — the AI is never the producer (the dead
 * LABOUR_SOURCE_CHECK channel stays dead).
 *
 * shiftId here is the config-derived string ('full' | 'half' | 'night'),
 * exactly what DetailSheet.tsx and mapLabourEngagements.ts write — normalised
 * to lower case the way LabourAssignmentFactory.MapLabourShift does server-side.
 */
import type { LabourEvent } from '../../domain/types/log.labour.types';

export type DayShift = 'full' | 'half' | 'night';

export interface DayContradiction {
    name: string;
    facts: Array<{ shift: DayShift; sourceEventId: string }>;
}

const KNOWN: ReadonlySet<string> = new Set(['full', 'half', 'night']);

export function findDayContradictions(events: readonly LabourEvent[]): DayContradiction[] {
    const byName = new Map<string, Array<{ shift: DayShift; sourceEventId: string }>>();
    for (const event of events) {
        const raw = event.shiftId?.toLowerCase();
        if (!raw || !KNOWN.has(raw)) continue;   // no claim → no question
        for (const name of event.workerNames ?? []) {
            const list = byName.get(name) ?? [];
            list.push({ shift: raw as DayShift, sourceEventId: event.id });
            byName.set(name, list);
        }
    }
    const out: DayContradiction[] = [];
    for (const [name, facts] of byName) {
        const distinct = new Set(facts.map(f => f.shift));
        if (distinct.size > 1) out.push({ name, facts });
    }
    return out;
}
```

- [ ] **3.3.3 — run and pass**, full suite green, commit.
  `feat(labour): preserve headcount disagreement; deterministic day-fact contradiction (Task 3.3)`
  (The RENDERING of both facts — disagreement card and contradiction card — lands with the
  screen that owns them, Task 3.4b.)

---

## Task 3.4a — Delete the labour auto-submit

`AppRouter.tsx:214-228` auto-submits a labour parse with no confirmation screen —
a live violation of trust rule 5 and of the promise still written at
`useVoiceRecorder.ts:624` ("Always show ManualEntry for review — never skip to auto-save").
The *navigation* (`simpleRoutes.tsx:84-91`) is correct and stays (now gated by 3.1); the
guards inside the effect (`attendance.labour.length !== 0` at :224, the once-per-draft ref)
were doing correct work — **the whole effect goes away because the confirm screen replaces
it, not because the guards were wrong.** Delete the door's auto-save and its comment block,
not anything else.

**Files**
- Modify: `core/navigation/AppRouter.tsx` — delete :194-228 (the FOUNDER RULING 2026-08-31
  comment block, `autoSubmittedLabourDraftRef`, and the effect) and the now-unused import
  `toAttendanceOnlyDraft` at :28.

**Interfaces** — none produced; removes the only caller of `handleManualSubmit` outside
farmer-pressed paths on the labour door.

**Steps**

- [ ] **3.4a.1 — delete.** Remove `AppRouter.tsx:194-228` in one cut (comment block + ref +
  effect). Remove the `toAttendanceOnlyDraft` import (:28) — `mainView.tsx` keeps its own.
  Leave a two-line tombstone where the effect was:

```tsx
    // Labour V2 R1 Task 3.4a — the labour auto-submit that lived here was
    // DELETED. A labour parse now lands on features/labour/components/
    // AttendanceResult.tsx and is saved ONLY by the farmer pressing बरोबर
    // (trust rule 5; useVoiceRecorder.ts's "never skip to auto-save" holds
    // on this door again). The 2026-08-31 ruling it implemented is
    // superseded by the founder's 2026-09-01 final direction §7 / D1–D3.
```

- [ ] **3.4a.2 — verify the deletion is total.**
  `grep -rn "autoSubmittedLabourDraftRef" src/clients/mobile-web/src/` → **no output**;
  `cd src/clients/mobile-web && npm run typecheck` → clean (fails if the import removal was missed);
  `npx vitest run` → green (behavioural proof that nothing persists without बरोबर is 3.4b.5's test).

- [ ] **3.4a.3 — commit.**
  `fix(labour): delete the labour auto-submit — बरोबर is the only save (Task 3.4a)`

---

## Task 3.4b — The Labour-owned result surface

`AttendanceResult.tsx` replaces the generic landing at `mainView.tsx:480-499` for the labour
door. The invoking feature owns the meaning and the result screen; the mic shell and the
processing screen stay shared. `toAttendanceOnlyDraft` (`attendanceDraft.ts:46-66`) already
empties the other buckets — the remaining work is **ownership**, not bucket suppression.
After बरोबर the existing save path runs unchanged, so `useLogCommands.ts:661-664` still
routes him back to Labour with `lastLabourLogIds`.

बदल करा renders the EXISTING `ManualEntry` with `attendanceOnly` — that branch stops being
the landing and becomes the edit surface (D9.6: बदल करा corrects; nothing is rebuilt).
Re-speaking (rungs 2/3) reuses the EXISTING segment re-record path:
`setRecordingSegment('labour')` + `setMode('voice')` — `useVoiceRecorder`'s
`isSegmentUpdate` merge (:628-683) already folds new labour speech into the draft and drops
answered LABOUR questions (:678-680).

**Files**
- Create: `features/labour/components/AttendanceResult.tsx`
- Create: `features/labour/components/__tests__/AttendanceResult.test.tsx`
- Create: `core/navigation/__tests__/labourResultOwnership.test.tsx`
- Modify: `core/navigation/mainView.tsx` — the `hasActiveLogContext ?` branch at :480-499

**Interfaces**

*Produces:*
```tsx
export interface AttendanceResultProps {
    /** Attendance-only draft (labour.length > 0) — toAttendanceOnlyDraft output. */
    draft: AgriLogResponse;
    anchor: LabourAnchor;
    /** meta.farmId of the anchor log / context farm — undefined ⇒ marks are skipped, statement still saves. */
    farmId: string | undefined;
    /** THE only save. Wired to useLogCommands.handleManualSubmit. */
    onConfirm: (draft: AgriLogResponse) => void;
    /** बदल करा → the existing ManualEntry(attendanceOnly) branch. */
    renderEditSurface: () => React.ReactNode;
    /** Rungs 2/3 "speak" → setRecordingSegment('labour'); setMode('voice'). */
    onSpeakMore: () => void;
}
```
*Consumes:* `selectLadderRung` (3.2), `findDayContradictions` (3.3), `ATTENDANCE_COPY` (3.1),
`resolveLabourHeadcount`, `MarkAttendanceCommand` (3.5c — until 3.5c lands, the enqueue import
line is ABSENT, see 3.4b.4; 3.5c adds it), `fetchFieldOperators`/`FieldOperator`
(`fieldOperatorClient.ts:90-131`), `ShramSathiUnderstanding` (identity assert only).

**Steps**

- [ ] **3.4b.1 — failing ownership test.** `core/navigation/__tests__/labourResultOwnership.test.tsx`
  — plain-node assertions in the `AppRouter.feature-gate` idiom (no DOM mount for the branch
  test; identity comparison for the processing screen, the `labour-log-banner.test.tsx`
  pattern):

```tsx
/**
 * Labour V2 R1 Task 3.4b — the invoking feature owns the result surface;
 * the mic shell and the processing screen stay SHARED.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { renderLogView } from '../mainView';
import type { AppRouterContext } from '../routeContext';
import AttendanceResult from '../../../features/labour/components/AttendanceResult';
import { ShramSathiUnderstanding } from '../../../features/logs/components/shramsathi/ShramSathiUnderstanding';

function findByType(node: React.ReactNode, type: unknown): React.ReactElement | null {
    if (!React.isValidElement(node)) {
        if (Array.isArray(node)) {
            for (const child of node) { const hit = findByType(child, type); if (hit) return hit; }
        }
        return null;
    }
    if (node.type === type) return node;
    const children = (node.props as { children?: React.ReactNode }).children;
    return children ? findByType(children, type) : null;
}

const labourDraft = {
    summary: '', dayOutcome: 'WORK_RECORDED', cropActivities: [], irrigation: [],
    labour: [{ id: 'l1', type: 'hired', count: 12 }], inputs: [], machinery: [],
    activityExpenses: [], missingSegments: [],
};

function ctx(partial: Record<string, unknown>): AppRouterContext {
    return {
        currentRoute: 'main', mainView: 'log', status: 'idle', mode: 'manual',
        recordingSegment: null, crops: [], logScope: { selectedCropIds: [], selectedPlotIds: [], mode: 'single', applyPolicy: 'broadcast' },
        setLogScope: vi.fn(), setMode: vi.fn(), setStatus: vi.fn(), setCurrentRoute: vi.fn(), setMainView: vi.fn(),
        hasActiveLogContext: true, isContextReady: true, error: null, errorTranscript: null,
        handleAudioReady: vi.fn(), handleTextReady: vi.fn(), handleManualSubmit: vi.fn(),
        currentLogContext: { selection: [] }, ledgerDefaults: {}, farmerProfile: {},
        draftLog: null, setDraftLog: vi.fn(), provenance: null,
        voiceStreamingPhase: 'idle', liveCaption: '', continuityLevel: null, savedPendingCaptureId: null,
        getTodayCounts: vi.fn(() => ({})), getContextColorIndicator: vi.fn(() => null),
        plannedTasks: [], handleUpdateTask: vi.fn(), history: [], todayLogs: [], operatorNameById: {},
        getLogContextSnapshot: vi.fn(), handleEditLog: vi.fn(), costSnapshot: { today: 0, cropSoFar: 0 },
        yesterdayCost: 0, setRecordingSegment: vi.fn(), lastSavedLogSummary: null, lastSavedLogIds: [],
        mockHistory: [], handleReset: vi.fn(), logIntent: null, todayDayState: { pendingCount: 0, closurePercent: 0 },
        weatherData: null,
        ...partial,
    } as unknown as AppRouterContext;
}

describe('Task 3.4b — Labour owns the parse result', () => {
    it('a labour-intent draft renders AttendanceResult, and handleManualSubmit is NOT called by rendering', () => {
        const submit = vi.fn();
        const node = renderLogView(ctx({ logIntent: 'labour', draftLog: labourDraft, handleManualSubmit: submit }));
        expect(findByType(node, AttendanceResult)).not.toBeNull();
        expect(submit).not.toHaveBeenCalled();                 // Task 3.4a: nothing saves on landing
    });
    it('the generic door is untouched: no AttendanceResult without labour intent', () => {
        const node = renderLogView(ctx({ logIntent: null, draftLog: labourDraft }));
        expect(findByType(node, AttendanceResult)).toBeNull();
    });
    it('the labour path renders the SAME processing component — identity, not a copy', () => {
        const node = renderLogView(ctx({ logIntent: 'labour', status: 'processing' }));
        // FEATURE_FLAGS.dailyLoop ON in prod config renders the founder-approved
        // श्रम साथी screen; identity equality forbids a labour-owned duplicate.
        expect(findByType(node, ShramSathiUnderstanding)).not.toBeNull();
    });
});
```
  (If `FEATURE_FLAGS.dailyLoop` is `false` in the vitest environment, mock
  `app/featureFlags` in this file the way `AppRouter.feature-gate.test.tsx:41-51` does, with
  `FEATURE_FLAGS: { dailyLoop: true }` — asserting identity of the flag-ON component is the
  point; the flag itself is not under test.)

- [ ] **3.4b.2 — see it fail.** `npx vitest run src/core/navigation/__tests__/labourResultOwnership.test.tsx`
  → cannot resolve `AttendanceResult`.

- [ ] **3.4b.3 — failing component test.** `features/labour/components/__tests__/AttendanceResult.test.tsx`
  (testing-library DOM render, the `LabourHub.test.tsx` idiom):

```tsx
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import AttendanceResult from '../AttendanceResult';
import type { AgriLogResponse } from '../../../../types';

const base: AgriLogResponse = {
    summary: '', dayOutcome: 'WORK_RECORDED', cropActivities: [], irrigation: [],
    labour: [], inputs: [], machinery: [], activityExpenses: [], missingSegments: [],
};
const anchor = { state: 'anchored', headcount: 12, logId: 'log-1' } as const;

function draw(labour: AgriLogResponse['labour'], onConfirm = vi.fn()) {
    render(<AttendanceResult
        draft={{ ...base, labour }} anchor={anchor} farmId={undefined}
        onConfirm={onConfirm} renderEditSurface={() => <div data-testid="edit-surface" />}
        onSpeakMore={vi.fn()} />);
    return onConfirm;
}

describe('AttendanceResult — the Task 1.1 panel-2 screen', () => {
    it('rung 2: shows the WHO question with the known count; never re-asks plot/crop/work', () => {
        draw([{ id: 'l1', type: 'hired', count: 12 } as AgriLogResponse['labour'][number]]);
        expect(screen.getByText('या 12 जणांमध्ये कोण होते?')).toBeInTheDocument();
        expect(screen.getByText('"बरोबर" दाबेपर्यंत काहीही जतन होणार नाही.')).toBeInTheDocument();
    });
    it('rung 3: only the remainder question', () => {
        draw([{ id: 'l1', type: 'hired', count: 12, workerNames: ['गणेश', 'शंकर'] } as AgriLogResponse['labour'][number]]);
        expect(screen.getByText('यांच्याशिवाय अजून कोण होते?')).toBeInTheDocument();
    });
    it('nothing is saved until बरोबर; बरोबर saves exactly once', () => {
        const onConfirm = draw([{ id: 'l1', type: 'hired', count: 2, workerNames: ['गणेश', 'शंकर'] } as AgriLogResponse['labour'][number]]);
        expect(onConfirm).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: 'बरोबर' }));
        expect(onConfirm).toHaveBeenCalledTimes(1);
    });
    it('D9.5: sourceText and the reading are BOTH visible inside the confirm — no separate question', () => {
        draw([{ id: 'l1', type: 'hired', count: 9, workerNames: ['शंकर'],
            sourceText: 'शंकर आठ जण घेऊन आला',
            systemInterpretation: 'Shankar + 8 = 9' } as AgriLogResponse['labour'][number]]);
        expect(screen.getByText(/शंकर आठ जण घेऊन आला/)).toBeInTheDocument();
        expect(screen.getByText(/Shankar \+ 8 = 9/)).toBeInTheDocument();
        expect(screen.queryByText('एक गोष्ट स्पष्ट करा')).toBeNull();
    });
    it('headcount disagreement renders BOTH numbers and still settles at बरोबर/बदल करा', () => {
        draw([{ id: 'l1', type: 'hired', count: 10 } as AgriLogResponse['labour'][number]]);
        const card = screen.getByTestId('headcount-disagreement');
        expect(card.textContent).toContain('12');
        expect(card.textContent).toContain('10');
        expect(screen.getByRole('button', { name: 'बरोबर' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'बदल करा' })).toBeInTheDocument();
    });
    it('state D: the contradiction card with the approved copy, answered by the two facts', () => {
        draw([
            { id: 'a', type: 'hired', count: 2, workerNames: ['गणेश'], shiftId: 'full' } as AgriLogResponse['labour'][number],
            { id: 'b', type: 'hired', workerNames: ['गणेश'], shiftId: 'half' } as AgriLogResponse['labour'][number],
        ]);
        expect(screen.getByText('एक गोष्ट स्पष्ट करा')).toBeInTheDocument();
        expect(screen.getByText('गणेश आज दोन कामांत दिसतोय — एकात पूर्ण, दुसऱ्यात अर्धा. आजची हजेरी कोणती?')).toBeInTheDocument();
        expect(screen.getByText('एकदाच स्पष्ट करा; दोन्ही कामांच्या नोंदी तशाच राहतील.')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'पूर्ण' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'अर्धा' })).toBeInTheDocument();
    });
    it('बदल करा switches to the edit surface', () => {
        draw([{ id: 'l1', type: 'hired', count: 2, workerNames: ['गणेश', 'शंकर'] } as AgriLogResponse['labour'][number]]);
        fireEvent.click(screen.getByRole('button', { name: 'बदल करा' }));
        expect(screen.getByTestId('edit-surface')).toBeInTheDocument();
    });
});
```

- [ ] **3.4b.4 — implement `AttendanceResult.tsx`.** Complete component (no mark enqueue yet —
  that single call is added by 3.5c so this task ships compiling and green on its own):

```tsx
/**
 * Labour V2 R1 Task 3.4b — the Labour-owned parse result (founder D1–D3,
 * locked as drawn; mockup 01 frame 3 / 05).
 *
 * OWNERSHIP, NOT REBUILDING: the mic shell, the segment re-record path and
 * the ShramSathi processing screen stay shared (mainView renders them); this
 * screen owns only the MEANING of a labour parse and its confirm. बरोबर is
 * the ONLY save event in this flow (trust rule 5; pre-save honesty line is
 * founder copy). बदल करा renders the existing ManualEntry(attendanceOnly)
 * branch — the old landing became the edit surface.
 *
 * Money never appears here (state A "must not": no ₹, no rate, no wage).
 */
import React from 'react';
import { Check, Mic, Pencil } from 'lucide-react';
import type { AgriLogResponse } from '../../../types';
import type { LabourAnchor } from '../labourAnchor';
import { ATTENDANCE_COPY as COPY } from '../attendanceCopy';
import { selectLadderRung } from '../attendanceLadder';
import { findDayContradictions, type DayContradiction, type DayShift } from '../attendanceContradiction';
import { resolveLabourHeadcount } from '../../../domain/logs/labourHeadcount';

export interface AttendanceResultProps {
    draft: AgriLogResponse;
    anchor: LabourAnchor;
    farmId: string | undefined;
    onConfirm: (draft: AgriLogResponse) => void;
    renderEditSurface: () => React.ReactNode;
    onSpeakMore: () => void;
}

const shiftWord = (s: DayShift): string => COPY.markWord[s];

const AttendanceResult: React.FC<AttendanceResultProps> = ({
    draft, anchor, farmId, onConfirm, renderEditSurface, onSpeakMore,
}) => {
    const [editing, setEditing] = React.useState(false);
    // State D answers, keyed by name. Recorded beside the statements, never in
    // place of them (mockup 04 "never silently overwrite").
    const [rulings, setRulings] = React.useState<Record<string, DayShift>>({});

    const spokenCounts = draft.labour
        .map((e) => resolveLabourHeadcount(e))
        .filter((n): n is number => n != null);
    const spokenCount = spokenCounts.length > 0 ? spokenCounts.reduce((a, b) => a + b, 0) : undefined;
    const anchorHeadcount = anchor.state === 'anchored' ? anchor.headcount : undefined;
    const workerNames = draft.labour.flatMap((e) => e.workerNames ?? []);
    const rung = selectLadderRung({ anchorHeadcount, spokenCount, workerNames });
    const knownCount = spokenCount ?? anchorHeadcount;
    const disagreement = spokenCount != null && anchorHeadcount != null && spokenCount !== anchorHeadcount;
    const contradictions: DayContradiction[] = findDayContradictions(draft.labour)
        .filter((c) => rulings[c.name] == null);

    if (editing) return <>{renderEditSurface()}</>;

    const question = rung === 2 && knownCount != null ? COPY.rungWho(knownCount)
        : rung === 3 ? COPY.rungRemainder
        : rung === 4 ? COPY.rungConfirm
        : null;

    return (
        <div className="flex flex-col gap-2.5" style={{ fontFamily: "'Noto Sans Devanagari', sans-serif" }}>
            {/* ShramSafalला समजलं — what memory already holds + what was heard */}
            <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-[0_1px_3px_rgba(20,40,30,0.05)]">
                <div className="text-[13px] font-extrabold text-slate-800">{COPY.understoodHeading}</div>
                {knownCount != null && (
                    <div className="mt-2 flex items-center gap-2">
                        <b className="text-[24px] font-black text-emerald-700 [font-variant-numeric:tabular-nums]" style={{ fontFamily: "'DM Sans', sans-serif" }}>{knownCount}</b>
                        <span className="text-[15px] font-bold text-slate-700">जण</span>
                        <span className="ml-auto rounded-lg bg-emerald-50 px-2 py-1 text-[11px] font-bold text-emerald-700">{COPY.youSaidChip}</span>
                    </div>
                )}
                {workerNames.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                        {workerNames.map((name, i) => (
                            <span key={`${name}-${i}`} className="rounded-lg bg-slate-100 px-2.5 py-1 text-[13px] font-bold text-slate-800">{name}</span>
                        ))}
                    </div>
                )}
                {/* D9.5 — sourceText first, then the reading taken. Settled by
                    बरोबर / बदल करा below; NEVER raised as a separate question. */}
                {draft.labour.filter((e) => e.sourceText).map((e) => (
                    <div key={e.id} className="mt-2 border-t border-slate-100 pt-2">
                        <span className="block text-[12.5px] text-slate-600">{COPY.youSaidChip}: “{e.sourceText}”</span>
                        {e.systemInterpretation && (
                            <span className="mt-0.5 block text-[12px] font-bold text-violet-700">{e.systemInterpretation}</span>
                        )}
                    </div>
                ))}
            </div>

            {/* Headcount disagreement — both statements visible, neither overwritten (rule 1). */}
            {disagreement && (
                <div data-testid="headcount-disagreement"
                    className="rounded-xl border border-amber-200 border-l-[3px] border-l-amber-600 bg-amber-50 p-3 text-[13px] leading-relaxed text-amber-800">
                    <span className="font-extrabold">{COPY.youSaidChip}: {spokenCount} जण.</span>{' '}
                    आजच्या कामाच्या नोंदीत {anchorHeadcount} जण आहेत. दोन्ही नोंदी तशाच राहतील.
                </div>
            )}

            {/* State D — the one question, answered by the two facts themselves. */}
            {contradictions.map((c) => {
                const distinct = [...new Set(c.facts.map((f) => f.shift))];
                return (
                    <div key={c.name} className="rounded-2xl border border-emerald-200 bg-white p-4 shadow-[0_1px_3px_rgba(20,40,30,0.05)]">
                        <div className="text-[15px] font-extrabold text-emerald-700">{COPY.contradictionTitle}</div>
                        <p className="mt-1.5 text-[15px] font-bold leading-snug text-slate-800">
                            {COPY.contradictionBody(c.name, shiftWord(distinct[0]), shiftWord(distinct[1] ?? distinct[0]))}
                        </p>
                        <div className="mt-2.5 flex gap-2">
                            {distinct.map((s) => (
                                <button key={s} type="button"
                                    onClick={() => setRulings((r) => ({ ...r, [c.name]: s }))}
                                    className={`flex-1 rounded-[14px] py-3 text-[16px] font-extrabold ${s === 'full'
                                        ? 'bg-emerald-600 text-white'
                                        : 'border border-amber-200 bg-white text-amber-700'}`}>
                                    {shiftWord(s)}
                                </button>
                            ))}
                        </div>
                        <p className="mt-2 text-[12px] text-slate-500">{COPY.contradictionReassurance}</p>
                    </div>
                );
            })}

            {/* The rung's one question + the shared mic as the way to answer it. */}
            {question && (
                <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-[0_1px_3px_rgba(20,40,30,0.05)]">
                    <p className="text-[19px] font-bold leading-snug text-stone-800">{question}</p>
                    {(rung === 2 || rung === 3) && (
                        <button type="button" onClick={onSpeakMore}
                            className="mt-3 flex w-full items-center justify-center gap-2 rounded-[14px] border-[1.5px] border-dashed border-emerald-200 bg-emerald-50 p-3 text-[14px] font-extrabold text-emerald-700 active:scale-[0.98]">
                            <Mic size={16} /> बोला
                        </button>
                    )}
                </div>
            )}

            {/* Pre-save honesty + the ONLY save. Disabled while a contradiction is unanswered. */}
            <p className="px-1 text-[12.5px] font-bold text-slate-500">{COPY.preSaveHonesty}</p>
            <div className="flex gap-2">
                <button type="button" disabled={contradictions.length > 0}
                    onClick={() => onConfirm(draft)}
                    className={`flex flex-[2] items-center justify-center gap-2 rounded-[14px] py-3.5 text-[16px] font-extrabold text-white transition-transform active:scale-[0.98] ${contradictions.length > 0 ? 'bg-slate-300' : 'bg-emerald-600'}`}>
                    <Check size={18} /> {COPY.confirmButton}
                </button>
                <button type="button" onClick={() => setEditing(true)}
                    className="flex flex-1 items-center justify-center gap-2 rounded-[14px] border border-slate-200 bg-white py-3.5 text-[15px] font-extrabold text-slate-700 active:scale-[0.98]">
                    <Pencil size={16} /> {COPY.editButton}
                </button>
            </div>
        </div>
    );
};

export default AttendanceResult;
```
  Note: `farmId` and `rulings` are consumed by 3.5c's enqueue block (added there); until
  then `farmId` is intentionally referenced only by the props type and `rulings` by the
  contradiction filter — both used, both compiling.

- [ ] **3.4b.5 — wire mainView.** In `mainView.tsx`, replace the branch at :480-499 head so the
  labour door lands on the Labour-owned screen (the `ManualEntry` call itself moves verbatim
  into a local `renderAttendanceEdit`-style closure — it is NOT modified):

```tsx
) : (
    hasActiveLogContext ? (
        (() => {
            // Labour V2 R1 Task 3.4b — the invoking feature owns the result
            // surface. The generic ManualEntry(attendanceOnly) branch below is
            // KEPT as the बदल करा edit surface; it stopped being the landing.
            const attendanceDraft = logIntent === 'labour' ? toAttendanceOnlyDraft(draftLog) : null;
            const renderManualEntry = () => (
                <ManualEntry
                    /* ...the existing :481-517 props, byte-for-byte... */
                />
            );
            if (attendanceDraft && attendanceDraft.labour.length > 0) {
                const anchorForDraft = resolveLabourAnchor(history, getDateKey());
                const anchorLog = history.find((l) => anchorForDraft.state === 'anchored' && l.id === anchorForDraft.logId);
                return (
                    <AttendanceResult
                        draft={attendanceDraft}
                        anchor={anchorForDraft}
                        farmId={anchorLog?.meta?.farmId ?? currentLogContext?.selection?.[0]?.farmId}
                        onConfirm={(d) => { void handleManualSubmit(d); setDraftLog(null); }}
                        renderEditSurface={renderManualEntry}
                        onSpeakMore={() => { setRecordingSegment('labour'); setMode('voice'); }}
                    />
                );
            }
            return renderManualEntry();
        })()
    ) : (
```
  Imports added to mainView.tsx: `AttendanceResult` from
  `'../../features/labour/components/AttendanceResult'`, `resolveLabourAnchor` from
  `'../../features/labour/labourAnchor'` (`getDateKey` is already imported at :23).
  `onConfirm` runs the SAME `handleManualSubmit` the auto-submit used — the statement save is
  unchanged, only now farmer-pressed; `useLogCommands.ts:661-664` then routes back to Labour.
  The `labour.length === 0` case falls through to the empty ManualEntry — "he said something
  this door cannot record… He sees it and decides" survives as behaviour.

- [ ] **3.4b.6 — run and pass.**
  `npx vitest run src/core/navigation/__tests__/labourResultOwnership.test.tsx src/features/labour/components/__tests__/AttendanceResult.test.tsx`
  then the full suite + `npm run typecheck` + `npm run check:file-sizes` (mainView is near the
  800-line cap — if the closure pushes it over, extract `renderManualEntry`'s prop object, not
  the components).

- [ ] **3.4b.7 — commit.**
  `feat(labour): Labour-owned AttendanceResult replaces the generic confirm (Task 3.4b)`

---

## Task 3.5 — The complete attendance write path, offline included

Persistence exists; the port exists; **there is no callable route** (`AttendanceMark` reaches
Application/Api only at `IShramSafalRepository.cs:919-938`; `LabourEndpoints.cs` has five
routes — :53, :91, :121, :185, :225 — none attendance). One mutation, `attendance.mark`,
through the existing sync pipeline; no second offline system, no new REST route. Split into
four sub-tasks in strict order. **Prerequisite: Phase 2 Task 2.5 landed (hours + basis on the
unshipped migration and domain). Verify before starting:**
`git log origin/main -- "*AddAttendanceMarks*"` → empty (unshipped, editable), and
`grep -n "HoursWorked" src/apps/ShramSafal/ShramSafal.Domain/Labour/AttendanceMark.cs` → hits.

**Stated decisions this write path is built on (each traced to its authority):**
- **`sinceVersion` is `"0.9.0"`** — the wire version is `mobile-web/package.json:4` (verified
  `"0.9.0"`), stamped as `X-App-Version` (`transport.ts` `APP_VERSION`), enforced at
  `PushSyncBatchHandler.cs:629-641`. `jobcard.*` at `1.0.0` is already CLIENT_TOO_OLD for
  every shipped handset. **No `package.json` bump rides with this work.**
- **Wire absence = `Unmarked`.** The payload's `dayMark`/`nightMark` enums have no
  `'Unmarked'` member; an omitted key means "nobody said" (blank ≠ absent), and the server
  maps absence to the enum's zero value explicitly — never by guessing.
- **No `hoursBasis` on the wire.** The handler stamps `LabourTimeBasis.Explicit` whenever the
  payload states hours, `Unspecified` otherwise — provenance is derived from *which path the
  fact arrived by*, so a client can never forge it. Phase 7's timer attaches its times to the
  engagement, never to attendance (founder lock), so this wire never needs an `Assumed`/timer
  member.
- **`clientRequestId` is a derivable VALUE-KEYED natural key**:
  `attendance.mark:{farmId}:{fieldOperatorId}:{workDate}:{dayMark|-}:{nightMark|-}:{hoursWorked|-}:{extraHours|-}`.
  Phase 0 prescribed the row's natural key (`farm:operator:date`); that key governs the ROW,
  but a *changed ruling on the same day* is a second REQUEST about the same row and must not
  dedupe against the first. Including the stated values keeps retry-dedupe (same fact retapped
  = same key, `MutationQueue.ts:146-156` device dedupe + `PushSyncBatchHandler.cs:457/:498`
  server dedupe) AND amendability (changed fact = new key → handler amends; never a blind
  insert, so no 23505 reaches the farmer). Still fully derivable — no random guid anywhere.
- **A repeated identical command is `Recorded` (idempotent)**; a differing command on an
  existing mark **amends through the entity** and writes the append-only correction rows
  in the same unit of work. The deletion-of-a-stated-hour case is REFUSED by the domain
  (Phase 2 Task 2.5: an amendment may restate hours, never silently drop them — R1 ships
  no un-say path); the handler catches that `ArgumentException` and answers
  `InvalidCommand`, so the sync path returns a refusal, never a 500.
- **The contradiction on the sync path** returns
  `MutationExecutionOutcome.Failure("ShramSafal.AttendanceContradiction", ...)`. Nothing is
  staged before it (the check is pre-staging), so the rollback at
  `PushSyncBatchHandler.cs:515-519` has nothing to lose. Client-side the code is PERMANENT
  (`RejectionPolicy` family (b): identical bytes, identical verdict — the ANSWER arrives as a
  NEW mutation carrying `resolvedLabourAssignmentId`, never a re-push), so it surfaces in the
  conflict UI routed to Labour instead of burning retries. **That is where the question
  surfaces on the offline path** — normally it never gets that far, because 3.3's client
  pre-check asks at capture and the enqueued mark already carries the answer.
- **Field-operator identity offline (Phase 0 step 16, decided):** R1 scopes mark creation to
  FieldOperators the client already knows. `Attendance.tsx` rows ARE FieldOperator ids
  (server `BuildAttendanceDraft` emits `LabourAttendanceRowDto(fieldOperatorId.ToString(), "present")`,
  `GetLabourDataHandler.cs:1016-1019`). The voice path resolves spoken names against the
  fetched roster by **unique exact `displayName` match only** — duplicates resolve to nobody
  (rule 10: never auto-merge same names; `fieldOperatorClient.ts` B2: identical names are
  legitimate). Unresolved or offline-unfetchable names write NO mark — the statement save
  still records every spoken name on the engagement (`workerNames`), nothing is lost, and no
  false "marked" claim is rendered. `attendance_marks.field_operator_id` has no FK
  (`20260831180408:29-32`), so this scoping is what keeps orphan inserts impossible from this
  client.
- **`AttendanceMark.Value` stays out of this path** (C12) — pinned by the architecture test in 3.5b.

### Task 3.5a — The wire contract (sync-contract)

**Files**
- Modify: `sync-contract/schemas/mutation-types.json` (32 entries; `version: "1.0.0"`,
  `lastUpdated: "2026-04-30"` at :3-4)
- Create: `sync-contract/schemas/payloads/attendance_mark.zod.ts`
- Modify: `sync-contract/schemas/payloads/index.ts`
- Modify: `sync-contract/tests/catalog.test.ts` (:26-28 `declares 32 mutations`)
- Modify: `sync-contract/tests/allowlist-parity.test.ts` (`EXPECTED_ALLOWLIST_COUNT = 14` at
  :52; `EXPECTED_GUARDED_MUTATIONS` :59-77)
- Regenerated (never hand-edited — header `SyncMutationCatalog.cs:1-5` says so):
  `src/apps/ShramSafal/ShramSafal.Application/Contracts/Sync/SyncMutationCatalog.cs`,
  `src/clients/mobile-web/src/infrastructure/sync/SyncMutationCatalog.ts`,
  `sync-contract/schemas/payloads-csharp/AttendanceMarkPayload.cs`

**Steps**

- [ ] **3.5a.1 — failing tests first.** In `catalog.test.ts` change 32→33 in both the test name
  and `toHaveLength`; in `allowlist-parity.test.ts` set `EXPECTED_ALLOWLIST_COUNT = 15` and add
  `'attendance.mark',` to `EXPECTED_GUARDED_MUTATIONS` (the array is `.sort()`ed — place it
  after `'add_cost_entry'` for readability). Run `cd sync-contract && npm test` → **both fail**
  (catalog has 32; no allow-list exists yet). These constants are load-bearing: step 3.5a.2's
  schema is only *verifiable* because the parity gate closes the `PayloadValidator.ts:46-53`
  fail-open trap (a name miss silently enqueues unvalidated payloads).
- [ ] **3.5a.2 — the contract.** In `mutation-types.json`, append after the last `jobcard.*`
  entry (keeping the column alignment of the block at :6-38):

```json
    { "name": "attendance.mark",        "ownerAggregate": "AttendanceMark",   "sinceVersion": "0.9.0", "payloadSchema": "AttendanceMark" }
```
  and bump `"version": "1.1.0"`, `"lastUpdated": "2026-09-02"`. Create
  `sync-contract/schemas/payloads/attendance_mark.zod.ts`:

```ts
// Labour V2 R1 — canonical payload for the attendance.mark mutation. The
// shape mirrors PushSyncBatchHandler.HandleAttendanceMarkAsync's PayloadHasOnly
// allow-list; set equality is enforced by tests/allowlist-parity.test.ts.
//
// ABSENCE IS UNMARKED. dayMark/nightMark deliberately have no 'Unmarked'
// member: an omitted key means "nobody said" (AttendanceMark's fourth state),
// and the server maps absence to the enum zero explicitly. A payload stating
// NOTHING (all four fact keys absent) is refused server-side — "both halves
// unmarked is the absence of a mark" (AttendanceMark.cs) — not refined here,
// because a ZodEffects wrapper would blind the parity gate's key-set read.
//
// NO hoursBasis on the wire: the server stamps Explicit when hours are stated,
// Unspecified otherwise. Provenance is derived from the path, never claimed
// by the client. NO money, ever (D9.9: the mark carries no money column).
import { z } from 'zod';
import { ZGuid } from './_shared.zod';

export const AttendanceDayMarkEnum = z.enum(['Full', 'Half', 'Absent']);
export const AttendanceNightMarkEnum = z.enum(['Worked', 'NotWorked']);

const ZWorkDate = z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD');

export const AttendanceMarkPayload = z.object({
    attendanceMarkId: ZGuid,
    farmId: ZGuid,
    fieldOperatorId: ZGuid,
    workDate: ZWorkDate,
    dayMark: AttendanceDayMarkEnum.optional(),
    nightMark: AttendanceNightMarkEnum.optional(),
    // Stated as hour COUNTS, never converted into day fractions (founder §1).
    hoursWorked: z.number().positive().optional(),
    extraHours: z.number().positive().optional(),
    // Present only when re-invoking with the farmer's answer to the
    // AttendanceContradiction question — the engagement he sided with.
    resolvedLabourAssignmentId: ZGuid.optional(),
});

export type AttendanceMarkPayloadType = z.infer<typeof AttendanceMarkPayload>;
```
  Export from `sync-contract/schemas/payloads/index.ts` following the file's existing
  export lines: `export * from './attendance_mark.zod';` — **the export name is exactly
  `AttendanceMarkPayload`**: `PayloadValidator.ts:46-47` resolves `<payloadSchema>Payload`
  against the barrel and fails OPEN on a miss.
- [ ] **3.5a.3 — regenerate.** `cd sync-contract && npm run generate` — commits the three
  regenerated files listed above. Verify `SyncMutationName.AttendanceMark` appears in the
  client catalog (`grep -n "AttendanceMark" src/clients/mobile-web/src/infrastructure/sync/SyncMutationCatalog.ts`).
- [ ] **3.5a.4 — run.** `cd sync-contract && npm test` → catalog test green (33); parity test
  **still red** on the missing server allow-list — expected and honest: it goes green in 3.5b.4
  which lands in the same PR. (If the working agreement requires every commit green, squash
  3.5a+3.5b into one commit at the end of 3.5b instead; do not weaken the constants.)
- [ ] **3.5a.5 — commit** (or hold per the note above).
  `feat(sync-contract): attendance.mark mutation @ 0.9.0 with AttendanceMarkPayload (Task 3.5a)`

### Task 3.5b — The server seam: RecordAttendanceMarkHandler + dispatch

**Files**
- Create: `ShramSafal.Application/UseCases/Labour/RecordAttendanceMark/RecordAttendanceMarkCommand.cs`,
  `RecordAttendanceMarkResult.cs`, `RecordAttendanceMarkHandler.cs`
- Modify: `ShramSafal.Application/Ports/IShramSafalRepository.cs` — add the three members from
  the Interfaces section, beside the attendance block at :919-938 (`AddAttendanceMarkCorrectionAsync`
  default-bodied like `AddLabourCorrectionAsync` :892-893; the facts read THROWS like
  `GetAttendanceMarksForFarmInWindowAsync` :919-923 — "no contradiction found" is a positive claim)
- Modify: `ShramSafal.Infrastructure/Persistence/Repositories/ShramSafalRepository.cs` — three
  implementations beside :1577-1610
- Modify: `ShramSafal.Application/UseCases/Sync/PushSyncBatch/PushSyncBatchHandler.cs` — ctor
  param beside `AddCostEntryHandler addCostEntryHandler` (:92), dispatch case after
  `"testinstance.reported"` (:670-671), `HandleAttendanceMarkAsync` after
  `HandleAddCostEntryAsync` (ends :1626)
- Modify: `ShramSafal.Api/DependencyInjection.cs` — `services.AddScoped<...RecordAttendanceMark.RecordAttendanceMarkHandler>();`
  beside the labour handler registration (:846)
- Create: `src/tests/ShramSafal.Domain.Tests/Labour/Handlers/RecordAttendanceMarkHandlerTests.cs`
- Modify: `src/tests/AgriSync.ArchitectureTests/LabourAnchorRules.cs` — the construction pin

**Steps**

- [ ] **3.5b.1 — failing handler tests.** `RecordAttendanceMarkHandlerTests.cs`, in the
  `CreateFieldOperatorHandlerTests` idiom (FakeRepo : StubShramSafalRepository; private
  `FixedClock`/`SequentialIdGenerator` as in that file :117-127):

```csharp
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using FluentAssertions;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.Labour.RecordAttendanceMark;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Labour;
using ShramSafal.Domain.Tests.Work.Handlers;
using Xunit;

namespace ShramSafal.Domain.Tests.Labour.Handlers;

public sealed class RecordAttendanceMarkHandlerTests
{
    private static readonly DateTime Now = new(2026, 9, 2, 6, 0, 0, DateTimeKind.Utc);
    private static readonly Guid Farm = Guid.Parse("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
    private static readonly Guid OtherFarm = Guid.Parse("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");
    private static readonly Guid Caller = Guid.Parse("cccccccc-cccc-cccc-cccc-cccccccccccc");
    private static readonly Guid Ganesh = Guid.Parse("dddddddd-dddd-dddd-dddd-dddddddddddd");
    private static readonly DateOnly Day = new(2026, 9, 2);

    private static RecordAttendanceMarkCommand Cmd(
        DayMark day = DayMark.Full, NightMark night = NightMark.Unmarked,
        decimal? hours = null, decimal? extra = null, Guid? resolved = null) =>
        new(Guid.NewGuid(), Farm, Ganesh, Day, day, night, hours, extra, resolved, Caller);

    private static RecordAttendanceMarkHandler Build(FakeRepo repo) =>
        new(repo, new SequentialIdGenerator(), new FixedClock(Now));

    private static FakeRepo Repo(AppRole? role = AppRole.PrimaryOwner)
    {
        var repo = new FakeRepo();
        if (role is { } r) repo.SetRole(Farm, Caller, r);
        repo.SeedOperator(FieldOperator.Create(Ganesh, "गणेश", null, new FarmId(Farm), new UserId(Caller), Now));
        return repo;
    }

    [Fact]
    public async Task No_authority_is_Forbidden_and_stages_nothing()
    {
        var repo = Repo(role: null);
        var result = await Build(repo).HandleAsync(Cmd());
        result.IsFailure.Should().BeTrue();
        result.Error.Code.Should().Contain("Forbidden");
        repo.AddedMarks.Should().BeEmpty();
        repo.SaveCalls.Should().Be(0);
    }

    [Fact]
    public async Task A_subject_from_another_farm_is_Forbidden_never_NotFound()
    {
        var repo = Repo();
        repo.SeedOperator(FieldOperator.Create(Guid.NewGuid(), "परका", null, new FarmId(OtherFarm), new UserId(Caller), Now));
        var foreign = Cmd() with { FieldOperatorId = repo.LastSeededOperatorId };
        var result = await Build(repo).HandleAsync(foreign);
        result.IsFailure.Should().BeTrue();
        result.Error.Code.Should().Contain("Forbidden");
    }

    [Fact]
    public async Task A_command_stating_nothing_is_InvalidCommand_before_the_domain_throws()
    {
        var repo = Repo();
        var result = await Build(repo).HandleAsync(Cmd(day: DayMark.Unmarked, night: NightMark.Unmarked));
        result.IsFailure.Should().BeTrue();
        result.Error.Code.Should().Contain("InvalidCommand");
    }

    [Fact]
    public async Task First_ruling_is_Recorded_with_ONE_SaveChanges_and_no_correction()
    {
        var repo = Repo();
        var result = await Build(repo).HandleAsync(Cmd());
        result.IsSuccess.Should().BeTrue();
        result.Value!.Outcome.Should().Be(AttendanceDayOutcome.Recorded);
        repo.AddedMarks.Should().ContainSingle(m => m.Day == DayMark.Full);
        repo.AddedCorrections.Should().BeEmpty();
        repo.SaveCalls.Should().Be(1);
    }

    [Fact]
    public async Task Stated_hours_persist_as_stated_with_Explicit_basis_and_no_day_fraction()
    {
        var repo = Repo();
        var result = await Build(repo).HandleAsync(Cmd(day: DayMark.Unmarked, night: NightMark.Worked, hours: 3m));
        result.IsSuccess.Should().BeTrue();
        var mark = repo.AddedMarks.Single();
        mark.Night.Should().Be(NightMark.Worked);
        mark.HoursWorked.Should().Be(3m);                       // stated, never converted
        mark.HoursBasis.Should().Be(LabourTimeBasis.Explicit);  // provenance from the path
        mark.Day.Should().Be(DayMark.Unmarked);                 // silence stays silence
    }

    [Fact]
    public async Task Two_disagreeing_engagement_facts_return_Contradicted_and_stage_nothing()
    {
        var repo = Repo();
        repo.SeedFacts(Ganesh, Day,
            new AttendanceEngagementFact(Guid.NewGuid(), "छाटणी", LabourShift.Full),
            new AttendanceEngagementFact(Guid.NewGuid(), "फवारणी", LabourShift.Half));
        var result = await Build(repo).HandleAsync(Cmd());
        result.IsSuccess.Should().BeTrue();                     // an outcome, not an error
        result.Value!.Outcome.Should().Be(AttendanceDayOutcome.Contradicted);
        result.Value!.Contradiction!.Candidates.Should().HaveCount(2);
        result.Value!.Contradiction!.DisplayNameAtAttach.Should().Be("गणेश");
        repo.AddedMarks.Should().BeEmpty();
        repo.SaveCalls.Should().Be(0);
    }

    [Fact]
    public async Task Two_CONSISTENT_facts_ask_nothing()
    {
        var repo = Repo();
        var a = Guid.NewGuid();
        repo.SeedFacts(Ganesh, Day,
            new AttendanceEngagementFact(a, "छाटणी", LabourShift.Full),
            new AttendanceEngagementFact(Guid.NewGuid(), "खत", LabourShift.Full));
        var result = await Build(repo).HandleAsync(Cmd());
        result.Value!.Outcome.Should().Be(AttendanceDayOutcome.Recorded);
    }

    [Fact]
    public async Task The_answer_reinvokes_with_resolvedLabourAssignmentId_and_records()
    {
        var repo = Repo();
        var sided = Guid.NewGuid();
        repo.SeedFacts(Ganesh, Day,
            new AttendanceEngagementFact(sided, "छाटणी", LabourShift.Full),
            new AttendanceEngagementFact(Guid.NewGuid(), "फवारणी", LabourShift.Half));
        var result = await Build(repo).HandleAsync(Cmd(resolved: sided));
        result.Value!.Outcome.Should().Be(AttendanceDayOutcome.Recorded);
        repo.AddedMarks.Should().ContainSingle();
    }

    [Fact]
    public async Task An_identical_repeat_is_Recorded_idempotently_without_amending()
    {
        var repo = Repo();
        var existing = AttendanceMark.Create(Guid.NewGuid(), new FarmId(Farm), Ganesh, Day,
            DayMark.Full, NightMark.Unmarked, new UserId(Caller), Now);
        repo.SeedMark(existing);
        var result = await Build(repo).HandleAsync(Cmd());
        result.Value!.Outcome.Should().Be(AttendanceDayOutcome.Recorded);
        result.Value!.AttendanceMarkId.Should().Be(existing.Id);
        repo.AddedMarks.Should().BeEmpty();
        repo.AddedCorrections.Should().BeEmpty();
    }

    [Fact]
    public async Task A_changed_ruling_amends_and_the_correction_rows_ride_the_same_commit()
    {
        var repo = Repo();
        var existing = AttendanceMark.Create(Guid.NewGuid(), new FarmId(Farm), Ganesh, Day,
            DayMark.Full, NightMark.Unmarked, new UserId(Caller), Now);
        repo.SeedMark(existing);
        var result = await Build(repo).HandleAsync(Cmd(day: DayMark.Half));
        result.Value!.Outcome.Should().Be(AttendanceDayOutcome.Recorded);
        existing.Day.Should().Be(DayMark.Half);
        repo.AddedCorrections.Should().ContainSingle(c =>
            c.ChangedField == AttendanceMarkCorrection.DayField
            && c.OriginalValue == "Full" && c.NewValue == "Half");
        repo.SaveCalls.Should().Be(1);
    }
}
```
  FakeRepo (nested in the same file, `AttachFieldOperatorHandlerTests.cs:230-269` idiom):
  overrides `GetUserRoleForFarmAsync`, `GetLabourManagementGrantAsync` (false),
  `GetFieldOperatorByIdAsync`, `GetAttendanceEngagementFactsAsync` (seeded list, default `[]`
  **in the fake only**), `GetAttendanceMarkAsync`, `AddAttendanceMarkAsync` (collect →
  `AddedMarks`), `AddAttendanceMarkCorrectionAsync` (collect → `AddedCorrections`),
  `SaveChangesAsync` (count → `SaveCalls`); helpers `SetRole`, `SeedOperator` (+
  `LastSeededOperatorId`), `SeedFacts`, `SeedMark`.

- [ ] **3.5b.2 — see them fail.**
  `dotnet test src/tests/ShramSafal.Domain.Tests/ShramSafal.Domain.Tests.csproj --filter "FullyQualifiedName~RecordAttendanceMark"`
  → compile errors (namespace absent) — that IS the failing state for a not-yet-written unit.

- [ ] **3.5b.3 — implement.** Port members + repository implementations exactly as declared in
  the Interfaces section. Repository (`Persistence/Repositories/ShramSafalRepository.cs`, beside :1577):

```csharp
    public async Task<IReadOnlyList<AttendanceEngagementFact>> GetAttendanceEngagementFactsAsync(
        FarmId farmId, Guid fieldOperatorId, DateOnly workDate, CancellationToken ct = default)
    {
        // Projection-only, AsNoTracking — the same discipline as
        // GetLabourAssignmentOwnerLogIdsAsync (IShramSafalRepository.cs:705-715):
        // this read exists so RecordAttendanceMarkHandler can refuse the
        // contradiction BEFORE anything is staged, and name it. The explicit
        // farm Where is mandatory: p_user_select_* policies are PERMISSIVE and
        // OR past the tenant policy (Phase 0, UNKNOWN 5).
        return await (
            from row in db.FieldOperatorWorkRows.AsNoTracking()
            join a in db.LabourAssignments.AsNoTracking() on row.LabourAssignmentId equals a.Id
            join log in db.DailyLogs.AsNoTracking() on a.DailyLogId equals log.Id
            where row.FieldOperatorId == fieldOperatorId
                  && log.FarmId == farmId
                  && log.LogDate == workDate
            select new AttendanceEngagementFact(a.Id, a.Task, a.Shift)
        ).ToListAsync(ct);
    }

    public async Task AddAttendanceMarkCorrectionAsync(
        AttendanceMarkCorrection correction, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(correction);
        // Staged only — the caller commits it with the amendment it explains,
        // so the change can never land without its record (same contract as
        // AddLabourCorrectionAsync / RemoveFieldOperatorWorkRowAsync).
        await db.AttendanceMarkCorrections.AddAsync(correction, ct);
    }

    public async Task<List<AttendanceMark>> GetAttendanceMarksChangedSinceAsync(
        IEnumerable<Guid> farmIds, DateTime sinceUtc, CancellationToken ct = default)
    {
        var ids = NormalizeFarmIds(farmIds);
        if (ids.Count == 0) return [];
        return await db.AttendanceMarks
            .AsNoTracking()
            .Where(m => ids.Contains((Guid)m.FarmId) && m.ModifiedAtUtc > sinceUtc)
            .OrderBy(m => m.ModifiedAtUtc)
            .ToListAsync(ct);
    }
```
  `RecordAttendanceMarkResult.cs` (the four types from the Interfaces section, verbatim, with
  the Phase 0 doc comments: at most ONE contradiction per person per day; `Candidates` lists
  only the facts that disagree; deliberately **no `text` member** — the Marathi lives in
  `attendanceCopy.ts`, the server never composes a farmer-facing sentence).
  `RecordAttendanceMarkHandler.cs`:

```csharp
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Services;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Labour;

namespace ShramSafal.Application.UseCases.Labour.RecordAttendanceMark;

/// <summary>
/// Labour V2 R1 Task 3.5 — the ONE production construction site for
/// <see cref="AttendanceMark"/> (pinned by LabourAnchorRules).
///
/// <para><b>Validation order is CorrectLabourHandler's, and it is structural:</b>
/// TenantTransactionMiddleware commits whenever the pipeline returns without
/// throwing, so every refusal — authority, cross-farm subject, the
/// contradiction — happens BEFORE the first staged change (CorrectLabourHandler.cs
/// header: "Do not move a validation below the staging block").</para>
///
/// <para><b>The contradiction is an OUTCOME, not an error.</b> Two of today's
/// engagements claiming different day-facts for this person is a fact the
/// farmer must rule on; Result.Failure would misfile it as our mistake. The
/// deterministic rule is GetLabourDataHandler.cs:602-612 lifted from per-log
/// to per-(farm, operator, day): report only when MORE than one distinct
/// fact survives; the answer re-invokes with ResolvedLabourAssignmentId.</para>
///
/// <para><b>Commit point:</b> exactly one SaveChangesAsync (AddCostEntryHandler.cs:213
/// precedent), and NO TryStoreSuccessAsync — PushSyncBatchHandler owns the
/// idempotency store at :522 (two owners would consume two keys,
/// CorrectLabourHandler.cs:40-44).</para>
///
/// <para><b>AttendanceMark.Value is never read here or anywhere on R1 paths</b>
/// (C12: it turns silence into zero; the architecture pin enforces the
/// construction site, the review rule enforces the read side).</para>
/// </summary>
public sealed class RecordAttendanceMarkHandler(
    IShramSafalRepository repository,
    IIdGenerator idGenerator,
    IClock clock)
{
    public async Task<Result<RecordAttendanceMarkResult>> HandleAsync(
        RecordAttendanceMarkCommand command, CancellationToken ct = default)
    {
        // 1 — shape. Refuse the empty ruling here, before the domain throws:
        // an ArgumentException on this path would surface as a 500, not a refusal.
        if (command.FarmId == Guid.Empty || command.FieldOperatorId == Guid.Empty
            || command.AttendanceMarkId == Guid.Empty || command.RecordedByUserId == Guid.Empty
            || (command.Day == DayMark.Unmarked && command.Night == NightMark.Unmarked
                && command.HoursWorked is null && command.ExtraHours is null)
            || command.HoursWorked is <= 0 || command.ExtraHours is <= 0)
        {
            return Result.Failure<RecordAttendanceMarkResult>(ShramSafalErrors.InvalidCommand);
        }

        var now = clock.UtcNow;

        // 2 — write authority: the SAME single predicate every governed labour
        // action asks (no attendance-specific flag, Correction 1), evaluated at
        // this moment (Task 2.2: expiry denies forward). Forbidden, never
        // NotFound (LabourManagementGate.cs:50-53).
        var allowed = await LabourManagementGate.IsAllowedAsync(
            repository, command.FarmId, command.RecordedByUserId, now, ct);
        if (!allowed)
        {
            return Result.Failure<RecordAttendanceMarkResult>(ShramSafalErrors.Forbidden);
        }

        // 3 — the subject originated on THIS farm (AttachFieldOperatorHandler:113-118
        // idiom; PERMISSIVE user-select policies make this mandatory, and
        // attendance_marks.field_operator_id has no FK to catch an orphan).
        var subject = await repository.GetFieldOperatorByIdAsync(command.FieldOperatorId, ct);
        if (subject is null || (Guid)subject.OriginatingFarmId != command.FarmId)
        {
            return Result.Failure<RecordAttendanceMarkResult>(ShramSafalErrors.Forbidden);
        }

        // 4 — the pre-persistence semantic check, strictly before staging.
        if (command.ResolvedLabourAssignmentId is null)
        {
            var facts = await repository.GetAttendanceEngagementFactsAsync(
                new FarmId(command.FarmId), command.FieldOperatorId, command.WorkDate, ct);
            var claiming = facts.Where(f => f.Shift is not null).ToList();
            if (claiming.Select(f => f.Shift!.Value).Distinct().Count() > 1)
            {
                var candidates = claiming
                    .Select(f => new DayFactCandidate(
                        f.LabourAssignmentId, f.Task, PlotName: null,
                        Day: f.Shift switch
                        {
                            LabourShift.Full => DayMark.Full,
                            LabourShift.Half => DayMark.Half,
                            _ => DayMark.Unmarked,
                        },
                        Night: f.Shift == LabourShift.Night ? NightMark.Worked : NightMark.Unmarked))
                    .ToList();
                return Result.Success(new RecordAttendanceMarkResult(
                    AttendanceDayOutcome.Contradicted,
                    AttendanceMarkId: null,
                    new AttendanceDayContradiction(
                        command.FieldOperatorId, subject.DisplayName, command.WorkDate, candidates)));
            }
        }

        var basis = command.HoursWorked is not null || command.ExtraHours is not null
            ? LabourTimeBasis.Explicit
            : LabourTimeBasis.Unspecified;

        // 5 — record or amend. One ruling per person per farm-day (the unique
        // index); a repeat of the same fact is idempotent, a changed fact
        // amends THROUGH the entity and commits WITH its correction rows.
        var existing = await repository.GetAttendanceMarkAsync(
            new FarmId(command.FarmId), command.FieldOperatorId, command.WorkDate, ct);

        if (existing is null)
        {
            var mark = AttendanceMark.Create(
                command.AttendanceMarkId, new FarmId(command.FarmId), command.FieldOperatorId,
                command.WorkDate, command.Day, command.Night,
                new UserId(command.RecordedByUserId), now,
                command.HoursWorked, command.ExtraHours, basis);
            await repository.AddAttendanceMarkAsync(mark, ct);
            await repository.SaveChangesAsync(ct);
            return Result.Success(new RecordAttendanceMarkResult(
                AttendanceDayOutcome.Recorded, mark.Id, Contradiction: null));
        }

        if (existing.Day == command.Day && existing.Night == command.Night
            && existing.HoursWorked == command.HoursWorked && existing.ExtraHours == command.ExtraHours)
        {
            return Result.Success(new RecordAttendanceMarkResult(
                AttendanceDayOutcome.Recorded, existing.Id, Contradiction: null));
        }

        AttendanceMarkPreviousValues previous;
        try
        {
            previous = existing.Amend(
                command.Day, command.Night, command.HoursWorked, command.ExtraHours,
                basis, new UserId(command.RecordedByUserId), now);
        }
        catch (ArgumentException)
        {
            // The domain refused the amendment (e.g. null-ing stated hours —
            // "an amendment may restate them, never silently drop them", Task
            // 2.5). A refusal, not our fault: InvalidCommand, never a 500.
            return Result.Failure<RecordAttendanceMarkResult>(ShramSafalErrors.InvalidCommand);
        }

        foreach (var row in BuildCorrections(existing.Id, command, previous, basis, now))
        {
            await repository.AddAttendanceMarkCorrectionAsync(row, ct);
        }
        await repository.SaveChangesAsync(ct);
        return Result.Success(new RecordAttendanceMarkResult(
            AttendanceDayOutcome.Recorded, existing.Id, Contradiction: null));
    }

    private IEnumerable<AttendanceMarkCorrection> BuildCorrections(
        Guid markId, RecordAttendanceMarkCommand command,
        AttendanceMarkPreviousValues previous, LabourTimeBasis basis, DateTime now)
    {
        var by = new UserId(command.RecordedByUserId);
        var farm = new FarmId(command.FarmId);
        if (previous.Day != command.Day)
            yield return AttendanceMarkCorrection.Create(idGenerator.New(), markId, farm,
                AttendanceMarkCorrection.DayField, previous.Day.ToString(), command.Day.ToString(), by, now);
        if (previous.Night != command.Night)
            yield return AttendanceMarkCorrection.Create(idGenerator.New(), markId, farm,
                AttendanceMarkCorrection.NightField, previous.Night.ToString(), command.Night.ToString(), by, now);
        if (previous.HoursWorked != command.HoursWorked)
            yield return AttendanceMarkCorrection.Create(idGenerator.New(), markId, farm,
                AttendanceMarkCorrection.HoursWorkedField,
                Format(previous.HoursWorked, previous.HoursBasis), Format(command.HoursWorked, basis), by, now);
        if (previous.ExtraHours != command.ExtraHours)
            yield return AttendanceMarkCorrection.Create(idGenerator.New(), markId, farm,
                AttendanceMarkCorrection.ExtraHoursField,
                Format(previous.ExtraHours, previous.HoursBasis), Format(command.ExtraHours, basis), by, now);
    }

    // Values carry their basis (the LabourCorrection FieldDurationHours idiom,
    // "8|Assumed"): ONE way to write an hours value into a correction row —
    // AttendanceMarkCorrection.FormatHours, Phase 2 Task 2.5. null = "absent on
    // this side of the change" (legal for the two hours fields only; Phase 2
    // relaxed the blank check per-field).
    private static string? Format(decimal? value, LabourTimeBasis basis) =>
        value is { } hours ? AttendanceMarkCorrection.FormatHours(hours, basis) : null;
}
```
  (If `idGenerator.New()` is not the repo's `IIdGenerator` member name, use the member
  `SequentialIdGenerator` implements in `CreateFieldOperatorHandlerTests.cs:117-121` —
  match, don't invent.)

- [ ] **3.5b.4 — sync dispatch.** In `PushSyncBatchHandler.cs`: ctor gains
  `ShramSafal.Application.UseCases.Labour.RecordAttendanceMark.RecordAttendanceMarkHandler recordAttendanceMarkHandler,`
  beside :92; dispatch case after :671:

```csharp
            case "attendance.mark":
                return await HandleAttendanceMarkAsync(clientRequestId, payload, actorUserId, actorRole, ct);
```
  and after `HandleAddCostEntryAsync` (:1626):

```csharp
    private async Task<MutationExecutionOutcome> HandleAttendanceMarkAsync(
        string clientRequestId,
        JsonElement payload,
        Guid actorUserId,
        string actorRole,
        CancellationToken ct)
    {
        // Set equality with attendance_mark.zod.ts is enforced by
        // sync-contract/tests/allowlist-parity.test.ts, which parses THIS line —
        // so it must stay on one line.
        if (!PayloadHasOnly(payload, "attendanceMarkId", "farmId", "fieldOperatorId", "workDate", "dayMark", "nightMark", "hoursWorked", "extraHours", "resolvedLabourAssignmentId"))
        {
            return MutationExecutionOutcome.Failure(
                "ShramSafal.SyncInvalidPayload",
                "attendance.mark payload contains unsupported fields.");
        }

        var request = DeserializePayload<AttendanceMarkPayload>(payload);
        if (request is null)
        {
            return MutationExecutionOutcome.Failure("ShramSafal.SyncInvalidPayload", "Invalid payload for attendance.mark.");
        }

        // Closed vocabularies, mapped TOTALLY like `direction` in
        // HandleAddCostEntryAsync. Absence = Unmarked — "nobody said" is a
        // fourth state, never a guess; an unrecognised value is a broken
        // producer and is refused, never demoted to unknown.
        DayMark day;
        switch (request.DayMark)
        {
            case null or "": day = DayMark.Unmarked; break;
            case "Full": day = DayMark.Full; break;
            case "Half": day = DayMark.Half; break;
            case "Absent": day = DayMark.Absent; break;
            default:
                return MutationExecutionOutcome.Failure(
                    "ShramSafal.SyncInvalidPayload", "attendance.mark payload carries an unrecognised dayMark.");
        }
        NightMark night;
        switch (request.NightMark)
        {
            case null or "": night = NightMark.Unmarked; break;
            case "Worked": night = NightMark.Worked; break;
            case "NotWorked": night = NightMark.NotWorked; break;
            default:
                return MutationExecutionOutcome.Failure(
                    "ShramSafal.SyncInvalidPayload", "attendance.mark payload carries an unrecognised nightMark.");
        }
        if (!DateOnly.TryParseExact(request.WorkDate, "yyyy-MM-dd", out var workDate))
        {
            return MutationExecutionOutcome.Failure(
                "ShramSafal.SyncInvalidPayload", "attendance.mark payload carries an invalid workDate.");
        }

        // C5 — /sync/ is on TenantTransactionMiddleware's skip list (:225), so no
        // GUC is set until this call, and p_tenant_attendance_marks' WITH CHECK
        // (20260831180408:57) would refuse the INSERT with a NULL comparison.
        // EstablishFarmScopeForDerivationAsync is what makes the mark writable here.
        var (isMember, _) = await EstablishFarmScopeForDerivationAsync(request.FarmId, actorUserId, ct);
        if (!isMember)
        {
            return MutationExecutionOutcome.Failure("ShramSafal.Forbidden", "User is not a member of the target farm.");
        }

        var result = await recordAttendanceMarkHandler.HandleAsync(
            new UseCases.Labour.RecordAttendanceMark.RecordAttendanceMarkCommand(
                request.AttendanceMarkId, request.FarmId, request.FieldOperatorId, workDate,
                day, night, request.HoursWorked, request.ExtraHours,
                request.ResolvedLabourAssignmentId, actorUserId),
            ct);

        if (result.IsSuccess
            && result.Value.Outcome == UseCases.Labour.RecordAttendanceMark.AttendanceDayOutcome.Contradicted)
        {
            // A fact the OWNER must rule on, surfaced to the device as a
            // PERMANENT rejection (the answer arrives as a NEW mutation carrying
            // resolvedLabourAssignmentId — re-pushing these bytes can never
            // succeed). Nothing was staged: the check runs pre-staging, so the
            // rollback above this frame has nothing to lose.
            return MutationExecutionOutcome.Failure(
                "ShramSafal.AttendanceContradiction",
                "Two of today's works claim different attendance for this person. Answer in Labour, then it will sync.");
        }

        return ToOutcome(result);
    }
```
  Register in `ShramSafal.Api/DependencyInjection.cs` beside :846:
  `services.AddScoped<ShramSafal.Application.UseCases.Labour.RecordAttendanceMark.RecordAttendanceMarkHandler>();`
  Generated payload type: if `npm run generate` emits nullable `Guid?` for optional ZGuid
  members, adapt the two optional-guid reads (`request.ResolvedLabourAssignmentId`) to the
  generated shape — the generated file is authority, never hand-edit it.

- [ ] **3.5b.5 — the architecture pin.** In `LabourAnchorRules.cs`, after PIN 2, the
  `:39-56` idiom exactly (StripComments + Contains + ContainSingle + exact path — never a regex):

```csharp
    private const string RecordAttendanceMarkHandlerPath =
        "apps/ShramSafal/ShramSafal.Application/UseCases/Labour/RecordAttendanceMark/RecordAttendanceMarkHandler.cs";

    /// <summary>
    /// PIN 3 — Labour V2 R1: exactly one production construction site for the
    /// attendance ruling, and it is the handler that runs the write-authority
    /// gate and the pre-persistence contradiction check. A second producer
    /// would be a path around both, and the SQL unique index would become the
    /// farmer's error message (23505 → "A database constraint rejected this
    /// mutation").
    /// </summary>
    [Fact]
    public void AttendanceMark_is_constructed_in_exactly_one_production_file()
    {
        var producers = ProductionSourceFiles()
            .Where(path => StripComments(File.ReadAllText(path))
                .Contains("AttendanceMark.Create(", StringComparison.Ordinal))
            .Select(Relative)
            .OrderBy(path => path, StringComparer.Ordinal)
            .ToArray();

        producers.Should().ContainSingle(
            "every attendance ruling must pass RecordAttendanceMarkHandler's gate and " +
            $"contradiction check. Found: [{string.Join(", ", producers)}]");

        producers[0].Should().Be(RecordAttendanceMarkHandlerPath,
            "the single construction site must be the gated handler, not whichever caller got there first");
    }
```

- [ ] **3.5b.6 — run and pass.**
  `dotnet test src/tests/ShramSafal.Domain.Tests/ShramSafal.Domain.Tests.csproj --filter "FullyQualifiedName~RecordAttendanceMark"` → green;
  `cd sync-contract && npm test` → parity now green (15 allow-lists, key-set equality holds);
  `dotnet test src/tests/AgriSync.ArchitectureTests/AgriSync.ArchitectureTests.csproj` → green
  (PIN 3 + `MutationContractIsBatchLevelOnly` + the dispatch-case scan);
  `dotnet build src/AgriSync.sln` → clean.

- [ ] **3.5b.7 — commit.**
  `feat(ssf): RecordAttendanceMarkHandler + attendance.mark sync dispatch (Task 3.5b)`

### Task 3.5c — The client half: queue command, Dexie v25, pull carriage, real save

**Files**
- Create: `application/usecases/sync/MarkAttendanceCommand.ts`
- Create: `infrastructure/storage/dexie/versions/v25.ts`
- Modify: `infrastructure/storage/DexieDatabase.ts` (:110 `DATABASE_VERSION = 24`, import list
  :19-42, chain end ~:262, table declarations :167-236)
- Create: `features/labour/data/attendanceLocal.ts`
- Modify: `infrastructure/api/dtos.ts` (`SyncPullResponse` at :443)
- Create: `features/sync/pull/reconcilers/attendanceReconciler.ts`
- Modify: `features/sync/pull/SyncPullReconciler.ts` (transaction store list :70-73, call :82 area)
- Modify: `features/sync/conflict/EditSurfaceRegistry.ts` (route union :36-44, registrations :150+)
- Modify: `infrastructure/sync/RejectionPolicy.ts` (family (b) block, after `'InvalidCommand'` :127)
- Modify: `features/labour/components/Attendance.tsx` (:25 Props, :103 button)
- Modify: `features/labour/components/LabourFeature.tsx` (:195-197 — **the fake save dies here**)
- Modify: `features/labour/components/AttendanceResult.tsx` (the 3.4b seam gains the enqueue)
- Modify (server, pull): `ShramSafal.Application/Contracts/Dtos/SyncDtos.cs` (:22-63),
  `ShramSafal.Application/UseCases/Sync/PullSyncChanges/PullSyncChangesHandler.cs`
  (fetch beside :119-121, response ctor :430-459, `ComputeNextCursor` :462+)
- Tests: `application/usecases/sync/__tests__/MarkAttendanceCommand.test.ts`,
  `features/sync/pull/__tests__/attendanceReconciler.test.ts`,
  existing `LabourReadBackPullTests.cs` sibling (server, 3.5d)

**Steps**

- [ ] **3.5c.1 — failing command test.** `application/usecases/sync/__tests__/MarkAttendanceCommand.test.ts`
  (follow the folder's existing test setup for fake-indexeddb / mutationQueue):

```ts
import { describe, it, expect } from 'vitest';
import { MarkAttendanceCommand } from '../MarkAttendanceCommand';

const base = {
    attendanceMarkId: '11111111-1111-1111-1111-111111111111',
    farmId: '22222222-2222-2222-2222-222222222222',
    fieldOperatorId: '33333333-3333-3333-3333-333333333333',
    workDate: '2026-09-02',
} as const;

describe('MarkAttendanceCommand — derivable, value-keyed idempotency', () => {
    it('the SAME fact twice derives the SAME clientRequestId (retry-safe)', async () => {
        const a = await MarkAttendanceCommand.enqueue({ ...base, dayMark: 'Full' });
        const b = await MarkAttendanceCommand.enqueue({ ...base, dayMark: 'Full' });
        expect(a).toBe(b);
        expect(a).toBe('attendance.mark:22222222-2222-2222-2222-222222222222:33333333-3333-3333-3333-333333333333:2026-09-02:Full:-:-:-');
    });
    it('a CHANGED ruling on the same person-day derives a DIFFERENT key (amendable)', async () => {
        const a = await MarkAttendanceCommand.enqueue({ ...base, dayMark: 'Full' });
        const b = await MarkAttendanceCommand.enqueue({ ...base, dayMark: 'Half' });
        expect(a).not.toBe(b);
    });
    it('a payload stating nothing is refused at the boundary — a mark must state something', async () => {
        await expect(MarkAttendanceCommand.enqueue({ ...base })).rejects.toThrow(/state/i);
    });
});
```

- [ ] **3.5c.2 — implement the command** (`AddLogTaskCommand.ts:12-20` shape):

```ts
import { mutationQueue } from '../../../infrastructure/sync/MutationQueue';
import { SyncMutationName } from '../../../infrastructure/sync/SyncMutationCatalog';

export interface AttendanceMarkPayload {
    attendanceMarkId: string;
    farmId: string;
    fieldOperatorId: string;
    /** YYYY-MM-DD — the farmer's day, not a timestamp. */
    workDate: string;
    /** Absent = Unmarked ("nobody said") — never a guess. */
    dayMark?: 'Full' | 'Half' | 'Absent';
    nightMark?: 'Worked' | 'NotWorked';
    hoursWorked?: number;
    extraHours?: number;
    resolvedLabourAssignmentId?: string;
}

export class MarkAttendanceCommand {
    /**
     * clientRequestId is a derivable VALUE-KEYED natural key: the row's natural
     * key (farm:operator:date — also the DB unique index) plus the stated
     * facts. Same fact re-tapped = same key = device+server dedupe
     * (MutationQueue &[deviceId+clientRequestId]; PushSyncBatchHandler:457).
     * A CHANGED ruling is a new REQUEST about the same row → new key → the
     * server handler amends through the entity. Never a random guid — a
     * random id turns the second tap into a 23505 told to the farmer as
     * "a database constraint rejected this mutation".
     */
    static async enqueue(payload: AttendanceMarkPayload): Promise<string> {
        if (payload.dayMark == null && payload.nightMark == null
            && payload.hoursWorked == null && payload.extraHours == null) {
            throw new Error('attendance.mark must state something — an empty ruling is the absence of a mark.');
        }
        const clientRequestId = [
            SyncMutationName.AttendanceMark,
            payload.farmId, payload.fieldOperatorId, payload.workDate,
            payload.dayMark ?? '-', payload.nightMark ?? '-',
            payload.hoursWorked ?? '-', payload.extraHours ?? '-',
        ].join(':');
        return mutationQueue.enqueue(SyncMutationName.AttendanceMark, payload, {
            clientRequestId,
            clientCommandId: clientRequestId,
        });
    }
}
```
  Run 3.5c.1's test → green (enqueue validates through `PayloadValidator`, which now finds
  `AttendanceMarkPayload` in the regenerated barrel — the fail-open trap is closed by 3.5a).

- [ ] **3.5c.3 — Dexie v25.** Create `infrastructure/storage/dexie/versions/v25.ts` re-listing
  **every v24 store verbatim** (`v24.ts:70-107` — a partial list silently deletes omitted
  stores; `v24.ts:59-60`: one-way for APK users, so this bump ships with the feature that
  needs it and nothing else) plus:

```ts
            // Labour V2 R1 Task 3.5c — server-acknowledged attendance marks,
            // carried down by /sync/pull. Grain matches ux_attendance_marks_
            // farm_operator_day. Queue rows in `mutationQueue` are the UNSYNCED
            // half; getLocalAttendanceMarks merges the two with `source` so no
            // reader can render intent as saved (P10).
            attendanceMarks: 'id, farmId, workDate, [farmId+workDate]',
```
  In `DexieDatabase.ts`: `DATABASE_VERSION = 25` (:110, keep the comment discipline),
  `import { applyV25 } from './dexie/versions/v25';`, `applyV25(this);` after `applyV24(this);`,
  and the table declaration
  `attendanceMarks!: Table<AttendanceMarkCacheRecord, string>;` with

```ts
export interface AttendanceMarkCacheRecord {
    id: string;
    farmId: string;
    fieldOperatorId: string;
    workDate: string;
    payload: import('../api/dtos').AttendanceMarkDto;
    updatedAt: string;
}
```
  (place the interface with the sibling cache records; fix the import path to wherever they
  live in that file's convention). Run `npm run check:dexie-version` → green.

- [ ] **3.5c.4 — pull carriage, server.** `SyncDtos.cs`: add before `DegradedComponents`:

```csharp
    // Labour V2 R1 — server-acknowledged attendance rulings. Enum names as
    // strings, NULL for Unmarked ("nobody said" survives the wire — never 0).
    IReadOnlyList<AttendanceMarkDto> AttendanceMarks,
```
  with the record beside the other DTOs (shape from the Interfaces section; `DayMark`/`NightMark`
  serialized as `mark.Day == DayMark.Unmarked ? null : mark.Day.ToString()` etc.,
  `HoursBasis` as its enum name, `WorkDate` as `"yyyy-MM-dd"`).
  `PullSyncChangesHandler.cs`: after the dayLedgers fetch (:120-121):

```csharp
        var attendanceMarks = (await repository.GetAttendanceMarksChangedSinceAsync(farmIds, sinceUtc, ct))
            .Where(m => farmIdSet.Contains((Guid)m.FarmId))
            .ToList();
```
  add `attendanceMarks` to `ComputeNextCursor`'s parameters and body
  (`if (attendanceMarks.Count > 0) maxTimestamp = Max(maxTimestamp, attendanceMarks.Max(m => m.ModifiedAtUtc));`)
  and to its call site (:178-190); map into the response ctor in the position matching the DTO
  (after `jobCardDtos`, before `degraded`) as
  `attendanceMarks.Select(m => m.ToDto()).ToList()` with the `ToDto` extension placed beside
  the labour mappings in `DtoMappingExtensions.cs`.
- [ ] **3.5c.5 — pull carriage, client.** `dtos.ts`: add to `SyncPullResponse` (optional —
  additive wire field): `attendanceMarks?: AttendanceMarkDto[];` and the interface:

```ts
export interface AttendanceMarkDto {
    id: string;
    farmId: string;
    fieldOperatorId: string;
    workDate: string;
    dayMark: string | null;
    nightMark: string | null;
    hoursWorked: number | null;
    extraHours: number | null;
    hoursBasis: string | null;
    recordedByUserId: string;
    recordedAtUtc: string;
    modifiedAtUtc: string;
}
```
  Create `features/sync/pull/reconcilers/attendanceReconciler.ts` (financeReconciler idiom —
  runs inside the orchestrator's transaction, `normalizeMojibakeDeep` each row):

```ts
import type { SyncPullResponse } from '../../../../infrastructure/api/AgriSyncClient';
import type { AgriLogDatabase } from '../../../../infrastructure/storage/DexieDatabase';
import { normalizeMojibakeDeep } from '../../../../shared/utils/textEncoding';

export async function reconcileAttendance(
    db: AgriLogDatabase,
    payload: SyncPullResponse,
    receivedAtUtc: string,
): Promise<void> {
    const marks = (payload.attendanceMarks ?? []).map(m => normalizeMojibakeDeep(m).value);
    for (const mark of marks) {
        await db.attendanceMarks.put({
            id: mark.id,
            farmId: mark.farmId,
            fieldOperatorId: mark.fieldOperatorId,
            workDate: mark.workDate,
            payload: mark,
            updatedAt: receivedAtUtc,
        });
    }
}
```
  Wire into `SyncPullReconciler.ts`: add `db.attendanceMarks` to the transaction store list
  (:70-73) and `await reconcileAttendance(db, payload, receivedAtUtc);` beside
  `reconcileFinance` (:82). Test `features/sync/pull/__tests__/attendanceReconciler.test.ts`
  in the folder's existing reconciler-test idiom: one pulled mark lands in
  `db.attendanceMarks`; a pull with the field absent is a no-op (old servers stay compatible).
- [ ] **3.5c.6 — the honest local read.** `features/labour/data/attendanceLocal.ts`:

```ts
/**
 * Labour V2 R1 — the ONE local read of attendance marks, both halves labelled.
 *
 * `source: 'server'` rows came down /sync/pull — acknowledged, reconstructable
 * without this device. `source: 'queue'` rows are PENDING/FAILED mutationQueue
 * intent — real, durable, and NOT SAVED YET. P10 binds every consumer: a
 * queue-sourced fact must render with the existing unsynced treatment
 * (लक्षात ठेवलं ✓ family), never as server truth. Phase 4's register consumes
 * this; it must not read the two stores separately and lose the label.
 */
import { getDatabase } from '../../../infrastructure/storage/DexieDatabase';
import type { AttendanceMarkPayload } from '../../../application/usecases/sync/MarkAttendanceCommand';
import { SyncMutationName } from '../../../infrastructure/sync/SyncMutationCatalog';

export interface LocalAttendanceMark {
    fieldOperatorId: string;
    workDate: string;
    dayMark?: string;
    nightMark?: string;
    hoursWorked?: number;
    extraHours?: number;
    source: 'server' | 'queue';
}

export async function getLocalAttendanceMarks(farmId: string): Promise<LocalAttendanceMark[]> {
    const db = getDatabase();
    const server = await db.attendanceMarks.where('farmId').equals(farmId).toArray();
    const queued = await db.mutationQueue
        .where('mutationType').equals(SyncMutationName.AttendanceMark)
        .filter(row => row.status !== 'APPLIED')
        .toArray();
    const out: LocalAttendanceMark[] = server.map(r => ({
        fieldOperatorId: r.fieldOperatorId,
        workDate: r.workDate,
        dayMark: r.payload.dayMark ?? undefined,
        nightMark: r.payload.nightMark ?? undefined,
        hoursWorked: r.payload.hoursWorked ?? undefined,
        extraHours: r.payload.extraHours ?? undefined,
        source: 'server',
    }));
    for (const row of queued) {
        const p = row.payload as AttendanceMarkPayload;
        if (p.farmId !== farmId) continue;
        out.push({
            fieldOperatorId: p.fieldOperatorId, workDate: p.workDate,
            dayMark: p.dayMark, nightMark: p.nightMark,
            hoursWorked: p.hoursWorked, extraHours: p.extraHours,
            source: 'queue',
        });
    }
    return out;
}
```
  (Adapt the mutationQueue field/status names to `MutationQueueItem`'s actual members —
  verify in `infrastructure/sync/MutationQueue.ts` before writing; `status !== 'APPLIED'`
  is the honest filter: FAILED intent is still intent.)
- [ ] **3.5c.7 — conflict surface + rejection class.** `EditSurfaceRegistry.ts`: add `'labour'`
  to `EditSurfaceRoute` (:36-44) and register
  `registerEditSurface(SyncMutationName.AttendanceMark, makeRouteHandler('labour'));`
  in `registerDefaultEditSurfaces()` — the labour route exists (`simpleRoutes.tsx:79`).
  `RejectionPolicy.ts`: in family (b) (:127-131) add:

```ts
    // Labour V2 R1 — the attendance contradiction. The server's answer to
    // these bytes can never change; the farmer's ANSWER travels as a NEW
    // attendance.mark carrying resolvedLabourAssignmentId. Parking it is what
    // surfaces the question; retrying it is re-asking a question already
    // answered.
    'AttendanceContradiction',
```
- [ ] **3.5c.8 — the fake save dies; the real saves land.**
  - `Attendance.tsx`: Props (:25) become
    `interface Props { data: LabourData; onSave: (marks: ManualAttendanceMark[]) => void; onToast: (m: string) => void }`
    with `export type ManualAttendanceMark = { fieldOperatorId: string; status: PresenceStatus };`
    and the button (:103) submits the state:
    `onClick={() => onSave(Object.entries(status).map(([fieldOperatorId, s]) => ({ fieldOperatorId, status: s })))}`.
    Status→mark mapping happens in the caller (one place):
    `present`+shift `full`→`{dayMark:'Full'}` · `present`+`half`→`{dayMark:'Half'}` ·
    `present`+`night`→`{nightMark:'Worked'}` · `half`→`{dayMark:'Half'}` · `absent`→`{dayMark:'Absent'}`.
    (The screen itself stays behind `SHOW_ATTENDANCE_TILE=false` — un-hiding is Phase 4;
    what dies TODAY is the lie behind it, per Decision 4b.)
  - `LabourFeature.tsx:196` — delete
    `onSave={() => { back(); showToast('जतन झाले → मंजुरीसाठी'); }}` and replace with:

```tsx
onSave={(marks) => {
    // Labour V2 R1 Task 3.5c — the REAL save. The जतन झाले lie that lived
    // here (write nothing, claim saved) is dead; the toast is now the
    // app's honest offline vocabulary, driven by the queue row actually
    // written (P10: never rendered as saved before acknowledgement).
    if (!farm) { showToast('शेत निवडा'); return; }
    const workDate = getDateKey();
    void Promise.all(marks.map((m) => MarkAttendanceCommand.enqueue({
        attendanceMarkId: crypto.randomUUID(),
        farmId: farm.farmId,
        fieldOperatorId: m.fieldOperatorId,
        workDate,
        ...(m.status === 'present' ? { dayMark: 'Full' as const }
            : m.status === 'half' ? { dayMark: 'Half' as const }
            : { dayMark: 'Absent' as const }),
    }))).then(() => { back(); showToast(ON_PHONE_MR); });
}}
```
    with `const ON_PHONE_MR = translate(SYNC_HONESTY_I18N_KEYS.ON_PHONE, 'mr');` resolved the
    `ReviewSheet.tsx:226` way (same import lines as that file) — `लक्षात ठेवलं ✓`, one source,
    never transcribed. ("शेत निवडा" is an existing farm-picker string only if it already exists
    in the tree — verify with `git grep "शेत निवडा" src/clients/mobile-web/src/`; if absent,
    disable the save button when `!farm` instead of toasting: no new farmer-facing Marathi.)
    Note the global `shift` selector: extend `ManualAttendanceMark` mapping per the table
    above when Attendance's `shift` state is threaded through — thread it as a third field on
    the callback (`shift: LabourShift`) so the caller applies `night`→`nightMark` mapping;
    keep the mapping in ONE place (LabourFeature).
  - `AttendanceResult.tsx`: inside the बरोबर handler (3.4b left the seam), before `onConfirm(draft)`:

```tsx
// Marks for uniquely-resolved names only (rule 10: duplicates resolve to
// NOBODY — never auto-merged). Offline/unfetchable roster ⇒ no marks; the
// statement save below still records every spoken name on the engagement.
if (farmId && roster) {
    const workDate = getDateKey();
    const byName = new Map<string, FieldOperator[]>();
    for (const op of roster.filter((o) => o.isActive)) {
        byName.set(op.displayName, [...(byName.get(op.displayName) ?? []), op]);
    }
    void Promise.all(workerNames.flatMap((name) => {
        const matches = byName.get(name) ?? [];
        if (matches.length !== 1) return [];
        const ruling = rulings[name];
        return [MarkAttendanceCommand.enqueue({
            attendanceMarkId: crypto.randomUUID(),
            farmId, fieldOperatorId: matches[0].id, workDate,
            ...(ruling === 'half' ? { dayMark: 'Half' as const }
                : ruling === 'night' ? { nightMark: 'Worked' as const }
                : { dayMark: 'Full' as const }),
        })];
    }));
}
```
    with `const [roster, setRoster] = React.useState<FieldOperator[] | null>(null);` and
    `React.useEffect(() => { if (!farmId) return; let live = true; fetchFieldOperators(farmId).then((r) => { if (live) setRoster(r); }).catch(() => {/* offline: no marks, statement still saves */}); return () => { live = false; }; }, [farmId]);`
    plus imports (`MarkAttendanceCommand`, `fetchFieldOperators`, `type FieldOperator`,
    `getDateKey`). An unqualified "आले" writes `dayMark:'Full'` — the register's own approved
    vocabulary (हिरवा = आला = ✓ पूर्ण, state A frame 4 / D-H3), and the voice pipeline cannot
    state Half today (C4), so nothing invented can leak: pin it in
    `AttendanceResult.test.tsx` — a confirm with no ruling enqueues only `dayMark:'Full'`
    payloads (mock `MarkAttendanceCommand.enqueue` with `vi.mock`).
- [ ] **3.5c.9 — verify the lie is gone.**
  `git grep -n "जतन झाले" src/clients/mobile-web/src/` → no hit on the labour path;
  full vitest suite + `npm run typecheck` + `dotnet build src/AgriSync.sln` green.
- [ ] **3.5c.10 — commit.**
  `feat(labour): offline attendance marks — queue command, Dexie v25, pull carriage; delete the fake save (Task 3.5c)`

### Task 3.5d — The P10 acceptance proof

**P10, verbatim: "Acknowledged = reconstructable without the originating device."** A 200
from /sync/push is NOT evidence (`syncHonestyState.ts:16-24`); `BackgroundSyncWorker.ts:377-378`
marks applied on `applied|duplicate` and nothing else. Two halves:

- [ ] **3.5d.1 — server round-trip (real Postgres).** Create
  `src/tests/ShramSafal.Sync.IntegrationTests/Labour/AttendanceMarkSyncRealPostgresTests.cs`
  in the `LabourReadBackPullTests.cs` / `SyncPushTenantScopeRealPostgresTests.cs` idiom
  (`RequiresPostgresConnection`, seeded farm + member + FieldOperator):
  1. push one `attendance.mark` batch as a member → result `applied`; **the row exists in
     `ssf.attendance_marks`** (RLS satisfied via `EstablishFarmScopeForDerivationAsync` — this
     test is what proves C5 closed);
  2. push the SAME clientRequestId again → `duplicate`, still one row;
  3. push a CHANGED ruling (new key) → `applied`; the mark is amended AND
     `ssf.attendance_mark_corrections` gained the row (append-only history written from
     Application through the new port member);
  4. pull with `sinceUtc` before the push → the mark comes back in `AttendanceMarks`
     **on a fresh context with only the user GUC** — reconstructable without the device;
  5. a non-member push → `ShramSafal.Forbidden`, zero rows (both layers, not just the
     InMemory-no-op gate — `CallerFarmTenantScope.cs:59-62`).
  Command: `dotnet test src/tests/ShramSafal.Sync.IntegrationTests/ShramSafal.Sync.IntegrationTests.csproj --filter "FullyQualifiedName~AttendanceMarkSync"` —
  write it first against the not-yet-merged branch state only if 3.5b is landed; expected
  first run RED on step 4 until 3.5c.4's pull carriage is in.
- [ ] **3.5d.2 — client honesty loop (vitest + fake-indexeddb).** Create
  `features/labour/__tests__/attendanceP10.test.ts`:
  1. **offline mark:** `MarkAttendanceCommand.enqueue(...)` with transport dead →
     `getLocalAttendanceMarks(farmId)` returns the fact with `source: 'queue'` — the honest
     unsynced state, distinguishable by every consumer (assert it is NOT `'server'`);
  2. **reconnect:** simulate the worker cycle marking the row APPLIED and a pull delivering
     the server row through `reconcileAttendance` → the fact flips to `source: 'server'`;
  3. **restart:** new `AgriLogDatabase` instance over the same fake-indexeddb store →
     `getLocalAttendanceMarks` still returns the server fact — **the same fact हजेरी will
     draw** (Phase 4 reads this exact helper), surviving without the queue row.
- [ ] **3.5d.3 — run everything.**
  `npx vitest run` (client) · the two dotnet test commands · `cd sync-contract && npm test` ·
  `dotnet test src/tests/AgriSync.ArchitectureTests/AgriSync.ArchitectureTests.csproj` — all green.
- [ ] **3.5d.4 — commit.**
  `test(labour): P10 acceptance — offline mark is reconstructable without the device (Task 3.5d)`

---

## Task 3.6 — The crew link: engaged THROUGH whom (Phase 0 UNKNOWN 1; Phase 4's crew rows consume this)

**Why this exists, and why HERE.** Final direction §3 fixed the semantic requirement: the
record must preserve THROUGH WHOM anonymous workers came, ENGAGEMENT-scoped, or the
Mukadam-wise हजेरी view cannot exist truthfully. Phase 0 UNKNOWN 1 answered the shape — one
nullable FK on the engagement, the two alternatives eliminated on grain
(`attendance_marks` is unique per person-day) and meaning (a work row asserts the operator
WORKED) — and Phase 4's `BuildHajeriLedger` crew aggregate rows consume
`LabourAssignment.EngagedThroughFieldOperatorId` as a hard interface. This task is its
SINGLE producer. It lives in Phase 3 because the write rides the CAPTURE wire:
`LabourAssignment.Id` is client-minted and travels on the existing `create_daily_log`
mutation (`CreateDailyLogHandler.cs:527-529`; `create_daily_log.zod.ts` LabourItemSchema),
so the fact is writable offline with **no new sync mutation type** and no allow-list edit
(`PushSyncBatchHandler` allow-lists `labour` as a top-level key only — Phase 0 UNKNOWN 1).

**Decisions, stated so they are decisions:**
- **Set at Create only.** `LabourAssignment` has exactly two intention-named mutators and
  refuses a general Update; `LabourCorrection.Create` throws outside its closed five-field
  set. R1 adds NO third mutator and NO sixth correction constant — re-attributing a recorded
  engagement is a correction story for a later release, and Phase 0 named editability "a plan
  decision, not a free property". This is that decision.
- **The capture SURFACE is out of scope.** No approved mockup exists for a farmer control
  that says "शंकरसोबत 8", and inventing farmer-facing Marathi is forbidden. This task ships
  the domain member, the column, the wire carriage and the server guard; until a capture
  surface emits the field, the column stays NULL and Phase 4's crew rows render for no one —
  which is TRUE (blank, never wrong). **Flag at the founder gate**, beside the Phase-2 notes.
- **NULL means "nobody said through whom" — never "no mukadam".** The schema's first
  nullable FK; there is no idiom to copy, so the semantics are stated here and on the column.
- **The weak precedent NOT copied:** `linked_activity_id` (client uuid, no FK, no
  validation). This column gets a real FK (`ON DELETE RESTRICT`) AND the application farm
  guard, because `p_tenant_labour_assignments` is `WITH CHECK (true)`, the user-select
  policies are PERMISSIVE, and FK checks bypass RLS entirely.
- **The decoy NOT wired:** `LabourEvent.operatorId` exists on the client type and the AI
  schema but is NOT on the wire — anything attached there vanishes at sync. The wire field is
  the payload item member added below, nothing else.

**Files**

| Action | Path | Anchor (verified 2026-09-02) |
|---|---|---|
| Modify | `src/apps/ShramSafal/ShramSafal.Domain/Farms/LabourAssignment.cs` | `Create` :135-144 (trailing-optional idiom :142-144); property block :59-82 |
| Modify | `src/apps/ShramSafal/ShramSafal.Application/UseCases/Labour/LabourAssignmentFactory.cs` | `FromParsed` :67-97 (pass-through) |
| Modify | `src/apps/ShramSafal/ShramSafal.Infrastructure/Persistence/Configurations/LabourAssignmentConfiguration.cs` | after `Notes` (:48); FK idiom `FieldOperatorWorkRowConfiguration.cs:58-61` |
| Create | `src/apps/ShramSafal/ShramSafal.Infrastructure/Persistence/Migrations/<stamp>_AddEngagedThroughToLabourAssignments.cs` | generated (`dotnet ef migrations add`) |
| Modify | `sync-contract/schemas/payloads/create_daily_log.zod.ts` | `LabourItemSchema` (the `durationHours` line is last today) |
| Regenerated | `sync-contract/schemas/payloads-csharp/CreateDailyLogPayload.cs` | `LabourItem` :42-57 — regenerated, never hand-edited |
| Modify | `src/apps/ShramSafal/ShramSafal.Application/UseCases/Logs/CreateDailyLog/CreateDailyLogHandler.cs` | labour loop :521-569 (`FromParsed` call + farm guard) |
| Modify | `src/tests/ShramSafal.Domain.Tests/Farms/LabourAssignmentTests.cs` | + two facts |
| Modify | `src/tests/ShramSafal.Domain.Tests/Logs/CreateDailyLogPipelineTests.cs` | + carriage fact + cross-farm refusal fact (that file's FakeRepo idiom) |
| Modify | `src/tests/ShramSafal.Sync.IntegrationTests/Labour/LabourAssignmentPersistenceTests.cs` | + schema/FK fact (harness applies the migration chain) |

**Interfaces** — Produces the crew-link block declared in this phase's PRODUCED section
(domain member, two trailing-optional factory params, zod/payload member, column+FK+index).
Consumes `FieldOperator.OriginatingFarmId` and `GetFieldOperatorByIdAsync`
(`IShramSafalRepository.cs:847`), the `AttachFieldOperatorHandler.cs:112-117` guard idiom.

**Steps**

- [ ] **3.6.1 — failing domain tests.** In `Farms/LabourAssignmentTests.cs` append:

```csharp
    [Fact]
    public void EngagedThroughDefaultsToNullMeaningNobodySaid()
    {
        var a = MinimalAssignment(); // the file's existing builder — reuse it
        Assert.Null(a.EngagedThroughFieldOperatorId);
    }

    [Fact]
    public void EngagedThroughIsStoredWhenStated()
    {
        var through = Guid.NewGuid();
        var a = MinimalAssignment(engagedThroughFieldOperatorId: through);
        Assert.Equal(through, a.EngagedThroughFieldOperatorId);
    }
```

  (If the file's builder helper has another name, use IT — match, don't invent; the helper
  gains the trailing optional and forwards it.) Run
  `dotnet test src/tests/ShramSafal.Domain.Tests/ --filter "FullyQualifiedName~LabourAssignmentTests"`
  → compile error (`EngagedThroughFieldOperatorId` does not exist) — the red step.

- [ ] **3.6.2 — domain + factory.** `LabourAssignment.cs`: add after the property block (:82):

```csharp
    /// <summary>
    /// Final direction §3 (2026-09-01) — THROUGH WHOM this crew was engaged: a
    /// FieldOperatorId, never an AppRole (both may be the same human on the
    /// same day and must remain two rows in two tables). ENGAGEMENT-scoped by
    /// construction: Shankar with 8 on grapes and 4 on cane is two engagements,
    /// never "12 unique people". NULL = nobody said through whom — never "no
    /// mukadam". Set at Create only (R1): re-attributing a recorded engagement
    /// is a correction story this release does not ship. The mukadam's own
    /// presence stays his own AttendanceMark; this field has nowhere to
    /// contradict it. Anonymous remainder stays arithmetic — no worker row is
    /// ever minted from this link (D9.12; FieldOperatorSingleProducerRules).
    /// </summary>
    public Guid? EngagedThroughFieldOperatorId { get; private set; }
```

  `Create` gains the final trailing optional `Guid? engagedThroughFieldOperatorId = null`
  (after `costSpokenText`), assigned in the same place the other optionals are.
  `LabourAssignmentFactory.FromParsed` gains the identical trailing optional and forwards
  `engagedThroughFieldOperatorId: engagedThroughFieldOperatorId`. Run 3.6.1 green.

- [ ] **3.6.3 — EF config + migration.** `LabourAssignmentConfiguration.cs`, after `Notes`:

```csharp
        // Final direction §3 — the crew link (Phase 0 UNKNOWN 1). The schema's
        // FIRST nullable FK: NULL = "nobody said through whom", never "no
        // mukadam". Real FK + Restrict (NOT the linked_activity_id precedent:
        // client uuid, no FK, no validation) because FK checks bypass RLS and
        // the tenant WITH CHECK is (true) — the application farm guard in
        // CreateDailyLogHandler is the tenant boundary here. No GRANT
        // (privileges are per-table), no RLS change (policies name tables).
        builder.Property(x => x.EngagedThroughFieldOperatorId)
            .HasColumnName("engaged_through_field_operator_id");

        builder.HasIndex(x => x.EngagedThroughFieldOperatorId)
            .HasDatabaseName("ix_labour_assignments_engaged_through");

        builder.HasOne<FieldOperator>()
            .WithMany()
            .HasForeignKey(x => x.EngagedThroughFieldOperatorId)
            .OnDelete(DeleteBehavior.Restrict);
```

  (add `using ShramSafal.Domain.Labour;` if the file lacks it — `FieldOperator` lives there).
  Generate:
  `dotnet ef migrations add AddEngagedThroughToLabourAssignments --project src/apps/ShramSafal/ShramSafal.Infrastructure --startup-project src/AgriSync.Bootstrapper --context ShramSafalDbContext --configuration Release`
  Verify the generated `Up` is exactly: one `AddColumn<Guid>` (`nullable: true`, schema `ssf`,
  table `labour_assignments`), one `CreateIndex` (`ix_labour_assignments_engaged_through`),
  one `AddForeignKey` → `ssf.field_operators` with `onDelete: ReferentialAction.Restrict`;
  `Down` the mirror image. Anything else = your config drifted — STOP and fix.
  This table SHIPPED (2026-06-29): a NEW migration is correct here; only the two attendance
  migrations hold the edit-in-place licence.

- [ ] **3.6.4 — the wire.** In `create_daily_log.zod.ts`, append to `LabourItemSchema` after
  `durationHours` (LAST member, so the regenerated C# optional is trailing):

```ts
    // Final direction §3 — THROUGH WHOM this crew came (a FieldOperator id).
    // Absent/null = nobody said. Engagement-scoped: two crews on one day are
    // two labour items. Rides the existing create_daily_log mutation — the
    // engagement id is already client-minted, so no new mutation type exists.
    engagedThroughFieldOperatorId: ZGuid.optional(),
```

  Then `cd sync-contract && npm run generate` — `LabourItem` gains
  `Guid? EngagedThroughFieldOperatorId = null`; commit the regenerated file untouched by hand.
  `npm test` (sync-contract) stays green — `create_daily_log` has no `PayloadHasOnly`
  allow-list of nested labour-item keys (top-level key only, verified by Phase 0).

- [ ] **3.6.5 — failing handler tests.** In `Logs/CreateDailyLogPipelineTests.cs` (that
  file's existing FakeRepo/builder idiom) add two facts:
  1. a labour item carrying `EngagedThroughFieldOperatorId` of a FieldOperator seeded ON the
     command's farm → the staged `LabourAssignment` carries it;
  2. a labour item whose `EngagedThroughFieldOperatorId` names an operator seeded on ANOTHER
     farm → the handler fails with `ShramSafal.Forbidden` (assert
     `result.Error.Code.Should().Contain("Forbidden")` in that file's assertion style) and
     stages NO labour rows — never NotFound, same posture as every labour guard.
  Run → red (member absent / no guard).

- [ ] **3.6.6 — handler pass-through + the mandatory farm guard.** In
  `CreateDailyLogHandler.cs`, inside the labour loop, BEFORE `FromParsed` is called for an
  item that states the link:

```csharp
                // Final direction §3 — the crew link's tenant boundary lives HERE,
                // in the application (AttachFieldOperatorHandler.cs:112-117 idiom):
                // p_tenant_labour_assignments is WITH CHECK (true), user-select
                // policies are PERMISSIVE, and FK checks bypass RLS — so without
                // this read a client could attribute a crew to another farm's
                // mukadam. Forbidden, never NotFound.
                if (item.EngagedThroughFieldOperatorId is { } throughId)
                {
                    var through = await repository.GetFieldOperatorByIdAsync(throughId, ct);
                    if (through is null || (Guid)through.OriginatingFarmId != command.FarmId)
                    {
                        return Result.Failure<CreateDailyLogResult>(ShramSafalErrors.Forbidden);
                    }
                }
```

  (adapt the failure generic to this handler's actual result type — copy the type from its
  existing failure returns, match, don't invent) and the `FromParsed` call gains
  `engagedThroughFieldOperatorId: item.EngagedThroughFieldOperatorId` after `notes:`.
  **Placement note:** the labour loop already runs before the Phase-1 `SaveChangesAsync`, so
  the refusal stages nothing and the log-and-labour unit of work stays atomic.
  Run 3.6.5 green.

- [ ] **3.6.7 — schema proof on real Postgres.** Append to
  `LabourAssignmentPersistenceTests.cs` one fact in the file's idiom: after the migration
  chain, `information_schema.columns` shows
  `engaged_through_field_operator_id | uuid | YES`, and inserting an assignment whose
  `engaged_through_field_operator_id` names a non-existent operator is refused with SQLSTATE
  `23503` (the FK is real, not decorative). Run the RealPostgres filter on :5433.

- [ ] **3.6.8 — full green + commit.** `dotnet build src/AgriSync.sln`;
  `dotnet test src/tests/ShramSafal.Domain.Tests/`;
  `dotnet test src/tests/AgriSync.ArchitectureTests/` (PIN 1 counts `LabourAssignment.Create(`
  production call sites — `FromParsed` remains the only one, unchanged);
  `cd sync-contract && npm test`. Commit:
  `feat(labour): engaged-through crew link on the engagement — column, wire carriage, farm guard (Task 3.6)`

---

## Phase-3 exit criteria (all binary)

- [ ] Draft log + parsed 12 → mic inactive with the approved reason; confirmed log → active.
  The Labour route, hub, हजेरी वही tile and ledger render in BOTH states.
- [ ] No rung re-asks plot, crop, work, or a known headcount; a names-only transcript resolves.
- [ ] 12-vs-10 shows both numbers; neither statement is mutated; settled at बरोबर/बदल करा.
- [ ] `autoSubmittedLabourDraftRef` does not exist; nothing persists before बरोबर; बरोबर saves once.
- [ ] The labour path renders `ShramSathiUnderstanding` by identity — no second processing screen.
- [ ] `attendance.mark` is catalogued at `0.9.0`, allow-listed, parity-green (15/33), dispatched,
  gated, contradiction-checked pre-staging, committed with exactly one `SaveChangesAsync`.
- [ ] `जतन झाले → मंजुरीसाठी` is gone; the only save vocabulary on unsynced facts is the
  existing honesty set; `source: 'queue'` facts are never rendered as saved.
- [ ] P10: offline mark → honest unsynced state → reconnect → acknowledged → restart → same
  fact readable from the server-backed store alone.
- [ ] Crew link (Task 3.6): `LabourAssignment.EngagedThroughFieldOperatorId` exists with its
  FK+index migration; a cross-farm attribution is refused `Forbidden` server-side; the
  capture-surface deferral is flagged in the founder-gate note.
- [ ] `dotnet test src/tests/AgriSync.ArchitectureTests/` green (PIN 3 included);
  `AttendanceMark.Value` has zero new readers (`git grep -n "\.Value" -- "*RecordAttendanceMark*"` → none).
