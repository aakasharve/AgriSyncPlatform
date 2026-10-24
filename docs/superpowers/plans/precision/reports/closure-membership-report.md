# Closure — the Labour/हजेरी read boundary across membership states

spec: 2026-08-28-labour-v2-release-1 · branch `feat/labour-v2-r1` · worktree HEAD at start `7219974d`

**Verdict: I changed NO behaviour. I proved the boundary and stopped at the blast-radius rule.**

The founder's expectation is NOT met today, the fix is NOT labour-local, and the smallest
centrally-owned fix would change eight other feature areas plus the RLS layer. Per the task's
rule 5 that is a founder call, not a gate-time change. What landed is one new
`RequiresPostgres` suite that pins all six statuses as a tripwire.

---

## 1. The read path, and what each of the six statuses gets today

Three gates sit between a caller and the हजेरी register. **All three filter on
_non-terminal_ (`status NOT IN (5, 6)`), none filters on _operationally active_.**

| # | Layer | File:line | Predicate |
|---|---|---|---|
| 1 | HTTP endpoint | `src/apps/ShramSafal/ShramSafal.Api/Endpoints/LabourEndpoints.cs:55-80` → `ICallerFarmTenantScope.EstablishForCallerAsync` | — |
| 1a | the gate itself | `src/apps/ShramSafal/ShramSafal.Infrastructure/Auth/CallerFarmTenantScope.cs:99-108` | `!isMember` → `Forbidden`, before any `agrisync.farm_id` GUC is set |
| 1b | its membership read | `src/apps/ShramSafal/ShramSafal.Infrastructure/Persistence/Repositories/ShramSafalRepository.cs:1165-1173` (declared-owner shortcut) and `:1183-1195` (raw SQL `status NOT IN (5, 6)`) | non-terminal |
| 2 | RLS | `Migrations/20260606074635_AddUserScopedFarmReadPolicies.cs:59-70` (`p_user_select_farms`), `20260607120000_AddUserScopedDataReadPolicies.cs:88-103` (plots / crop_cycles / daily_logs / cost_entries / attachments), `20260629064530_AddLabourAssignmentsTable.cs:56-71` (`p_user_select_labour_assignments`) | `m.status NOT IN (5, 6)` |
| 3 | handler | `src/apps/ShramSafal/ShramSafal.Application/UseCases/Labour/GetLabourData/GetLabourDataHandler.cs:173-178` → `ShramSafalRepository.GetUserRoleForFarmAsync` `:78-98` (owner shortcut `:82-89`, membership filter `:91-95`) | non-terminal |
| 3a | which view he then gets | `GetLabourDataHandler.cs:1029-1033` `ResolveRegisterView` | **role only — status is never consulted** |

### Measured, not read — one Mukadam per status, same farm, same role

Evidence from `Four_of_the_six_membership_statuses_currently_pass_the_labour_read_gate`,
executed as `agrisync_app` (`rolsuper OR rolbypassrls = False`) against a fresh scratch database:

```
status 1 PendingOtpClaim  endpointGate=True  role=Mukadam  read=True  view=crew
status 2 PendingApproval  endpointGate=True  role=Mukadam  read=True  view=crew
status 3 Active           endpointGate=True  role=Mukadam  read=True  view=crew
status 4 Suspended        endpointGate=True  role=Mukadam  read=True  view=crew
status 5 Revoked          endpointGate=False role=<null>   read=False view=ShramSafal.Forbidden
status 6 Exited           endpointGate=False role=<null>   read=False view=ShramSafal.Forbidden
```

And the RLS half agrees, read below the application entirely
(`The_user_scoped_RLS_policies_admit_the_same_four_statuses`):

```
status 1 PendingOtpClaim  ssf.farms rows visible = 1
status 2 PendingApproval  ssf.farms rows visible = 1
status 3 Active           ssf.farms rows visible = 1
status 4 Suspended        ssf.farms rows visible = 1
status 5 Revoked          ssf.farms rows visible = 0
status 6 Exited           ssf.farms rows visible = 0
```

**Against the founder's expectation:**

| Status | Expected | Actual | Match |
|---|---|---|---|
| `Active` (3) | normal role/view rules | `crew` view, normal rules | ✅ |
| `PendingOtpClaim` (1) | no operational access | full हजेरी register | ❌ |
| `PendingApproval` (2) | no operational access | full हजेरी register | ❌ |
| `Suspended` (4) | no operational access | full हजेरी register | ❌ |
| `Revoked` (5) | no operational access | 403 `ShramSafal.Forbidden` | ✅ |
| `Exited` (6) | no operational access | 403 `ShramSafal.Forbidden` | ✅ |

Task 4.2's reading was **correct**, and it understates the case in two ways:

- **A SUSPENDED co-owner gets the whole wage book.** `ResolveRegisterView`
  (`GetLabourDataHandler.cs:1029-1033`) switches on role and never on status, so a
  `SecondaryOwner` at `Suspended` receives `LabourRegisterView.OwnerBook` — money roster,
  ledger and review inbox included. Suspension currently withholds **nothing**.
  Proof: `A_suspended_secondary_owner_currently_receives_the_whole_wage_book` →
  `gate=True role=SecondaryOwner view=owner`.
- **Revoking the declared owner's membership row removes nothing.** The
  `ssf.farms.owner_user_id` shortcut runs *before* the membership read and is status-blind at
  all three layers (`ShramSafalRepository.cs:82-89`, `:1165-1173`, and the
  `f.owner_user_id = …` arm of every user-scoped policy). Proof:
  `Revoking_the_declared_owners_membership_row_currently_removes_no_labour_access` →
  `gate=True role=PrimaryOwner view=owner`. This is a deliberate fallback for seeded farms
  (the code says so), but it must be *decided*, not inherited by omission.

---

## 2. Is there a central membership rule that should own this?

**No — none exists, and nothing is failing to use one.**

Searched the whole tree for an "is this membership operationally active" predicate/policy —
`Farms`/`Memberships` domain, the enforcers, extension methods, the ports. What exists:

| Candidate | Where | Why it is not the central rule |
|---|---|---|
| `FarmMembership.IsActive` | `src/apps/ShramSafal/ShramSafal.Domain/Farms/FarmMembership.cs:117` | **Zero production callers.** It is also EF-`Ignore`d — `FarmMembershipConfiguration.cs:62` — so it cannot be used in a query at all. It is a dead accessor, not a policy. |
| `FarmMembership.IsTerminal` / `.IsRevoked` | `FarmMembership.cs:114-120` | These *are* the non-terminal rule — the very predicate under review. They answer "is this row dead", not "may this person operate". |
| `LabourManagementPermission` | `src/apps/ShramSafal/ShramSafal.Domain/Farms/LabourManagementPermission.cs:52-116` | The one genuinely central rule in this area — but it answers **who may rewrite labour truth** (role + explicit grant). It takes an `AppRole?` and never sees a status. Feeding it the status would change its meaning. |
| `LabourManagementGate` | `src/apps/ShramSafal/ShramSafal.Application/Services/LabourManagementGate.cs:59-85` | The DB resolution of the above. Inherits the status question from `GetUserRoleForFarmAsync`; does not answer it. |

The **de-facto** central rule is `ShramSafalRepository.GetUserRoleForFarmAsync`
(`:78-98`) plus its six sibling filters. It is central by *usage*, not by design — the
predicate is copy-pasted, not owned:

`ShramSafalRepository.cs` `:72-75` `GetFarmMembershipAsync` · `:91-95` `GetUserRoleForFarmAsync` ·
`:1008` `GetFarmIdsForUserAsync` · `:1039` `GetMyFarmsAsync` · `:1144-1151` `IsUserMemberOfFarmAsync` ·
`:1189` `GetFarmMembershipForTenantAsync` (raw SQL) · `:1733-1736` `GetLabourManagementGrantAsync` ·
`:1754-1756` `GetTrackedFarmMembershipAsync` — plus the SQL twin in every RLS policy.

So the finding is **not** "labour forgot to call the central rule". It is
**"no central rule exists, and seven copies of a weaker one are load-bearing"**.

### One documentation defect found on the way

`ShramSafalRepository.cs:1181-1182` states:

```
// Status enum: 0=PendingOtpClaim, 1=PendingApproval, 2=Active,
// 3=Suspended, 5=Revoked, 6=Exited (see MembershipStatus enum).
```

`MembershipStatus.cs:15-20` is `1..6`, not `0..3,5,6`. The SQL below it (`status NOT IN (5, 6)`)
is **correct**; only the comment is wrong, and it is wrong in the direction that would mislead
the next person writing a status predicate here. Left as-is deliberately — see §4; a comment fix
belongs with the decision, not scattered ahead of it.

---

## 3. Blast radius — why I stopped instead of shipping the fix

The smallest centrally-owned fix is a predicate that `GetUserRoleForFarmAsync` and its six
siblings all call. **Changing that predicate to "Active only" changes eight feature areas and
the RLS layer, not labour.**

### Callers of `GetUserRoleForFarmAsync` that change behaviour (20 sites, non-labour in bold)

| Area | Call sites |
|---|---|
| **Farm setup** | `CreatePlotAuthorizer.cs:51`, `CreatePlotHandler.cs:59` |
| **Finance** | `CorrectCostEntryHandler.cs:47` |
| **Logs** | `CreateDailyLogHandler.cs:482` (creator role stamped on every new log), `AddLogTaskHandler.cs:217`, `VerifyLogHandler.cs:71`, `LogsEndpoints.cs:205` |
| **Planning** | `AddLocalPlannedActivityAuthorizer.cs:50` / `Handler.cs:50`, `OverridePlannedActivityAuthorizer.cs:71` / `Handler.cs:53`, `RemovePlannedActivityAuthorizer.cs:65` / `Handler.cs:53` |
| **Work / JobCards** | `AssignJobCardAuthorizer.cs:61` / `Handler.cs:31`, `CancelJobCardHandler.cs:47`, `CreateJobCardAuthorizer.cs:57` / `Handler.cs:39`, `SettleJobCardPayoutAuthorizer.cs:55` / `Handler.cs:54`, `VerifyJobCardForPayoutAuthorizer.cs:70` / `Handler.cs:40` |
| **Entitlements / billing** | `DefaultEntitlementPolicy.cs:51` |
| **Historical data backfill** | `BackfillOwnerAttestationsHandler.cs:111` — this decides which *already-written* logs receive an owner attestation. A predicate change here rewrites a backfill's answer about the past. |
| Labour (in scope) | `GetLabourDataHandler.cs:173`, `GetFieldOperatorsHandler.cs:43`, `LabourManagementGate.cs:73`, `GetLabourPermissionsHandler.cs:46`, `SetLabourPermissionHandler.cs:99` |

Plus `IsUserOwnerOfFarmAsync` (`:103`, wraps it) → `ShramSafalAuthorizationEnforcer.EnsureIsOwner`.

### The two that would break something the founder would not expect

1. **`GetMyFarmsAsync` (`:1039`) is the farm switcher.** `PendingOtpClaim` and `PendingApproval`
   exist *precisely* so a person who has scanned the QR is in a waiting state. If the shared
   predicate becomes Active-only, they stop seeing the farm at all — the "waiting for the owner
   to approve" state would have no farm to render, and the QR/OTP onboarding flow that creates
   those statuses (`FarmMembership.CreateFromInvitation`, `FarmMembership.cs:168-185`) would be
   the thing the fix breaks. Multi-farm-per-login is a CORE use case.
2. **`GetFarmMembershipForTenantAsync` (`:1183-1195`) is `CallerFarmTenantScope`'s only gate**,
   and that scope is the sole authorization gate for **every** farm-scoped endpoint, not just
   labour: `/ai/voice-parse`, `/ai/receipt-extract`, `/ai/patti-extract`, `/ai/cove-reverify`,
   `/ai/document-sessions/*`, `/farms/{id}/labour/field-operators*`. A Suspended member would
   lose voice logging in the same commit.

### And a fix in C# alone would be a half-fix

The RLS policies carry their own copy of `status NOT IN (5, 6)` across `farms`, `plots`,
`crop_cycles`, `daily_logs`, `cost_entries`, `attachments`, `verification_events`,
`finance_corrections`, `labour_assignments`, `farm_operations`, `application_input_items`,
`event_links`, `irrigation_entries`, `machinery_usages` — i.e. the whole sync-pull surface.
The `The_user_scoped_RLS_policies_admit_the_same_four_statuses` fact exists to make that
concrete: **a central predicate applied only in C# would not move those numbers.**

**Therefore: STOP, per rule 5.** A correct-but-wide change at the founder gate needs his word.

### The real question for the founder (not the obvious one)

Not "should a Suspended member read हजेरी" — doctrine already says no. The buried question is:

> **Do `PendingOtpClaim` / `PendingApproval` / `Suspended` lose *everything*, or only the
> operational surfaces?** A person mid-onboarding must still see the farm he is waiting to
> join, or the waiting screen has nothing to show. That is one predicate ("may this membership
> be *seen*") versus a second one ("may this membership *operate*") — two rules, not one, and
> which surfaces sit on which side is a product call.

Recommended shape if he wants it (NOT applied): add **two** predicates on the domain type —
`IsVisible` (non-terminal, the status quo, keeps onboarding and the farm switcher whole) and
`IsOperational` (`Active` only) — then move call sites over one feature area at a time, RLS
included, each with its own proof. That is a plan, not a gate-time edit.

---

## 4. What I changed

**Behaviour: nothing.** One new test file, no production file touched.

- **Added** `src/tests/ShramSafal.Sync.IntegrationTests/Labour/LabourReadMembershipStatusRealPostgresTests.cs`
  — `[Trait("Category","RequiresPostgres")]`, fresh scratch DB per class, doctrine-E3 vacuity
  guard on every fact, driving the **real** `ICallerFarmTenantScope` and the **real**
  `GetLabourDataHandler` over the `agrisync_app` connection so RLS is in the path.

  The assertions are worded as **"CURRENT behaviour, under review"** and the class summary says
  so at the top: this is a **characterization tripwire, not a blessing**. The moment a central
  predicate lands and the labour read is wired to it, the suite goes red — which is the point.
  It must be updated deliberately with the decision, never deleted, and never weakened into
  "any non-terminal status may read", which is the claim under review.

  One harness note carried in the file: `20260515090000_BootstrapDbRoles` grants `agrisync_app`
  only on schema `ssf`, but the labour read also touches `public.users`
  (`ShramSafalRepository.GetOperatorsByIdsAsync`, `:1103`). That grant is provisioned outside
  the migration chain on real environments, so the suite grants it on its scratch DB —
  otherwise a scratch DB fails `42501` on a path that works in production and the suite would
  prove the wrong thing.

- **Not** changed: `MembershipStatus`, `FarmMembership`, `ShramSafalRepository`,
  `CallerFarmTenantScope`, `GetLabourDataHandler`, any RLS policy, any migration.
- **Not** created: any हजेरी-only privacy workaround. The founder explicitly ruled that out and
  it would have been the wrong shape anyway — the leak is three layers deep and shared.

---

## 5. Gate

| Check | Result |
|---|---|
| Six-status suite (`LabourReadMembershipStatusRealPostgresTests`) | **5 / 5 passed** — evidence lines in §1 |
| `ShramSafal.Domain.Tests` full | **Passed — 2005 passed, 0 failed, 1 skipped (2006 total), 12 s** |
| `AgriSync.ArchitectureTests` full | **Passed — 107 passed, 0 failed, 14 s** |
| RealPostgres labour suite (`Category=RequiresPostgres & FullyQualifiedName~Labour`) on :5433 | **Passed — 76 passed, 0 failed, 4 m 50 s** |

Environment note (not a product finding): the machine's `REQUIRES_POSTGRES_ROOT_CONN` and
`AGRISYNC_TEST_APP_ROLE_PASSWORD` env vars both carry **pre-rotation** passwords and fail
`28P01`. Per `local-test-db-28p01-credential-resolution`, the live values were derived from
`src/AgriSync.Bootstrapper/secrets/local/credentials.json` for this run. The env vars were
**not** rewritten — any agent running `RequiresPostgres` on this box must derive them the same
way, or every such suite fails at `InitializeAsync` for a reason that has nothing to do with
the code.

Baselines respected: `Category=RequiresDocker` excluded (by design, repo-wide); the dev API on
:5048 untouched; no `--no-verify`; no amend.
