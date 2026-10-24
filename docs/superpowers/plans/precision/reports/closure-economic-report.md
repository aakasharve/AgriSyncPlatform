# Closure — the रोजंदारी / उक्ते काम discriminator

spec: 2026-08-28-labour-v2-release-1 · branch `feat/labour-v2-r1` · 2026-09-03

Founder's warning was correct. `ContractUnit == null → रोजंदारी` was **not** sufficient,
and case **E** (a whole-job fixed amount with no measurement unit) was the failure he
predicted. **D** and **F** failed with it. The fix reuses a field that already exists,
already persists, and already travels on the wire. **No new entity, no new column, no
migration, no wire change, no client change.**

---

## 1. What decided the buckets TODAY (before the change)

One test, in three places, all in one file:

| Site | Line (pre-change) | Code |
|---|---|---|
| रोजंदारी money card | `GetLabourDataHandler.cs:833` | `SumStated(allAssignments.Where(a => a.ContractUnit is null))` |
| उक्ते money card | `GetLabourDataHandler.cs:834` | `SumStated(allAssignments.Where(a => a.ContractUnit is not null))` |
| आज कामावर — रोजंदारी | `GetLabourDataHandler.cs:836` | `SumKnownHeadcounts(todays.Where(a => a.ContractUnit is null))` |
| आज कामावर — उक्ते | `GetLabourDataHandler.cs:837` | `SumKnownHeadcounts(todays.Where(a => a.ContractUnit is not null))` |
| हजेरी cell उक्ते dot | `GetLabourDataHandler.cs:956` | `Ukte: contextAssignments.Any(a => a.ContractUnit is not null)` |

Nothing else in the repo derives the split. The client is a pure renderer — it reads
`home.rojandariStated / ukteAgreed / rojandariToday / ukteToday` and `cell.ukte` straight
off the DTO (`LabourHub.tsx:357-380`, `labourClient.ts:215`). Grep for a client-side
re-derivation from `contractUnit` returns nothing.

---

## 2. What `ContractUnit` actually is, end to end

**Enum** — `ShramSafal.Domain/Farms/ContractUnit.cs:4`. Four members: `Tree`, `Acre`,
`Row`, `LumpSum`. Its own doc line: *"Unit a contract rate is quoted in."* That is a
**rate unit**, not the existence of an agreement. Founder's suspicion confirmed at the
definition.

**Nullable** on the entity (`LabourAssignment.cs:67`); column `contract_unit varchar(20)`
NULL-able (`LabourAssignmentConfiguration.cs:26-27`).

**Who sets it — only ever one mapper, from one wire string:**

| Path | Call site | Source string |
|---|---|---|
| Voice / AI derivation | `LedgerDerivationService.cs:337` | `ReadString(item, "contractUnit")` |
| Manual entry | `CreateDailyLogHandler.cs:556` | `item.ContractUnit` |

Both go through `LabourAssignmentFactory.MapContractUnit` (`LabourAssignmentFactory.cs:152-159`),
which is TOTAL and never throws:

```
"tree" → Tree · "acre" → Acre · "row" → Row
"lump sum" | "lump_sum" | "lumpsum" → LumpSum
_ → null
```

**Does a whole-job उक्ते reliably land with `LumpSum`? No.**

- `LumpSum` exists in the enum, in the mapper, in the Zod enum
  (`AgriLogResponseSchema.ts:169` — `['Tree','Acre','Row','Lump Sum']`) and in the pull
  mapper (`mapLabourEngagements.ts:105-116`). The plumbing is complete.
- **But nothing ever produces it from speech.** The labour prompt bucket
  (`Infrastructure/AI/Prompts/buckets/labour.v1.md:8`) carries exactly one contract
  example — `"Contract ne 2 acre chhatani keli" => contractUnit Acre`. Neither
  `labour.v1.md` nor `AiPromptBuilder.cs` mentions lump sum, "ठरलं", or a fixed
  whole-job price anywhere. The only human path that emits it is the DetailSheet dropdown
  (`DetailSheet.tsx:356`), which a farmer speaking a price never touches.
- So `"ठरलं ₹१५,००० ला"` lands as `ContractUnit = null`, `TotalCost = 15000` — and the
  old test filed it, and its ₹15,000, under **रोजंदारी**. That is case E.

---

## 3. What DOES establish "governed by an उक्ते agreement"

**`LabourAssignment.EngagementType`** (`LabourAssignment.cs:62`, enum
`LabourEngagementType.cs` — `Hired | Contract | Self`). It is the field whose declared job
is *"How labour was engaged"*, and it is the only one that names a contract as such.

Everything it needs is already true:

- **NOT NULL on every row** — `engagement_type varchar(20) NOT NULL`
  (`LabourAssignmentConfiguration.cs:18-19`). No backfill question, no null semantics.
- **Both write paths already set it** — `MapLabourEngagement` from voice
  (`LedgerDerivationService.cs:~334`, reading `engagementType` then legacy `type`) and
  from manual entry (`CreateDailyLogHandler.cs:~549`).
- **The client already sends it** — `logSyncMutationService.ts:226`
  (`event.engagementType || event.type || 'hired_daily'`), and `DetailSheet.tsx:164` sets
  `type: 'CONTRACT'` when a contract is entered.
- **It is already on the wire back** — `LabourEngagementDto.EngagementType`
  (`LabourEngagementDto.cs:54`, projected at `DtoMappingExtensions.cs:163`).
- **Its map is TOTAL and fails to the safe side** — anything unrecognised becomes
  `Hired` (`LabourAssignmentFactory.cs:120-140`), i.e. day-rate. That is exactly the
  founder's direction: *no KNOWN उक्ते agreement → रोजंदारी*. It can never invent a
  contract nobody stated.

### Candidates rejected, and why

| Candidate | Rejected because |
|---|---|
| `TotalCost is not null` | Day-rate work states totals constantly ("६ जण, ३०० रुपये रोज, १८०० झाले"). Reading a total as an agreement sweeps most of रोजंदारी into उक्ते and inverts the defect. |
| `EngagedThroughFieldOperatorId is not null` | The founder's own bullet — *"Mukadam involvement ≠ automatically contract."* The link records through WHOM, never on what BASIS. This is case C, and it must stay day-rate. |
| `ContractQuantity is not null` | A measured quantity is a measurement, not an agreement, and in practice it never arrives without a unit. Adds no case the primary signal misses. |
| Worker names / headcount / frequency | *"unnamed ≠ unknown payment model", "occasional worker ≠ contract worker."* Cases A and B. |
| A new `IsUkte` / `HasAgreement` column | Unnecessary — the fact is already recorded, NOT NULL, on every row, in both write paths. A new field would be a second copy of an existing truth, free to drift. |

---

## 4. The change

**One predicate, three call sites, one file.**

`src/apps/ShramSafal/ShramSafal.Application/UseCases/Labour/GetLabourData/GetLabourDataHandler.cs`

```csharp
private static bool IsUkte(LabourAssignment assignment)
    => assignment.EngagementType == LabourEngagementType.Contract
        || assignment.ContractUnit is not null;
```

- `BuildLabourHome` — all four filters now read `IsUkte(a)` / `!IsUkte(a)`.
- `BuildHajeriLedger` — the cell dot now reads `contextAssignments.Any(IsUkte)`, so the
  हजेरी dot and the उक्ते money card cannot disagree about what उक्ते means.

`ContractUnit` is kept as a **second** signal rather than removed, deliberately:

1. A stated rate unit *is* evidence of the same agreement (it is the unit that agreement's
   rate is quoted in), so it is a true positive, not a guess.
2. Every row already written with a unit keeps the exact meaning it was read with — this
   change is purely additive on live data. No row moves from उक्ते to रोजंदारी.

Also corrected: two doc comments that described the old rule and would otherwise have
become lies — `LabourDataDto.cs` (`LabourHomeDto` remarks) and the `BuildHajeriLedger`
summary. Both now point at `IsUkte` as the single place the question is answered.

**Not touched:** no client file, no DTO shape, no `sync-contract/` schema, no migration,
no domain entity, no write path. The wire already carried `engagementType` in both
directions before this change.

### Files changed

| File | Change |
|---|---|
| `src/apps/ShramSafal/ShramSafal.Application/UseCases/Labour/GetLabourData/GetLabourDataHandler.cs` | `IsUkte` added; 5 call sites switched to it; ledger doc corrected |
| `src/apps/ShramSafal/ShramSafal.Application/Contracts/Dtos/LabourDataDto.cs` | `LabourHomeDto` remarks corrected to the real rule |
| `src/tests/ShramSafal.Domain.Tests/Labour/UkteDiscriminatorTests.cs` | **new** — the seven cases A–G |
| `src/tests/ShramSafal.Domain.Tests/Labour/BuildHajeriLedgerTests.cs` | helper takes an `engagementType`; one test added for the dot on a no-unit whole-job agreement |

---

## 5. The seven cases — before and after

Measured against `GetLabourDataHandler.BuildLabourHome`, one test per case, named for it.

| Case | Scenario | Before | After |
|---|---|---|---|
| **A** | 6 workers, unnamed, no agreement | **PASS** — 6 रोजंदारी | PASS |
| **B** | worker appears only once, no agreement | **PASS** — day-rate | PASS |
| **C** | Mukadam brings 8, no agreement | **PASS** — 8 रोजंदारी, crew link ignored | PASS |
| **D** | Mukadam brings 8 under an उक्ते agreement (no unit) | **FAIL** — read as 8 रोजंदारी | PASS — 8 उक्ते |
| **E** | fixed ₹15,000 whole job, NO unit | **FAIL** — ₹15,000 on the रोजंदारी card | PASS — ₹15,000 on उक्ते, रोजंदारी null |
| **F** | 4 day-rate + 8 उक्ते, same plot/day | **FAIL** — read as 12 रोजंदारी, ₹16,200 on one card | PASS — 12 total, 4 + 8, ₹1,200 and ₹15,000 never combined |
| **G** | day-rate headcount, rate unknown | **PASS** — headcount 6, money null | PASS |

Before-state, measured (not inferred), against unmodified `main` logic:

```
Failed!  - Failed: 3, Passed: 4, Skipped: 0, Total: 7
  UkteDiscriminatorTests.D_MukadamCrewUnderAnUkteAgreementIsUkte [FAIL]
  UkteDiscriminatorTests.E_WholeJobFixedAmountWithNoUnitIsUkte [FAIL]
  UkteDiscriminatorTests.F_DayRateAndUkteOnTheSameDaySplitWithoutCombining [FAIL]
```

Note **F**'s before-failure is the sharpest: the two money truths the founder said must
never combine were both landing on the रोजंदारी card, which is precisely the
"₹16,650 खर्च" the D6 rule exists to forbid.

---

## 6. Gate — verbatim counts

All runs on this worktree, `feat/labour-v2-r1`, after the change.

```
Passed!  - Failed: 0, Passed:    7, Skipped: 0, Total:    7  — UkteDiscriminatorTests (the seven cases)
Passed!  - Failed: 0, Passed: 2005, Skipped: 1, Total: 2006  — ShramSafal.Domain.Tests (full)
Passed!  - Failed: 0, Passed:  107, Skipped: 0, Total:  107  — AgriSync.ArchitectureTests (full)
Passed!  - Failed: 0, Passed:  100, Skipped: 0, Total:  100  — Sync.IntegrationTests, ~Labour & Category!=RequiresDocker (RealPostgres :5433)
```

`dotnet format src/AgriSync.sln --verify-no-changes` → **0 whitespace errors** (measured
0 on HEAD baseline too, so the working tree is at parity with the pre-commit hook).

sync-contract tests: **not run, not required** — the contract was not touched. The
`sync-contract/schemas/payloads-csharp/*` modifications present in this worktree pre-date
this task and belong to another agent.

### Environment note (cost me a false red, recording it)

The first RealPostgres run reported 71 failures, all
`RequiresPostgres: 28P01 password authentication failed for user "postgres"`. The
credential is **not missing**: `REQUIRES_POSTGRES_ROOT_CONN` was set in the shell's
**Process** scope with a stale password while the correct value sits in **User** scope.
Re-hydrating it per-run fixes it:

```powershell
$env:REQUIRES_POSTGRES_ROOT_CONN = [Environment]::GetEnvironmentVariable('REQUIRES_POSTGRES_ROOT_CONN','User')
$env:AGRISYNC_TEST_APP_ROLE_PASSWORD = [Environment]::GetEnvironmentVariable('AGRISYNC_TEST_APP_ROLE_PASSWORD','User')
```

A single `LabourReadMembershipStatusRealPostgresTests` failure seen in one intermediate
run did **not** reproduce: it threw from `ShramSafalRepository.GetOperatorsByIdsAsync`
(`ShramSafalRepository.cs:1103`), a DB read reached at `GetLabourDataHandler.cs:343` —
before either changed builder runs — and the suite passed in isolation both with and
without the change, then passed inside the full 100-test run. Stale `--no-build`
assembly + parallel DB contention.

---

## 7. Findings NOT fixed — founder decisions, deliberately left open

**7.1 — `"vine"` is silently dropped by `MapContractUnit`.**
`LabourWageModel` (the piece-rate normalizer) documents and writes
`labour[].contractUnit = "vine" | "row"` (`LabourWageModel.cs:30, 148-154`).
`MapContractUnit` knows `tree/acre/row/lump sum` — **`"vine"` falls through to `null`**
(`LabourAssignmentFactory.cs:152-159`). So a per-झाड piece-rate job loses its unit on the
way into the DB. `झाड` is literally `ContractUnit.Tree`, so the fix is one map entry.

Not applied here because it changes what is **WRITTEN**, not how it is read — a different
risk class from this task's read-side correction, and outside "smallest correction to the
discriminator". Its urgency is also reduced by this change: such a transcript carries
उक्त/ठेका, which drives the model to `type: CONTRACT`, and `IsUkte` now catches that.
The normalizers are also flag-OFF in prod, so this has never run for a farmer.
**Founder call: fix the map entry, or leave it.**

**7.2 — the prompt has no lump-sum instruction at all.**
`labour.v1.md` teaches exactly one contract shape ("2 acre"). Nothing anywhere teaches
`"ठरलं ₹१५,००० ला"` → `type: CONTRACT` (or `contractUnit: "Lump Sum"`). After this change
the read side is correct **whenever the model emits CONTRACT**; whether it reliably does
so for a spoken fixed price is a prompt question, and touching the prompt means a version
bump + golden-set delta. **Recommend a follow-up prompt task, not a closure edit.**

**7.3 — `LabourEngagementType.Self` falls into the रोजंदारी bucket.**
Family/own labour is neither an उक्ते agreement nor day-rate work anyone is obligated to
pay for. A `Self` engagement carrying a stated `TotalCost` therefore lands on the
रोजंदारी money card today, and still does. The founder's model is binary here and has no
third home; inventing one is out of scope. **Flagged for the naming/Contract-V1 session.**

---

## 8. Vocabulary fence

No farmer-facing string was touched. No internal name was renamed. `IsUkte` is a private
server-side predicate; `LabourAssignment`, `ContractUnit`, `LabourEngagementType` and
every namespace stay exactly as they were, per the founder's terminology direction.
