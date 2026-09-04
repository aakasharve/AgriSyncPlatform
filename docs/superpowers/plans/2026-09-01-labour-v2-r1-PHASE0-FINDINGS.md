# Labour V2 R1 — PHASE 0 FINDINGS

**Branch:** `feat/labour-v2-r1` · **Date:** 2026-09-01
**Scope rule in force:** Phase 0 determined TECHNICAL TRUTH only. Nothing below re-asks a settled
product question. Where the code contradicts a settled decision it is written as an obstacle to
solve, never as a question to re-decide.
**Method:** six investigations, each independently re-verified by a second reader who re-opened every
cited file. Only CONFIRMED claims, and IMPRECISE claims carrying the verifier's corrected evidence,
survive here. Every surviving claim keeps its `file:line`.

---

## 1. Summary for the founder

Phase 0 opened the code behind all six open questions and found that the plan's shape is right but
its foundation is thinner than it looked. The good news first: the way to record "these people came
through Shankar" is a single small addition to a table we already have, not a new system; the
permission switch you asked for is essentially one word deleted from one file; and the offline
plumbing you told us not to duplicate genuinely exists and can carry attendance.

The hard news is four things, and they are all the same kind of problem — something that looks
finished but is not connected. First, the हजेरी save button already in the app says "saved" in
Marathi and writes nothing at all, anywhere. Second, the attendance record we built last week can
only hold "full day" and "night" — it has no place to put extra time or a specific number of hours,
so two of the five day-realities you ruled into scope have literally nowhere to land yet. Third, the
voice pipeline never asks the AI for a half-day at all, so a half-day cannot arrive from speech
today no matter what the screen does. Fourth, offline attendance will be silently refused by the
database on the sync route unless one specific line is added, and there is no offline place to
*read* हजेरी back, so a farmer who marks a day with no signal cannot look at it ten seconds later.

None of this blocks the plan. All four are solvable and we now know exactly where each fix goes. But
they change the order of work: the record has to be able to hold all five realities *before* we
freeze the offline message format, or we lock in a three-of-five contract that is much harder to
widen later. One thing you should simply be told, not asked: today a farm member whose access was
suspended, and one who was invited but never approved, can still read the entire wage book —
every name, every amount. That is old, it predates Labour, and it is not something Labour V2 created
or should try to redesign. Phase 1 can start.

**What verification dropped.** Three claims from the first pass did not survive and are not carried
forward: (a) that no "through whom" idea existed anywhere in the code — a person-scoped `MemberIds`
/ `AppointedById` pair already ships end-to-end and a screen draws it; (b) that the offline client
had no handling for a refused approval — it already parks that error permanently, so a frontend task
the plan carried is unnecessary; (c) that the grant expiry could be evaluated in exactly one place —
there are two, and an expiry in only one of them would make the owner's own roster screen lie.
The verification did real work.

---

## 2. The six unknowns

### UNKNOWN 1 — Engagement-scoped "Labour Mukadam" relationship

**ANSWER.** Add one nullable column: `ssf.labour_assignments.engaged_through_field_operator_id uuid NULL`,
FK → `ssf.field_operators("Id")` with `ReferentialAction.Restrict`, plus
`ix_labour_assignments_engaged_through`. NULL means "nobody said through whom" — never "no mukadam".
Nothing smaller and correct exists in the repo.

**Why the two alternatives are eliminated.**
- `attendance_marks` is wrong by **grain**: `ux_attendance_marks_farm_operator_day` is UNIQUE on
  `(farm_id, field_operator_id, work_date)`
  (`Migrations/20260831180408_AddAttendanceMarks.cs:40-45`), and the configuration states the grain
  is the point (`Configurations/AttendanceMarkConfiguration.cs:53-59`). An engagement-scoped count
  cannot live on a person-day row. Shankar with 8 on grapes and 4 on cane is two facts, never "12".
- `field_operator_work_rows` is wrong by **meaning**, despite having exactly the right grain
  (`Configurations/FieldOperatorWorkRowConfiguration.cs:73-78`, UNIQUE on operator × assignment).
  A work row asserts the operator *worked* the engagement
  (`Domain/Labour/FieldOperatorWorkRow.cs:8-9`), so it cannot say "his 8 came, he did not" —
  `Domain/Labour/AttendanceMark.cs:30-33` names that as a contradiction. It also has **no offline
  route** (32 mutations in `sync-contract/schemas/mutation-types.json`, none for attach), and it has
  **two** production writers, not one: `AttachFieldOperatorHandler.cs:143` (TryAdd…) and
  `CorrectLabourHandler.cs:320` (`AddFieldOperatorWorkRowAsync`, the stage-only port member at
  `IShramSafalRepository.cs:950-959`).
  Write this elimination into the plan explicitly, or a later executor reaches for the table that
  "already has the right grain".

**Why the column is cheap.** `LabourAssignment.Id` is a **client-minted** Guid that already rides
the existing `create_daily_log` offline mutation
(`CreateDailyLogHandler.cs:527-529`; `sync-contract/schemas/payloads/create_daily_log.zod.ts:57-63`;
`log-factory-helpers.ts:210-218`; single write boundary at `LogCommandService.ts:185`). So an
engagement-scoped fact is writable offline with **no new sync mutation type**.
`PushSyncBatchHandler.cs:859` allow-lists `labour` as a top-level key only, so a nested item field
needs no allow-list edit.

**Grants.** NONE required. Postgres privileges are per-table, not per-column, and no column-level
GRANT exists anywhere in this repo. **Do not write a causal story into the migration comment.** The
repo contradicts itself on *why* post-bootstrap tables are writable —
`20260713052440_AddDfesDataSpine.cs:257-264` says they inherit nothing;
`20260815102440_AddRawBlobSubjects.cs:149-178` measures the opposite in production ("all 77 ssf
tables report relowner = agrisync_app", "count(*) FILTER (WHERE relacl IS NULL) = 0") and calls the
first story "a local-environment artifact read as a production fact";
`20260831155124_GrantFieldOperatorWorkRowsToAppRole.cs:8-18` says work rows were nonetheless dead
with 42501. Note also that `ssf.labour_assignments` was created 2026-06-29
(`20260629064530_AddLabourAssignmentsTable.cs`), six weeks *after* the one-shot
`GRANT ... ON ALL TABLES` at `20260515090000_BootstrapDbRoles.cs:89-90` — so that line cannot be its
source. The no-grant conclusion rests on Postgres semantics alone and needs none of this.

**RLS.** No new policy. But the **application guard is mandatory**: `CreateDailyLogHandler` must load
the referenced `FieldOperator` (`IShramSafalRepository.cs:847`) and assert
`OriginatingFarmId == command.FarmId` before staging, mirroring
`AttachFieldOperatorHandler.cs:112-117` exactly — because `p_tenant_labour_assignments` is
`WITH CHECK (true)` (`20260629064530:48-54`, re-asserted `20260703210908:60`),
`p_user_select_labour_assignments` is PERMISSIVE, and FK checks bypass RLS entirely. The weak
precedent **not** to copy is `linked_activity_id`: a client-supplied nullable uuid with no FK and no
validation (`20260629064530:29`).

**This would be the schema's first nullable FK.** Every FK column in `ssf` that could be found —
including the raw-SQL ones missed by a `ForeignKey(`-only search (`WtlV0Entities.cs:67-68`,
`FinanceV2.cs:47`, `AddAiOrchestration.cs:95-99`, `AddAuditEvents.cs:205-242`) — is NOT NULL. There
is no idiom to copy; the NULL semantics must be decided here, and they are stated above.

**Editability is a plan decision, not a free property.** `LabourAssignment` has exactly two
intention-named mutators and refuses a general `Update`
(`Domain/Farms/LabourAssignment.cs:172-189`, `:209-215`, `:239-250`); `LabourCorrection.Create`
throws outside a closed set of five fields (`Domain/Labour/LabourCorrection.cs:58-85`, `:166-172`).
Either the field is set at Create only, or a third mutator plus a sixth correction constant lands.
Width is not a blocker: `changed_field` is `varchar(40)`
(`20260811112633_AddLabourCorrections.cs:22`) and `"EngagedThroughFieldOperator"` is 27 chars.

**One mukadam per engagement.** A single-valued FK means two mukadams on the same work are TWO
labour engagements in one daily log. The data layer supports it end to end
(`create_daily_log.zod.ts:168` array; `CreateDailyLogHandler.cs:521-569` loop;
`log-factory-helpers.ts:210-218`), and founder decision O-2 constrains the *plot* axis, not this one
(`LogFactory.oneEngagementOneQuantity.test.ts:7-19`). The **capture UI must actually emit two** —
see STILL UNVERIFIED.

**Two decoys to name in the plan so nobody wires into them.**
- `LabourEvent.operatorId` exists on the client type (`domain/types/log.labour.types.ts:54`) and the
  AI schema (`AgriLogResponseSchema.ts:460`) but is **not on the wire** — absent from
  `create_daily_log.zod.ts:62-77` and from the generated `CreateDailyLogPayload.cs:42-57`. Wiring
  the relationship here means it vanishes at sync with no error.
- `LabourPersonDto.MemberIds` / `AppointedById` are **person-scoped, hardcoded null, and rendered**:
  declared at `LabourDataDto.cs:26,65`, hardcoded to null for every person at
  `GetLabourDataHandler.cs:399,405`, carried at `labourClient.ts:63,75,220,225`, and drawn as
  `याची माणसं · his team` at `MukadamDetail.tsx:33-34,81` with `teamCount` at `LabourHub.tsx:429`.
  The plan must state that the new column is engagement-scoped and is **not** this, and say what
  happens to these two (feed, replace, or leave null).

**Measured surface (9 edits, one regeneration, no new mutation type).** Domain property + trailing
optional `Create` param; `LabourAssignmentFactory.cs`; `LabourAssignmentConfiguration.cs`; migration
+ `.Designer.cs` + `ShramSafalDbContextModelSnapshot.cs` (mandatory here — the model changes);
`create_daily_log.zod.ts` item schema; **regenerate** `CreateDailyLogPayload.cs` via
`npm run generate` (never hand-edit — `sync-contract/README.md` invariants 2-3, generator at
`scripts/generate-csharp-payloads.ts:213,248`, compiled in at `ShramSafal.Application.csproj:31`);
command + handler pass-through and the farm guard; `LabourEngagementDto.cs` +
`DtoMappingExtensions.cs:157-182` read-back; client types + `logSyncMutationService.ts:321-339`.

**Read-back caveat.** The Mukadam-wise read needs one field, not a new endpoint — the overlay
already exists (`LabourEngagementDto.cs:123-129,144-146`; `DtoMappingExtensions.cs:157-185`). But
**both** work-row reads on the port are DEFAULT interface members returning `[]`
(`IShramSafalRepository.cs:906`, `:1006`), across 28 implementors (`:1008-1010`). Confirm the
concrete repository overrides, or the view renders "nobody" instead of failing.

**Architecture pins.** PIN 1 (`LabourAnchorRules.cs:40`, literal match at `:44`) is safe under a
trailing optional parameter — no new construction site. PIN 2 (`:80-116`) fails any production `.cs`
naming both the operator identity and the WTL v0 ledger, and `:75-77` says widening the exclusion
list is "a STOP-and-escalate, not a fix". Migrations are excluded at `:132`.

**Also:** extend the `ErasureWorker` PII inventory comment block (`Privacy/ErasureWorker.cs:164-237`)
with the new column. It stores a GUID, which by that file's own rule (`:381-385`) needs no scrub, but
the inventory is hand-maintained and a pointer-to-a-person missing from it is how the next audit
gets a wrong answer. `AnonymizeFieldOperatorAsync` (`:1117-1140`) never hard-deletes, so `Restrict`
adds no erasure blocker.

---

### UNKNOWN 2 — Storage for extra time and specific hours

**ANSWER.** Two nullable bare-`numeric` columns on `ssf.attendance_marks` — `hours_worked` and
`extra_hours` — added by **editing the unmerged CreateTable**, not by a third migration. No
`hours_basis` column. `LabourTime` is reused as a validation reference only, never mapped.

**The table has no duration column of any kind today.** Nine columns, two indexes, PK-only
constraints, no CHECK (`Migrations/20260831180408_AddAttendanceMarks.cs:19-27`, `:29-32`, `:34-45`;
snapshot `:3353-3400`; `Configurations/AttendanceMarkConfiguration.cs:32-64`). Every rule the entity
states is domain-level, not DB-level.

**Edit the existing migration, do not add a third.** Neither attendance migration has ever shipped:
`git for-each-ref --contains 53d6f28f` returns only `refs/heads/feat/labour-v2-r1`;
`git ls-tree -r --name-only origin/main -- .../Migrations | grep -i attendance` returns nothing —
the file does not exist on `origin/main` at all. The corrections migration (`48b54a8c`) is likewise
branch-only. Both have `.Designer.cs` files, so regeneration is real work.

**Why bare `numeric`, and why NULL.** It matches the sibling `labour_assignments.duration_hours`
exactly (`20260811054142:18-24`; snapshot `HasColumnType("numeric")`); `numeric(4,1)` would invent a
second convention for the same quantity. NULL means "nobody said" — the same rule `Unmarked = 0`
encodes for the two enums (`AttendanceMark.cs:165-182`) — and follows the additive-nullable
precedent set verbatim by `20260816155627_AddNumericCertainty` ("No default, no backfill, no NOT
NULL", `:17-21`). `decimal?` → nullable `numeric` is already proven in-repo (snapshot `:2429-2431`).
Note that bare `numeric` carries **no bound**: "hours > 0" will live only in the domain guard, as it
does for `duration_hours`. State that rather than implying it.

**Why NOT `LabourTimeBasis`.** Its non-Explicit member exists so the *server* can invent hours —
`ServerDefaultHours = 8m` (`Domain/Farms/LabourTime.cs:33`), `ServerAssumed()` (`:67`) — and this
table's own contract says the recorder is "Who made this ruling. Never the app."
(`AttendanceMark.cs:83`). `LabourTime` also cannot express "not stated" at all: both factories throw
on `hours <= 0` (`:45-53`, `:56-64`). Nullability already answers stated-vs-not-stated. Separately,
`LabourTime` is a `readonly record struct` (`:30`) and is never persisted as a type — its one
persistence flattens to two scalars (`LabourAssignment.cs:76,79`;
`LabourAssignmentConfiguration.cs:35-37`), and no struct is owned anywhere in `ssf` (every
`OwnsOne`/`OwnsMany` target is a sealed record or sealed class — including the two the first pass
missed, `LogTaskConfiguration.cs:53` → `ComplianceResult.cs:5` and `WorkerConfiguration.cs:29` →
`WorkerName.cs:32`). So "reuse LabourTime" buys validation you can copy in three lines and nothing
else.

**Domain changes.** Add `decimal? HoursWorked` and `decimal? ExtraHours`; thread through the private
ctor (`:46-65`); add to `Create` as **trailing optional** parameters — the repo's own additive idiom
(`LabourAssignment.cs:142-144`). **Widen the emptiness guard** at `AttendanceMark.cs:112-121` and
`:135-141` from "both halves unmarked" to "all four facts absent", or an hours-only ruling throws
(pinned today by `AttendanceMarkTests.cs:135-142`). Add a positivity guard mirroring
`LabourTime.Explicit`. Leave `Value` (`:151-158`) untouched and out of every read path — do not fold
hours into it.

**`Amend()` becomes**
`Amend(DayMark day, NightMark night, decimal? hoursWorked, decimal? extraHours, UserId amendedByUserId, DateTime amendedAtUtc)`
returning a named `AttendanceMarkPreviousValues(DayMark, NightMark, decimal?, decimal?)` — a named
record, not a 4-tuple, because four positional values of two nullable types transpose silently.
**Cost today: two lines.** `AttendanceMark` has zero production consumers beyond plumbing (a DbSet,
three repository methods, the two EF configs), and `Amend()` has **no production caller at all** —
its only call sites are `AttendanceMarkTests.cs:121` and `:141`. Do the domain shape FIRST, while the
blast radius is two test lines.

**Guard nuance the plan must carry:** with the widened guard,
`Amend(Full, Unmarked, null, null, ...)` on a mark holding 3 hours would silently blank a stated
fact. `AttendanceMark.cs:137-141` says a deletion must be recorded, not quiet. Either forbid
null-ing a present hours value through `Amend`, or require the caller to prove it wrote the
correction row. Decide it in the domain shape now.

**Correction table — four changes, all mirroring `LabourCorrection`.**
1. Two constants beside `DayField`/`NightField` (`AttendanceMarkCorrection.cs:46-49`) in the same
   column-name style: `HoursWorkedField = "hours_worked"`, `ExtraHoursField = "extra_hours"`.
2. Replace the two-way `if` at `:116-121` (which throws "A mark has exactly two halves") with a
   `CorrectableFields` HashSet, exactly as `LabourCorrection.cs:78-85` / `:166-172` does, and reword
   the message. The pinned refusal test is `AttendanceMarkCorrectionTests.cs:77-81`.
3. Make `original_value` / `new_value` **nullable** — drop `.IsRequired()`
   (`AttendanceMarkCorrectionConfiguration.cs:33-41`), set `nullable: true`
   (`20260831185516:23-24`, also unmerged), and relax the blank check at `:123-130`. Null = "absent
   on this side of the change", the reason already written at
   `LabourCorrectionConfiguration.cs:45-54`. Without this the **first-ever** hours statement is
   unrecordable, because — unlike day/night, where `Unmarked` is a real name — "nobody said" has no
   value. **But relax it per-field:** null original permitted only for the two hours fields; day and
   night keep the both-required rule, where a name always exists.
4. Keep `varchar(32)`. Values are `Format(decimal)` = `ToString("0.####", InvariantCulture)`
   (`CorrectLabourHandler.cs:487-488`), e.g. `"3.5"`. **However** — if extra time or specific hours
   are ever stored as a composite value string, widen it in the same migration. `changed_field` on
   the sibling `LabourCorrection` is `varchar(40)` while this table's is `varchar(32)`; the
   `a7784b18` width incident came from exactly this kind of asymmetry.

**Privacy.** Update both disposition comments by hand: `ErasureWorker.cs:199-201` ("NO PII COLUMN OF
ITS OWN … two enums") must list the two numeric columns, and `:221-223` must stop saying the
correction values are "the enum NAMES". Nothing enforces this —
`ErasureManifestCoverageTests.cs:85-87` captures only the **table name** via a `CreateTable(` regex,
filters at `:105-107`, asserts at `:111`, and never sees a column. This is also the reason **not** to
add a free-text "spoken hours" column: it would give the table its first PII column while a signed
disposition still swears it has none.

**No RLS / GRANT / index work.** Marks: RLS ENABLE + FORCE (`20260831180408:52-53`), tenant policy
`:55`, PERMISSIVE user-select `:59-74`, grants in the creating migration `:82-94`. Corrections: RLS
`:47-54`, and append-only enforced at the GRANT — `SELECT, INSERT` only (`:65-77`, rule stated
`:56-64`). Postgres table-level grants cover later-added columns. Do **not** defensively re-GRANT the
corrections table.

**Sizing honestly.** Steps above are roughly a day and make nothing visible to a farmer. There is no
handler, endpoint, sync mutation or client type for any attendance mark, and the shipped register
still derives its cells from engagements (`GetLabourDataHandler.cs:827,865`). Add to the cost list a
**new Dexie version and a new sync mutation**: a grep across
`src/clients/mobile-web/src/infrastructure/storage/dexie/versions/v1.ts … v24.ts` finds no attendance
store in any version.

---

### UNKNOWN 3 — Repo-native offline attendance write + sync route

**ANSWER.** One mutation, `attendance.mark`, through the existing sync pipeline. No second offline
system, no new REST route. `AttendanceMark` reaches Application/Api in exactly one file
(`Ports/IShramSafalRepository.cs:919-938`, all three members default to `throw`); there is no
handler, no endpoint, no sync descriptor, no read-back. `LabourEndpoints.cs` has five routes
(`:53, :91, :121, :185, :225`) and none is attendance.

**STEP 0, mandatory, before anything else.** Settle the schema before the wire. The payload keys the
route needs (`dayMark`, `nightMark`) cover three of the five settled realities; extra time and
specific hours have no home (UNKNOWN 2). Ship them first. A wire contract is protected by
`PayloadHasOnly` + the parity gate + a `sinceVersion` and is far harder to widen later than a table.

**Ordered file list.**
1. `sync-contract/schemas/mutation-types.json` — add
   `{ "name": "attendance.mark", "ownerAggregate": "AttendanceMark", "sinceVersion": "0.9.0", "payloadSchema": "AttendanceMark" }`.
   Dotted-name shape copies `testinstance.collected` (`:28`). Bump `version`/`lastUpdated`.
2. `sync-contract/schemas/payloads/attendance_mark.zod.ts` — NEW, copying `add_cost_entry.zod.ts`
   (farmId + ZGuid ids + YYYY-MM-DD date + closed enums). **The export must be named exactly
   `AttendanceMarkPayload`** — see the fail-open trap below.
3. `sync-contract/schemas/payloads/index.ts` — export it.
4. `cd sync-contract && npm run generate`. Regenerated, never hand-edited:
   `Contracts/Sync/SyncMutationCatalog.cs` (its header says so at `:1-5`),
   `src/clients/mobile-web/src/infrastructure/sync/SyncMutationCatalog.ts`,
   `sync-contract/schemas/payloads-csharp/AttendanceMarkPayload.cs`.
5. `sync-contract/tests/catalog.test.ts:26-27` — 32 → 33.
6. `sync-contract/tests/allowlist-parity.test.ts` — `EXPECTED_ALLOWLIST_COUNT` 14 → 15 (`:52`) and
   add `'attendance.mark'` to `EXPECTED_GUARDED_MUTATIONS` (`:59-77`), **in the same commit**.
7. `PushSyncBatchHandler.cs` — inject the handler; add the dispatch case; add
   `HandleAttendanceMarkAsync` copying `HandleAddCostEntryAsync` (`:1497-1600`): **one-line**
   `PayloadHasOnly` (`:1513`), `DeserializePayload` (`:1519`),
   `EstablishFarmScopeForDerivationAsync(request.FarmId, actorUserId, ct)` (`:1590`), then delegate
   (`:1599`).
8. `UseCases/Labour/MarkAttendance/{Command,Handler,Result}.cs` — NEW. Copy `CorrectLabourHandler`
   for **validation ORDER only**; copy `AddCostEntryHandler.cs:213` for the **commit point**.
9. `Ports/IShramSafalRepository.cs` — add `AddAttendanceMarkCorrectionAsync`, default-bodied like
   `AddLabourCorrectionAsync` (`:892-893`). Today `AttendanceMarkCorrection` has a shipped entity
   (`:43-80`), table, RLS and DbSet (`ShramSafalDbContext.cs:151-152`) and **no port member at all**,
   so the append-only history cannot be written from Application.
10. `ShramSafalRepository.cs` — implement it, copying `:1606-1610`.
11. `Infrastructure/DependencyInjection.cs` — register the handler.
12. `application/usecases/sync/MarkAttendanceCommand.ts` — NEW, copying `AddLogTaskCommand.ts:14-18`
    verbatim, with `clientRequestId` keyed as
    `SyncMutationName.AttendanceMark : farmId : fieldOperatorId : workDate`.
13. `features/sync/conflict/EditSurfaceRegistry.ts` — register the type (`:184-198`); an unregistered
    mutation has no conflict surface.
14. `features/labour/components/Attendance.tsx:103` + `LabourFeature.tsx:196` — replace the lying
    `onSave` with the command; drive the toast from the queue row.
15. **Read-back is not optional for a register.** Either extend
    `GetLabourDataHandler.BuildAttendanceDraft` (`:965-1026`) to call
    `GetAttendanceMarksForFarmInWindowAsync` (online), or add attendance to `SyncPullResponseDto` +
    a Dexie v25 store (re-listing every v24 store verbatim — `v24.ts:71-74` warns a partial list
    causes silent data loss, and `:59-60` that it is one-way for APK users). `SyncPullResponseDto`
    (`SyncDtos.cs:22-63`) has 23 members and no attendance list.
16. Decide the field-operator question before step 12 (below).

**THE `sinceVersion` TRAP — declare `"0.9.0"`.** The client stamps `X-App-Version` from
`mobile-web/package.json:4`, which is `"0.9.0"` (`transport.ts:18` → `AgriSyncClient.ts:189` →
`SyncResource.ts:8`). The server refuses anything higher (`PushSyncBatchHandler.cs:629-637`,
CLIENT_TOO_OLD). `jobcard.*` declares `1.0.0` (`mutation-types.json:32-37`) and is therefore already
dead on the wire for every shipped handset. Git history shows `package.json`'s version has gone
`0.0.0 → 0.9.0` once and never moved, while `android/app/build.gradle:10-11` carries versionCode 17 /
versionName `1.0.9` and `buildInfo.ts:12` carries `'1.0.9'` — three uncoupled numbers, and only
`package.json` reaches the wire. **Do not bundle a `package.json` bump into this work** — it would
silently un-break every `jobcard.*` mutation at the same time and you would not know which change did
what.

**THE FAIL-OPEN TRAP.** `PayloadValidator.ts:46-47` resolves the schema by name as
`<payloadSchema>Payload` against the payloads barrel and, on a miss, `:48-53` returns `{ ok: true }` —
"accept the payload and rely on backend rejection". A name miss means every offline attendance payload
is enqueued unvalidated with nothing on the client saying so. The parity gate catches it
(`allowlist-parity.test.ts:186-192` throws on a missing export, then `:196+` asserts the Zod key set
EQUALS the server allow-list per mutation) — but only if step 6 is done. Step 6 is what makes step 2
verifiable at all, not a CI-green chore.

**THE SILENT-SUCCESS SHAPE ON THIS PATH.** `AddAttendanceMarkAsync` stages and never saves
(`ShramSafalRepository.cs:1606-1610`). It persists on `/sync/push` **only by accident**, because
`SyncMutationStore.TryStoreSuccessAsync` calls `SaveChanges` on the same scoped DbContext
(`SyncMutationStore.cs:52-57`, called at `PushSyncBatchHandler.cs:522`;
`DependencyInjection.cs:136` registers `DbContext` as the same scoped instance). On any other entry
point a handler that stages and returns success writes **nothing** and answers 200. The in-repo
precedent for the trap is `ShramSafalRepository.cs:2282-2287` ("No SaveChanges here."). The new
handler therefore calls `repository.SaveChangesAsync(ct)` once (port `:298`) and **no**
`TryStoreSuccessAsync` — `PushSyncBatchHandler` already owns that at `:522`, and
`CorrectLabourHandler.cs:40-44` warns that a handler owning it alongside a second dedupe "would
either consume two idempotency keys … or leave the second handler permanently unreachable".

**A SECOND SILENT-SUCCESS SHAPE IS ALREADY SHIPPED.** `Attendance.tsx:103` wires `onClick={onSave}`
to `LabourFeature.tsx:196`, which is `() => { back(); showToast('जतन झाले → मंजुरीसाठी'); }` — no HTTP
call, no queue row, no local store. `LabourHub.tsx:35` already says so in-repo ("still a dead end:
onSave writes nothing"), and the server read-model states it too (`LabourDataDto.cs:298-300`). R1
must not build a real write path beside a fake one; both say the same Marathi word for "saved".

**Client idiom.** `clientRequestId` is a **keyed natural key**, never a random guid — device dedupe
(`v24.ts:77` `&[deviceId+clientRequestId]`, exploited at `MutationQueue.ts:146-156`) and server
dedupe (`PushSyncBatchHandler.cs:457`, `:498`) both rely on derivability, and attendance's natural
key is also the DB unique index, so the two agree by construction. A random id makes the second tap
a 23505 reported to the farmer as "A database constraint rejected this mutation"
(`PushSyncBatchHandler.cs:574`, catch block `:560-575`). Acknowledgement stays positive-only:
`BackgroundSyncWorker.ts:377-378` marks applied on `applied|duplicate` and nothing else, per
`syncHonestyState.ts:16-24` ("A 200 from /sync/push is NOT evidence").

**Write authority sits INSIDE the handler**, after farm-scope establishment and before the first
staged change. Two structural reasons: `LabourManagementGate` performs two DB reads
(`:68`, `:79`) that return nothing without the GUCs, and `/sync/push` sets none until
`EstablishFarmScopeForDerivationAsync` (`PushSyncBatchHandler.cs:1088`) runs; and
`CorrectLabourHandler.cs:69-75` states that `TenantTransactionMiddleware` commits whenever the
pipeline returns without throwing — "a 403 response body is not an exception … Do not move a
validation below the staging block." The placement rule is already written down at
`LabourEndpoints.cs:221-224`: "ROLE GATING LIVES IN THE HANDLER … so it holds on any future
non-HTTP entry point too."

**Field-operator identity has no offline route and the mark has no FK.** Creating a worker is
REST-only (`LabourEndpoints.cs:91-119`; `fieldOperatorClient.ts:5-9`; no field-operator mutation
among the 32). `attendance_marks.field_operator_id` has **no foreign key** in either the migration
(`20260831180408:29-32` — PK only) or the configuration (`AttendanceMarkConfiguration.cs:20-22`, no
`HasOne` anywhere in the file); the domain refuses only the empty guid (`AttendanceMark.cs:105-110`).
So an offline mark for an offline-created worker inserts an orphan the database accepts. Choose:
add a `fieldoperator.create` mutation, or scope offline marking to already-synced operators and say
so on screen.

---

### UNKNOWN 4 — Pre-persistence semantic conflict detection

**ANSWER.** There is no seam today, and the gap is one layer deeper than expected: **the
contradiction cannot currently arise from voice at all.**

**The prerequisite.** `LedgerDerivationService.cs:347` reads `ReadString(item, "shift")`, but a
case-insensitive grep for "shift" across `ShramSafal.Infrastructure/AI/` returns only DATE_SHIFTING
lines in bucket prompts — neither `AiPromptBuilder.cs` nor `Prompts/core/outputContract.md`
(labour block at `:149-163`: count, gender, engagementType, rate, rateBasis, totalCost) ever asks the
model for a `shift` key. The client mirrors the hole: `LabourEventSchema` declares `shiftId`
(`AgriLogResponseSchema.ts:453`), never `shift`, and `shiftId` is written only by
`DetailSheet.tsx:78,111` (manual) and `mapLabourEngagements.ts:220` (sync pull), while
`logSyncMutationService.ts:339` sends `shift: event.shiftId`. So every voice-derived
`LabourAssignment.Shift` is NULL. This is the same defect class the repo already documented one line
below at `LedgerDerivationService.cs:350-360`, where the `workerNames` reader "existed and had never
once received anything". **Teaching the prompt to emit `shift` is a prompt-version bump + golden-set
delta (Definition of Done) and is a prerequisite for this Unknown, not a detail.** Note also that
`shiftId` is a config-derived string (`DetailSheet.tsx:49`, ids like `'full'`), not the enum — any
client-side comparison must normalise it the way `LabourAssignmentFactory.MapLabourShift` does
server-side.

**The contradiction is already being resolved silently at READ time.** `BuildHajeriLedger` walks
every named engagement and applies "present outranks half": `GetLabourDataHandler.cs:857-865`
(`if (cells[index] == "present") continue;` then `cells[index] = entry.IsHalf ? "half" : "present"`),
with `IsHalf = a.Shift == LabourShift.Half` at `:827`. A shipped test pins exactly the founder's case
— two assignments on one log for `रमेश`, one Half and one Full, asserting `present` and Total 1m
(`BuildHajeriLedgerTests.cs:101`, body through `:115`). Because no voice path produces a shift, this
rule can only fire between two **manually-entered** engagements today.

**The opposite policy — the one to copy — is 250 lines away in the same file.** Building the तपासा
review item, the handler collects the shifts, `.Distinct()`, and reports one only when exactly one
survives: "Shift is reported ONLY when the whole log agrees on one. Two gangs on different shifts
have no single shift, and naming the first would state one gang's shift as the day's"
(`GetLabourDataHandler.cs:602-612`). Same input, opposite output. `Count == 1` gives "two consistent
contexts ask nothing" for free.

**THE SEAM.** A new `UseCases/Labour/RecordAttendanceMark/RecordAttendanceMarkHandler.cs`, with the
check **after** the entitlement gate and **strictly before** `AddAttendanceMarkAsync` — the same
position `CreateDailyLogHandler.cs:304-321` occupies relative to its own staging.

**Pattern to imitate, in two halves.**
- *Mechanics:* `GetLabourDataHandler.cs:602-612`, lifted from per-LOG to per-`(farm, field_operator_id, work_date)` grain.
- *Pre-persistence discipline:* `CreateDailyLogHandler.cs:270-321` ("REFUSE IT HERE, before anything
  is staged, and say what it is", `:285`) plus its purpose-built port read
  `GetLabourAssignmentOwnerLogIdsAsync` (`IShramSafalRepository.cs:697-722`), whose doc says at
  `:705-707` that the read "is what lets CreateDailyLogHandler refuse the contradiction BEFORE
  anything is staged, and name it", and is deliberately projection-only / AsNoTracking (`:709-715`).

**Do NOT reuse the TryAdd idiom for a semantic contradiction.** `TryAddFieldOperatorWorkRowAsync`
(`ShramSafalRepository.cs:1541-1556`) is **not** forbidden code — its port doc
(`IShramSafalRepository.cs:871-879`) defines it as a sanctioned idempotency idiom mirroring
`ISyncMutationStore.TryStoreSuccessAsync`, keeping SQLSTATE 23505 inside Infrastructure. It is
correct for a *retry* and wrong for a fact the farmer must rule on. The genuine violation of the
"a database error must never decide to ask the farmer a question" rule is
`PushSyncBatchHandler.cs:544-573`, which converts any `DbUpdateException` into a generic retryable
error precisely because "we do not know the cause".

**The question's data contract** — modelled on `Admin/Ports/IEntitlementResolver.cs:15-52` (the
repo's only "we detected ambiguity, here are the candidates, send one back" contract, surfaced as
428 + candidate list at `AdminScopeHelper.cs:67-80`). Not `Result.Failure` — a contradiction is an
outcome, not an error:

```
enum AttendanceDayOutcome { Recorded = 0, Contradicted = 1 }

record DayFactCandidate(Guid LabourAssignmentId, string? Task, string? PlotName,
                        DayMark Day, NightMark Night);

record AttendanceDayContradiction(Guid FieldOperatorId, string DisplayNameAtAttach,
                                  DateOnly WorkDate, IReadOnlyList<DayFactCandidate> Candidates);

record RecordAttendanceMarkResult(AttendanceDayOutcome Outcome, Guid? AttendanceMarkId,
                                  AttendanceDayContradiction? Contradiction);
```

Four load-bearing properties: at most ONE contradiction per person per day; `Candidates` lists only
the facts that **disagree**, never every context of the day; there is deliberately **no `text`
member** — the Marathi is `[FOUNDER COPY REQUIRED]` and the server must not compose a farmer-facing
sentence (contrast `AdminScopeHelper.cs:71`, which does, because it is an admin surface); and it
imitates the SHAPE of the existing `QuestionForUser` (`log.types.ts:703-709` — id / type / target /
text / options) while **rejecting the AI as producer**, because this is a deterministic comparison of
two things the farmer already said. That channel is real and dead: the transport exists
(`AiPromptBuilder.cs:189`, `outputContract.md:17`, `AiResponseNormalizer.cs:91`), the client state
exists (`useVoiceRecorder.ts:76,598,612,732,844,874` — six hits, all in that one file), and nothing
renders it; `LABOUR_SOURCE_CHECK` appears in exactly two files, both type declarations.

**Resolution.** The answer re-invokes the same command with the chosen `Day`/`Night` plus the
`LabourAssignmentId` the farmer sided with, and writes ONE `AttendanceMark.Create`
(`AttendanceMark.cs:95-125`) — **no** `AttendanceMarkCorrection`, which structurally refuses a first
ruling (`AttendanceMarkCorrection.cs:110-114` requires an existing mark; `:132-139` refuses
original == new). The engagement plane cannot take the answer at all: `CorrectLabourCommand.cs:7-9`
corrects exactly "labour quantity, duration, worker attribution" and carries no Shift (record at
`:27-36`; the client mirror `labourCorrectionsClient.ts:53-60` carries none either).

**Three constraints the seam must honour.**
- The new port read **must ship a default body that throws** — `IShramSafalRepository.cs:832-836`:
  28 implementors, default interface implementations used deliberately, an abstract member produces
  ~135 compile errors. Follow `GetAttendanceMarksForFarmInWindowAsync` (`:919-923`) and throw, never
  return empty: "no contradiction found" is a positive claim.
- The handler asserts farm ownership **itself, on both sides**, as
  `AttachFieldOperatorHandler.cs:106-118` does — `p_user_select_labour_assignments`
  (`IShramSafalRepository.cs:855-860`) and `p_user_select_field_operator_work_rows` (`:896-902`) are
  both PERMISSIVE and documented as returning other farms' rows under a multi-farm login.
- The plan must say **what replaces** `BuildHajeriLedger`'s "Full wins" (`:857-865`) and its test.
  Those cells are keyed `name:` (`:872`), not by FieldOperatorId, so the mark plane can never answer
  for them. A move instruction with no replacement leaves the register undefined for exactly the rows
  the detector cannot reach.

**The pin that keeps the SQL index a last resort.** One architecture test in the
`LabourAnchorRules.cs:39-56` idiom — which is a `StripComments(...).Contains("LabourAssignment.Create(")`
substring scan over `ProductionSourceFiles()`, asserted with `ContainSingle` plus an exact-path check
at `:54`, **not** a regex — pinning that exactly one production file may contain
`AttendanceMark.Create(`, and that it is `RecordAttendanceMarkHandler.cs`. That file lives at
`src/tests/AgriSync.ArchitectureTests/LabourAnchorRules.cs`.

**No migration work is needed to stand the writer up.** `20260831180408_AddAttendanceMarks.cs` already
ships ENABLE + FORCE RLS (`:52-53`), both policies (`:55`, `:60`), the unique index (`:41`), and the
grants in the creating migration (`:86`, `:90`).

**One offline gap on this seam:** `PushSyncBatchHandler`'s outcome vocabulary is applied / duplicate /
failed (`:542`, `:552`, `:555`). A third outcome meaning "stop, ask the owner" does not exist there.
For an offline-created mark the question would surface at sync time, possibly days later. The plan
must state where the question surfaces on the offline path, or the seam is only half a seam.

---

### UNKNOWN 5 — The access/privacy boundary on the ledger read

**ANSWER, precisely.** The boundary is: *the caller is the farm's declared `Farm.OwnerUserId`, OR
holds a `ssf.farm_memberships` row whose status is NOT Revoked(5) and NOT Exited(6).* Nothing else.
Not role, not grant, not capture state, not money sensitivity.

**Does membership alone authorise reading attendance? YES — and it is wider than "membership".** The
predicate is *non-terminal* membership, which the port documents as "Active, PendingApproval,
PendingOtpClaim, Suspended" (`IShramSafalRepository.cs:230-234`;
`Domain/Farms/MembershipStatus.cs:15-20` gives Suspended = 4). So a **suspended** member and an
**invited-but-never-approved** member each read the entire labour page: every worker name, every
per-person काम झालं / दिलं / बाकी, the farm-wide money card, the ledger and the review inbox. This is
**pre-existing and repo-wide**, not Labour-created — the same predicate appears at
`ShramSafalRepository.cs:59-66`, `:82-87`, `:996-1001`, `:1135-1142`, `:1174-1186` (raw SQL
`status NOT IN (5, 6)`), `FarmMembershipConfiguration.cs:123`, and every `p_user_select_*` policy
since `20260607120000`. `FarmMembership.Suspend()` (`:192-202`) sets Status and ModifiedAtUtc and
pauses nothing about reading. **Report it; do not redesign it.**

**The read path is exactly two checks, both membership-only.**
1. HTTP gate — `LabourEndpoints.cs:66` calls `ICallerFarmTenantScope.EstablishForCallerAsync`, whose
   whole decision is `GetFarmMembershipForTenantAsync` (`CallerFarmTenantScope.cs:99-100`) and
   `if (!isMember) return Forbidden` (`:105-108`).
2. Handler defence-in-depth — `GetLabourDataHandler.cs:173-177`:
   `GetUserRoleForFarmAsync(...) is null → Result.Failure(ShramSafalErrors.Forbidden)`.

`callerRole == null` means **only** "neither the declared owner nor the holder of a non-terminal
membership row" (`ShramSafalRepository.cs:74-89`). Any non-null role — Worker included — passes. The
whole 1028-line handler has three `Result.Failure` sites (`154`, `170`, `176`) and only `176` is
authorization. Forbidden, never NotFound — the reason is stated at `LabourManagementGate.cs:50-53`
(a forged farm id must not be usable to probe existence).

**`HasExplicitGrantAsync` is NOT a gate — it is an FSM input.** Its single consumer is
`GetLabourDataHandler.cs:546-547`, feeding
`VerificationStateMachine.GetAvailableTransitions(status, role, grant)` to decide which logs appear
in the Review inbox. It never touches People, Dashboard, Money or Ledger. Role narrows exactly that
one thing, and `AppRole.Worker` is in the FSM's `AllRoles` set for Draft → Confirmed
(`VerificationStateMachine.cs:31-40`, `:45-48`), so a Worker-role caller still receives every Draft
log with its headcount.

**`ShramSafalAuthorizationEnforcer` contributes nothing to this read.** GET labour never invokes it.
Its four methods are `EnsureIsFarmMember` (`:94-111`, membership-only), `EnsureIsOwner` (`:113-136`),
`EnsureCanVerify` (`:138-179`, a WRITE gate), `EnsureCanEditLog` (`:201-220`). There are no read-side
rules for labour data in that file.

**People-list vs read-gate mismatch.** `GetLabourDataHandler.cs:191-194` filters People on
`Status == MembershipStatus.Active`, while the gate admits any non-terminal status. So a Suspended
Mukadam reads the page and does not appear on it. Two predicates already answer two different
questions; Phase 2 must not create a third.

**Stated money has no distinct protection today.** `LabourDataDto` is emitted whole with no
conditional projection; `LabourMoneyDto` (`Contracts/Dtos/LabourDataDto.cs:178-182`) and the
per-person RecordedWages/Paid/Owed (`:17-42`) render for every caller who cleared membership. Advance
is hard-coded `0m` (`GetLabourDataHandler.cs:379`). The comparison matters: farm money elsewhere sits
on the identical boundary — `GetFinanceSummaryHandler.cs:23-27` gates on
`GetFarmIdsForUserAsync(...).Count == 0`. Labour money is not *less* protected than finance money.

**RLS is not a boundary here and must not be leaned on.** `p_user_select_attendance_marks`
(`20260831180408:59-74`) and `p_user_select_labour_assignments` (`20260629064530:56-72`) are
PERMISSIVE, SELECT-only, keyed on `agrisync.user_id`, and contain **no `agrisync.farm_id` term** —
they OR past the tenant policy and expose rows from every farm the caller belongs to. The
OR-combination is stated at `20260607120000:29-33`. The only farm narrowing on attendance today is a
C# `Where` (`ShramSafalRepository.cs:1582`). Every new attendance query must carry its own explicit
`Where(x => x.FarmId == farmId)`.

**The gate no-ops under test.** `CallerFarmTenantScope.cs:59-62` returns success immediately when the
provider is non-relational, and `LabourEndpointTests.cs:43-55` says so itself. A new endpoint that
calls only `EstablishForCallerAsync` is authorization-free under the InMemory harness. **Both layers,
always.**

**Nothing pins this boundary for a non-owner caller.** `LabourEndpointTests.cs` seeds a Worker at
`:76` and then calls at `:78` with no `X-Test-UserId` header, and `TestAuthHandler` defaults to
`OwnerUserId` (`:244-247`) — so the test named `Get_AsFarmMember_Returns200_...` asserts a claim its
body does not exercise. This is the "test seam" failure shape already on record for this project.
Add two additive tests: a genuine Worker-role caller gets 200, and a real-Postgres test that a second
farm's `attendance_marks` are not returned when only `agrisync.user_id` is set.

**What visibly hides हजेरी today is client constants, not access control.**
`LabourHub.tsx:37,51,339,342` and `WeeklyDashboard.tsx:64,387`. Deleting them changes nothing about
who is authorised, and there is no capture-state gate on the server read path at all.

**Correction for anyone auditing this boundary:** the status-enum comment at
`ShramSafalRepository.cs:1172-1173` is wrong for all four non-terminal values (it says 0/1/2/3;
`MembershipStatus.cs:15-20` says 1/2/3/4 and omits nothing). The `status NOT IN (5, 6)` filter
beneath it is correct.

---

### UNKNOWN 6 — Owner-controlled Mukadam authority

**ANSWER.** One token plus one nullable column.

**The authority switch is one token.** Delete ` or AppRole.Mukadam` from
`Domain/Farms/LabourManagementPermission.cs:85-86`. Every other decision point delegates to that
predicate rather than re-listing roles, so the single deletion simultaneously (a) grant-gates the
labour-EDIT actions for a Mukadam (`LabourManagementGate.cs:74`), (b) makes the owner's PUT stop
returning 409 (`IsRedundantGrantTarget` is literally `=> IsCarriedByRole(role)` at `:117`, consumed
at `SetLabourPermissionHandler.cs:110-113`), and (c) makes the frontend switch interactive
(`LabourPermissionProjection.cs:22,45` → `IdentitySection.tsx:495` → `TeamMemberCard.tsx:149`). No
matrix, no attendance-specific flag. `IsAllowed` (`:94-95`) and `CanGrantOrRevoke` (`:102-103`) need
no edit; the prose at `:5-45`, `:48-84`, `:105-116` states the old rule as fact and must be rewritten.

**Do NOT touch `VerificationStateMachine` — but decide the scope of OFF.** The FSM already takes the
STORED grant, never the role predicate (`VerificationStateMachine.cs:199-200` opens only
Confirmed→Verified; `:129` / `:133-146` takes `bool hasLabourManagementGrant`;
`VerifyLogHandler.cs:95-99` reads `HasExplicitGrantAsync`). So "an ungranted foreman cannot sign off
his own day" survives with zero FSM edits. **However:** `VerifyLogAuthorizer.cs:38-39` routes *every*
`verify_log_v2` command through `EnsureCanVerify` regardless of TargetStatus, and
`ShramSafalAuthorizationEnforcer.cs:170-173` refuses on the gate — while
`VerificationStateMachine.cs:31-40` still grants Mukadam the Draft→Confirmed edge by role. So an OFF
Mukadam also loses the ability to **confirm** his own day. That is consistent with how an ungranted
Worker is already treated (`LabourCapabilityGateTests.cs:181`), but it is a behaviour change the plan
must make deliberately, not inherit.

**Stop the projection lying.** `LabourPermissionProjection.cs:33` maps `AppRole.Mukadam =>
"MukadamDefault"` unconditionally, ahead of the grant fallthrough, so an OFF Mukadam would report
`Source="MukadamDefault"` with `CanManageLabourRecords=false`. Move Mukadam into the
`_ => hasExplicitGrant ? "ExplicitGrant" : "NotGranted"` arm at `:34` (which also self-corrects `:22`,
`:27` and `:45`), and drop `"MukadamDefault"` from `LabourPermissionDto.cs:40-43` and the frontend
union at `labourPermissionsClient.ts:61`.

**Delete the third copy.** `LabourManagementGate.ResolveAsync` (`:129-150`) and
`LabourManagementDecision` (`:168-171`) have **zero callers repo-wide** and `:143` is a third read of
the role predicate. Leaving them makes this a three-site rule. Update the cross-reference at
`:98-102`. (The read surface that would have used it calls `LabourPermissionProjection.From` at
`GetLabourPermissionsHandler.cs:63`.)

**Expiry — one nullable column, TWO evaluation sites.** Greenfield: no expiry concept exists on
`FarmMembership` (a grep for `ExpiresAt` / `expires_at` over `Domain/Farms/` and
`FarmMembershipConfiguration.cs` returns zero hits).
- Property beside `FarmMembership.cs:81`; widen `SetLabourRecordManagement` (`:305`, terminal refusal
  `:307-311`, changed-detection `:313-320`) to carry the expiry.
- EF slot after `FarmMembershipConfiguration.cs:113`; **no index, no RLS change, no GRANT** — the
  reasoning is already written at `:102-109`, the covering index is `:121-124`, and the migration
  precedent `20260813081843_AddFarmMembershipLabourCapability.cs:94-112` is a bare AddColumn/DropColumn
  pair. All ssf grants are table-level, so a new column on a granted table needs none.
- **Both readers must see it.** The gate reads
  `ShramSafalRepository.cs:1679-1685` (`.AnyAsync` predicate; three overriders only —
  `:1673`, `StubShramSafalRepository.cs:156`, `LabourCapabilityGateTests.cs:529`). But
  `LabourPermissionProjection.cs:27,41-42` computes the roster answer straight off the **entity
  flag**, via `GetLabourPermissionsHandler.cs:63` and `SetLabourPermissionHandler.cs:167`, and never
  touches that predicate. An SQL-only expiry makes the owner's own roster and the PUT response report
  an expired grant as live — the same "control that lies" defect as the projection bug above. Either
  pass an effective `now` into the projection, or add an `IsCurrentlyEffective(DateTime nowUtc)` on
  `FarmMembership` that both sites call.

**The clock question, sized exactly.** Threading `nowUtc` through the gate touches **17 call
expressions**: `IsAllowedAsync` 5 production (`AttachFieldOperatorHandler.cs:93`,
`CorrectLabourHandler.cs:163`, `CreateFieldOperatorHandler.cs:41`, `RenameFieldOperatorHandler.cs:54`,
`ShramSafalAuthorizationEnforcer.cs:170`) + 9 test (`LabourCapabilityGateTests.cs:66,67,80,99,111,120,331`;
`LabourCapabilityGrantRealPostgresTests.cs:476`; `ExitMembershipRealPostgresTests.cs:511`);
`HasExplicitGrantAsync` 3 production (`LogsEndpoints.cs:215`, `GetLabourDataHandler.cs:185`,
`VerifyLogHandler.cs:98`); `ResolveAsync` 0. Plus one new `IClock` constructor parameter on
`ShramSafalAuthorizationEnforcer.cs:90-92` — the **only** one of eight production callers lacking a
clock (the other six inject it; the two minimal-API sites can take it as a lambda parameter, per
`FinanceEndpoints.cs:237` / `DfesEndpoints.cs:67`) — and 4 enforcer construction sites
(`FarmMembershipAuthorizationBaselineTests.cs:53`; `LabourCapabilityGateTests.cs:164,176,193`). DI
needs no edit (`AgriSync.BuildingBlocks/DependencyInjection.cs:10`;
`ShramSafal.Infrastructure/DependencyInjection.cs:415`).
**Do not size this as "2 files vs 12".** There is no in-repo precedent for `DateTime.UtcNow` inside an
EF LINQ predicate (the file's only occurrence, `ShramSafalRepository.cs:1851`, is a raw-SQL
parameter), the translation was never compiled or EXPLAINed, and the projection site means the SQL
route does not cover every reader anyway. Size it as **two sites plus a translation to verify**.

**Tests that must be REWRITTEN, not deleted** (intent must survive):
`LabourManagementPermissionTests.cs` — array `:24-25` driving theories `:51,:60,:120`, and the named
fact `A_Mukadam_is_allowed_with_no_grant_at_all` (`:82-89`) must be **replaced by its inverse**, never
deleted (it is the only test stating the rule in prose); `:104` unaffected.
`LabourCapabilityGateTests.cs` — `:59-72` (`GrantReads.Should().Be(0)` at `:69` breaks, the grant IS
now read), `:156-170` inverts, `:315-332` (`:326`, `:331` flip), and the roster test at `:339` whose
four flipping assertions are absolute `:358`, `:359`, `:360-361`, `:362`.
`LabourCapabilityGrantRealPostgresTests.cs:346` — the half at `:370-373` flips; `:357-364` unaffected.
`LabourPermissionEndpointTests.cs:157-183` — three assertions invert (`:169`, `:172`, `:180-182`).
`OwnerCanApproveAMukadamsLogRealPostgresTests.cs:357` and `:426` — **error code only**
(`ShramSafal.VerificationTransitionNotAllowedForRole` → `ShramSafal.Forbidden`, because the refusal
moves back one layer to `ShramSafalAuthorizationEnforcer.cs:170`); the surviving proofs at `:384-390`
and `:428-431` carry the intent and are untouched. `VerificationStateMachineTests.cs` — no assertion
changes; the comment at `:204-207` becomes false. Frontend: `labourPermissionsClient.test.ts:50,:87`
and `useLabourPermissions.test.ts:49`. Unaffected and worth not touching:
`ExitMembershipRealPostgresTests.cs:257`, `LabourCapabilityMigrationRealPostgresTests.cs:107/149/192`,
`FarmMembershipAuthorizationBaselineTests.cs:75/109`.

**One distinction collapses.** After the change, "no membership at all" and "member without labour
authority" both answer `ShramSafal.Forbidden` — and
`OwnerCanApproveAMukadamsLogRealPostgresTests.cs:444` exists specifically to keep them apart
(purpose stated at `:433-442`). If the plan wants them tellable apart, a distinct error code is
needed; the precedent shape is `ShramSafalErrors.cs:89-91`.

**No frontend sync change is needed.** `VerificationTransitionNotAllowedForRole` is **already** in
`PERMANENT_REJECTION_CODES` (`RejectionPolicy.ts:121`, rationale block `:87-103`, green test
`RejectionPolicy.test.ts:96-105`), as is `FORBIDDEN` (`:65`). The "OPEN, AND NOT MINE TO CLOSE"
comment at `OwnerCanApproveAMukadamsLogRealPostgresTests.cs:361-382` is stale and should be corrected
in the same commit.

**A fourth role-based Mukadam claim survives the change and should be logged, not fixed here.**
`User.Application/.../GetMeContextHandler.cs:106` computes
`canVerify = role is "PrimaryOwner" or "SecondaryOwner" or "Mukadam"` from the role string with no
grant read. It is already false today for an ungranted Mukadam and stays false after. Harmless now —
`MeContextService.ts:17` carries the field and no render path consumes it — but it is a fourth copy of
the rule.

---

## 3. REPO-TRUTH CONFLICTS

Each is an obstacle to solve. None is a question to re-decide.

**C1 — Settled #3 (Mukadam authority is owner-controlled) is contradicted by shipped code.**
`LabourManagementPermission.IsCarriedByRole` grants every Mukadam labour authority on role alone
(`:85-86`), the grant read is unreachable for him (`LabourManagementGate.cs:74-77` short-circuits
before `:79`), and the owner is **refused** when he tries to switch it off
(`SetLabourPermissionHandler.cs:110-113` returns `ShramSafalErrors.LabourManagementCarriedByRole`).
The owner's flag *is* consulted — but for the APPROVE tier only (`LabourManagementPermission.cs:69-84`
documents the deliberate split, including that feeding `IsCarriedByRole` to the verification FSM was
false in production for fifteen days). The obstacle is that attendance and the four labour-EDIT
actions sit in the role-carried tier where the owner has no switch. **Solve:** delete the token
(UNKNOWN 6) and decide whether OFF also removes Draft→Confirmed.

**C2 — Settled #1 (all five day realities are R1) is contradicted by the attendance schema.**
`AttendanceMark` carries only `Day` and `Night` (`:79-81`), with enums
`DayMark{Unmarked,Full,Half,Absent}` (`:167`) and `NightMark{Unmarked,Worked,NotWorked}` (`:177-182`);
the table has only `day_mark` and `night_mark` ints (`20260831180408:23-24`). Extra time and specific
hours have nowhere to land. **Solve:** UNKNOWN 2, inside the unmerged CreateTable, before the wire
contract is authored.

**C3 — Settled #1 again: the shipped हजेरी read renders a NIGHT engagement as a full-day "present".**
`LabourShift` has Full/Half/Night (`Domain/.../LabourShift.cs:4-9`), but
`GetLabourDataHandler.cs:827` tests only `== LabourShift.Half`, so a Night engagement falls to the
else branch at `:865` and renders `"present"`. The register asserts a full day nobody made. This is
live code, one layer beneath the missing hours columns. **Solve:** fix with the ledger rework in
Phase 2; do not ship the new columns on top of it.

**C4 — Settled #1 again: the voice pipeline never asks for a shift.**
`LedgerDerivationService.cs:347` reads a `"shift"` key that `AiPromptBuilder.cs` and
`Prompts/core/outputContract.md` (labour block `:149-163`) never request; the client declares
`shiftId` (`AgriLogResponseSchema.ts:453`) which only manual entry (`DetailSheet.tsx:78,111`) and
sync-pull (`mapLabourEngagements.ts:220`) ever set. Half-days cannot arrive from speech.
**Solve:** prompt-version bump + golden-set delta, or rule that half-days arrive via the mark plane
only — state which.

**C5 — Settled #2 (offline attendance is R1) is blocked by RLS on the sync route.**
`p_tenant_attendance_marks` `WITH CHECK (farm_id = NULLIF(current_setting('agrisync.farm_id', true), '')::uuid)`
(`20260831180408:57`) and the user-scoped policy is `FOR SELECT` only (`:61`). `/sync/` is in
`TenantTransactionMiddleware.SkipPathPrefixes` (`TenantTransactionMiddleware.cs:225`), so the push
path runs admin-elevated with **no** GUC — stated by the repo itself at
`PushSyncBatchHandler.cs:1257-1265`. The WITH CHECK then evaluates to NULL and the INSERT is refused.
Note the existing labour table is **not** a precedent: `p_tenant_labour_assignments` is
`WITH CHECK (true)` (`20260629064530:54`), which is why labour writes survive this path today.
**Solve:** the attendance mutation handler must call
`PushSyncBatchHandler.EstablishFarmScopeForDerivationAsync` (`:1088`, GUC writes `:1246-1249`).

**C6 — Settled #2 and #5: there is no offline store and no offline read for attendance.**
No attendance store exists in any Dexie version (`.../dexie/versions/v1.ts … v24.ts`; v24's store list
is `:70-107`), the Labour feature fetches over HTTP with no cache (`useLabourState.ts:19` →
`labourClient.ts`, which contains no Dexie reference), and there is no attendance list in
`SyncPullResponseDto` (`SyncDtos.cs:22-63`). A farmer marks a day offline and the register he opens
ten seconds later is blank. **Solve:** Dexie v25 (re-listing every v24 store verbatim, `v24.ts:71-74`;
one-way for APK users, `:59-60`) plus a pull carriage or a local read.

**C7 — Settled #1: the shipped save button lies.** `Attendance.tsx:103` → `LabourFeature.tsx:196`
shows `जतन झाले → मंजुरीसाठी` and writes nothing — no HTTP call, no queue row, no local store.
`LabourHub.tsx:35` and `LabourDataDto.cs:298-300` both already say so. **Solve:** R1 replaces it; it
must not survive beside a real write path.

**C8 — Settled #6 ("through whom" matters): a person-scoped "his team" already ships, fed by a
hardcoded null.** `LabourDataDto.cs:26,65` declare `AppointedById` / `MemberIds`;
`GetLabourDataHandler.cs:399,405` hardcode both to null for every person;
`MukadamDetail.tsx:81` renders `याची माणसं · his team` and `LabourHub.tsx:429` renders `teamCount`.
**Solve:** the plan states in one line that the new engagement-scoped column is not this, and says
what happens to these two.

**C9 — the derived-vs-marked collision.** `LabourDataDto.cs:298-300` asserts "Rows stays empty, and
that is correct rather than pending", but `GetLabourDataHandler.cs:1014-1019` already fills Rows with
one `LabourAttendanceRowDto(id, "present")` per operator attached to today's work rows — and that DTO
carries no field distinguishing derived from marked. A real write path lands beside a derived one with
no way to tell them apart. **Solve:** carry provenance on the row, or stop deriving.

**C10 — `attendance_mark_corrections` has no user-scoped SELECT policy.**
`20260831185516:50-53` creates only the tenant policy; `p_user_select_attendance_mark_corrections`
does not exist anywhere. The moment a हजेरी read runs in user-scoped mode (the mode `/sync/pull` and
`/shramsafal/finance/summary` use — `TenantTransactionMiddleware.cs:97,:124`), corrections vanish while
marks remain visible, and amended days render as if never amended. **Solve:** ship the sibling policy,
mirroring `20260831180408:59-74`.

**C11 — the boundary nobody tests.** `LabourEndpointTests.cs:76` seeds a Worker and `:78` calls as the
owner (`TestAuthHandler` default at `:244-247`), under the name
`Get_AsFarmMember_Returns200_WithPeopleAndDashboard`. The one test a Phase 2 author would trust to pin
non-owner access does not exercise it. **Solve:** two additive tests (UNKNOWN 5).

**C12 — `AttendanceMark.Value` turns silence into zero, contradicting its own doc comment three lines
above.** `:156-158` is `Day switch { Full => 1m, Half => 0.5m, _ => 0m } + (Night == Worked ? 1m : 0m)`,
so Unmarked and Absent are numerically identical, while `:152-155` states "Unmarked contributes
NOTHING on either half — it is not a zero, it is a silence, and a row total must never turn one into
the other." Nothing reads `Value` in production today, so obsoleting or fixing it is free.
**Solve:** keep it out of every R1 read path and pin that.

---

## 4. What this changes in the plan

| Task / plan area | What must change | Why |
|---|---|---|
| Task ordering, overall | Insert a **STEP 0** before the sync contract: land extra-time + specific-hours on the domain and the unmerged CreateTable | `AttendanceMark` has only Day/Night (`AttendanceMark.cs:79-81`); a 3-of-5 wire contract behind `PayloadHasOnly` + parity gate + `sinceVersion` is far harder to widen than a table |
| D16 `accompanying_count` on the mark | **Delete.** Replace with `labour_assignments.engaged_through_field_operator_id uuid NULL` | Mark grain is one row per person per farm-day (`20260831180408:40-45`); an engagement-scoped count cannot live there |
| "copy an existing nullable operator FK" | **Strike.** State: this is the schema's first nullable FK; NULL = "nobody said through whom" | No nullable FK exists in `ssf` (incl. raw-SQL FKs at `WtlV0Entities.cs:67-68`, `FinanceV2.cs:47`, `AddAiOrchestration.cs:95-99`, `AddAuditEvents.cs:205-242`) |
| Grant task for the new column | **Delete the task**; add a one-line migration comment "no GRANT needed — privileges are per-table" and **no causal story** | Repo contradicts itself on grant provenance (`AddDfesDataSpine.cs:257-264` vs `AddRawBlobSubjects.cs:149-178` vs `GrantFieldOperatorWorkRowsToAppRole.cs:8-18`) |
| `CreateDailyLogHandler` labour staging | **Add** a cross-farm guard: load the FieldOperator, assert `OriginatingFarmId == command.FarmId` | `WITH CHECK (true)` (`20260629064530:54`), PERMISSIVE user-select, FK checks bypass RLS |
| Editability of "through whom" | **Add a stated decision**: immutable-at-create, or a third mutator + a sixth `LabourCorrection` constant | `LabourAssignment.cs:172-189` refuses a general Update; `LabourCorrection.cs:166-172` throws outside five fields |
| Third attendance migration | **Delete.** Edit `20260831180408` / `20260831185516` in place and regenerate Designer + snapshot | Neither has shipped — `git ls-tree origin/main` finds no attendance migration |
| `hours_basis` column | **Delete.** Two nullable bare-`numeric` columns; nullability answers stated-vs-not-stated | `LabourTimeBasis` exists so the server can invent 8h (`LabourTime.cs:33,67`); the mark is "never the app" (`AttendanceMark.cs:83`) |
| `AttendanceMark` emptiness guard | **Add**: widen from two facts to four, plus a positivity guard, plus a rule for null-ing a present hours value | `:112-121` and `:135-141` throw on an hours-only ruling today |
| `AttendanceMarkCorrection` | **Add**: two constants, a `CorrectableFields` HashSet, and **per-field** nullable original/new (hours only) | `:116-121` allows exactly two halves; `:123-130` + `20260831185516:23-24` refuse a first statement |
| `Amend()` signature | **Do it first**, while it has zero production callers | Only call sites are `AttendanceMarkTests.cs:121,141` |
| `sinceVersion` for `attendance.mark` | **Set `"0.9.0"`**, and do not bump `package.json` in this work | Wire version is `package.json:4` = `0.9.0`; `jobcard.*` at `1.0.0` is already CLIENT_TOO_OLD (`PushSyncBatchHandler.cs:629-637`) |
| Sync handler persistence | **Correct**: copy `CorrectLabourHandler` for validation ORDER, `AddCostEntryHandler.cs:213` for the commit point; no `TryStoreSuccessAsync` in the new handler | `PushSyncBatchHandler.cs:522` already owns it; `CorrectLabourHandler.cs:40-44` warns against two owners |
| Sync handler farm scope | **Add**: call `EstablishFarmScopeForDerivationAsync` (`PushSyncBatchHandler.cs:1088`) | `/sync/` is skip-listed (`TenantTransactionMiddleware.cs:225`); the mark's `WITH CHECK` needs the GUC (`20260831180408:57`) |
| Zod export name | **Pin** it as exactly `AttendanceMarkPayload`, and treat the parity-gate edit as load-bearing | `PayloadValidator.ts:48-53` fails **open** on a name miss |
| Parity + catalog test constants | **Add** as a task: 14→15, 32→33, `EXPECTED_GUARDED_MUTATIONS` + `PayloadHasOnly` on ONE line | `allowlist-parity.test.ts:52,59-77,100,105`; `catalog.test.ts:26-27` |
| Offline scope | **Add**: Dexie v25 store + read-back path + a decision on field-operator identity offline | No attendance store in any version; no FK on `field_operator_id` (`20260831180408:29-32`) |
| Conflict detection seam | **Set** it inside `RecordAttendanceMarkHandler`, after the gate and before staging; port read ships a **throwing default body** | `CreateDailyLogHandler.cs:270-321`; `IShramSafalRepository.cs:832-836` (28 implementors) |
| Conflict detection, offline | **Add**: state where the question surfaces on the sync path | `PushSyncBatchHandler` outcomes are applied/duplicate/failed only (`:542,:552,:555`) |
| `BuildHajeriLedger` "Full wins" | **Add** the replacement rule, not just a move instruction | Cells are `name:`-keyed (`:872`); the mark plane cannot answer for them |
| Prompt work | **Add** a task: teach the prompt to emit `shift`, with version bump + golden-set delta — or rule that half-days arrive only via the mark | `outputContract.md:149-163` never asks for it |
| Permission change | **Confirm** one-token; **add** the OFF-scope decision (does OFF remove Draft→Confirmed?) | `VerifyLogAuthorizer.cs:38-39` is status-blind; `VerificationStateMachine.cs:31-40` still lists Mukadam |
| Permission change | **Add**: fix `LabourPermissionProjection.cs:33` and delete `ResolveAsync` / `LabourManagementDecision` | Otherwise the projection lies and a third copy of the rule survives |
| Grant expiry | **Correct**: two evaluation sites, not one | `LabourPermissionProjection.cs:27,41-42` reads the entity flag, never the gate predicate |
| Prod backfill of existing Mukadams | **Add** as an explicit founder decision; if taken, write it as the repo's DO-block, not a bare UPDATE | `can_manage_labour_records` is NOT NULL DEFAULT false (`20260813081843:96-102`) and no Mukadam can hold true today; `ssf.farm_memberships` is FORCE-RLS (`20260516130000:115,125-131`) and the runner is `agrisync_app` (`20260812122505:124-130`) — a bare UPDATE touches zero rows silently. Shapes: `20260812122505:131-153`, `20260815080242:152-168`. `role` is varchar (`FarmMembershipConfiguration.cs:44-48`) → `role = 'Mukadam'`; `status` is int → `status NOT IN (5,6)` |
| Frontend `RejectionPolicy` task | **Delete** | `VerificationTransitionNotAllowedForRole` is already permanent (`RejectionPolicy.ts:121`, test `:96-105`) |
| `MemberIds` / `AppointedById` | **Add** a one-line disposition | Hardcoded null (`GetLabourDataHandler.cs:399,405`) yet rendered (`MukadamDetail.tsx:81`) |
| `AttendanceMark.Value` | **Add**: pin it out of every R1 read path | `:156-158` turns Unmarked into 0, contradicting `:152-155` |
| Privacy inventory | **Add**: update `ErasureWorker.cs:199-201` and `:221-223` by hand | `ErasureManifestCoverageTests.cs:85-87` scans table names only |
| Tests | **Add**: Worker-role caller 200; cross-farm attendance RLS; and rewrite (never delete) the 7 backend + 3 frontend Mukadam tests listed in UNKNOWN 6 | `LabourEndpointTests.cs:76,78,244-247` asserts a claim it does not exercise |
| `p_user_select_attendance_mark_corrections` | **Add** the policy | Absent (`20260831185516:50-53`); amended days would render un-amended in user-scoped mode |

---

## 5. Still UNVERIFIED

Labelled honestly. None of these is laundered into a fact above.

1. **Whether the shipped capture UI lets a farmer create a SECOND labour engagement in one daily log.**
   The data layer supports it end to end (`create_daily_log.zod.ts:168`;
   `CreateDailyLogHandler.cs:521-569`; `log-factory-helpers.ts:210-218`), but neither reader opened the
   manual-entry or voice-confirm screens. **If it does not exist, UNKNOWN 1 becomes a capture build,
   not a column.** This should be the first thing Phase 1 closes.
2. **Whether "specific hours" means an hour COUNT or a clock RANGE.** Every written reference is a
   count (`REVISION-1:111`, `3 तास जादा`) and no artefact defines it as a range. Two numerics are right
   for a count and wrong for a range. One founder line settles it; it is a definitional ambiguity, not
   a scope question.
3. **Whether prod actually holds the grants / policies described.** Every RLS and GRANT statement above
   is read from migration source. No prod query was run, and per standing project memory `ssf` metadata
   is not reliably readable via `agrisync_readonly`. If certainty is wanted, one measurable check:
   `has_table_privilege('agrisync_app','ssf.labour_assignments','INSERT')`.
4. **Whether `p_user_select_*` policies are PERMISSIVE at runtime.** Inferred from the PostgreSQL
   default (no `AS RESTRICTIVE`) plus `20260607120000:29-33`. No `pg_policies` query was run.
5. **Whether any LOCAL dev database has already applied `20260831180408` / `20260831185516`.** If so,
   editing them in place needs a local drop-and-reapply. No database was run.
6. **Whether `WorkerCount` on an engaged-through engagement includes the mukadam himself.** The plan's
   "anonymous remainder = WorkerCount − distinct attributed operators" only yields 8 for "Shankar + 8"
   if WorkerCount is 9 AND Shankar carries a work row. Nothing in the schema or code decides this. It is
   an arithmetic precondition of the plan's own formula.
7. **`HajeriLedger.tsx` read-path changes for a Mukadam-wise grouping.** The server DTO and client
   `AttributedOperator` type were traced; the component's rendering of a tri-state cell was asserted by
   REVISION-1 and not independently confirmed at `file:line`.
8. **ADR 0026 (Worker Identity Ladder).** `_COFOUNDER/` is a gitignored nested repo and was not opened.
   The prohibition text is verified verbatim at `IWorkerRepository.cs:17-29`; what the ADR permits is
   unverified.
9. **Whether the LIVE prod prompt (post `{{MARATHI_VOCAB}}` / `{{FEW_SHOTS}}` expansion, at the deployed
   prompt version) ever instructs the model to populate `questionsForUser` or `shift`.** Only the
   skeleton, contract doc and normalizer were read — all three show an empty array / no `shift` key.
10. **Whether admin / MIS / export / report surfaces read labour attendance or stated money under a
    different boundary.** `MapAdminEndpoints`, `MapReportEndpoints`, `MapExportEndpoints` were not
    audited. `ExportWorker.cs` contains no occurrence of "attendance" — a pre-existing gap not traced to
    a decision.
11. **Whether `AppRole` 4-8 (Agronomist, Consultant, FpcTechnicalManager, FieldScout, LabOperator) are
    ever assigned on a ShramSafal farm membership.** They pass the read gate identically; no code path
    creating one was traced.
12. **Whether the existing index stays an index-only scan once the expiry column joins the predicate.**
    `ix_farm_memberships_farm_user_nonterminal` (`FarmMembershipConfiguration.cs:121-124`) was read; no
    EXPLAIN was run.
13. **Whether `ICallerFarmTenantScope`'s implementation sets the GUC as described.** Read at
    `CallerFarmTenantScope.cs:113-116`; the HTTP route's end-to-end GUC behaviour was traced through
    surrounding comments, not executed.
14. **Nothing was built or tested.** No `dotnet build`, no `dotnet test`, no vitest run. Every "this test
    goes red" prediction is read from source, not observed.
15. **The Marathi copy** for a Mukadam switch that now has an OFF position, for an expiry, and for the
    contradiction question. `TeamMemberCard.tsx:139-141` records a founder ruling that three labels are
    English-only because no approved Marathi exists and no agent may invent farmer-facing Marathi. All
    of this is `[FOUNDER COPY REQUIRED]`.

---

## 6. READY / NOT READY for Phase 1

**READY — with one sequencing condition and two decisions.**

Phase 0 answered all six unknowns with named files, named migrations, named tests and counted call
sites. Every implementation shape is repo-native: one nullable column, two nullable columns on an
unmerged CreateTable, one sync mutation on the existing pipeline, one new handler, one deleted token.
Nothing found requires a new subsystem, and nothing found contradicts the plan's architecture — the
corrections are to its *order*, its *sizing*, and about a dozen of its citations.

**The sequencing condition (blocking for the wire, not for Phase 1):** the attendance record must be
able to hold all five day-realities before `attendance_mark.zod.ts` is authored. Writing the payload
first freezes a three-of-five contract behind `PayloadHasOnly`, the parity gate and a `sinceVersion`,
all of which are harder to widen than a column on an unmerged table.

**Two decisions Phase 1 needs from the founder, one line each:**
1. Is "specific hours" an hour **count** or a **clock range**? (UNVERIFIED #2 — decides two numerics
   vs two time columns.)
2. On the day the permission token is deleted, do existing Mukadams start **ON** (preserving today's
   behaviour, requiring a backfill written as the repo's DO-block) or **OFF**? Code cannot answer this,
   and without an answer every mukadam on every pilot farm silently loses labour authority on deploy.

**And one thing to close first, before UNKNOWN 1 is costed:** open the capture screens and confirm a
farmer can create a second labour engagement in one daily log. That single check is the difference
between a column and a capture build.

**One thing to be told, not asked:** a suspended farm member, and an invited-but-never-approved one,
can read the entire wage book today — names and money. Pre-existing, repo-wide, older than Labour, and
explicitly out of Labour V2's scope to redesign.
