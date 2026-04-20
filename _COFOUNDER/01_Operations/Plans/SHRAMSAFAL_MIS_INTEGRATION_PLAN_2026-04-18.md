---
type: plan
status: backend-complete-frontend-pending
owner: claude
ide: Both
created: 2026-04-18
updated: 2026-04-20
phase_current: 5
phases_total: 9
tags: [plan, mis, analytics, instrumentation, schedule-tracking, behavior, yc-metrics]
supersedes: SHRAMSAFAL_PHASE_8_5_INSTRUMENTATION_MIS_EXTENSION_2026-04-18.md
depends_on:
  - SHRAMSAFAL_MULTIUSER_MULTITENANT_ARCHITECTURE_SPEC_2026-04-18.md
  - SHRAMSAFAL_MULTIUSER_MULTITENANT_IMPLEMENTATION_PLAN_2026-04-18.md

## Progress Tracker (updated 2026-04-20)

| Phase | Status | Commit | Notes |
|---|---|---|---|
| Phase 1 — AnalyticsEvent Foundation | ✅ DONE | ddb55ee | AnalyticsEvent, IAnalyticsWriter, analytics schema, AnalyticsDbContext |
| Phase 2 — Handler Emission | ✅ DONE | ddb55ee | All 15 handlers + AI handlers emit analytics; arch test green |
| Phase 3 — Schedule Domain (backend 3.1–3.9) | ✅ DONE | cf1c5fc | Domain, migrations, Adopt/Migrate/Abandon/Complete handlers, endpoints, seeds |
| Task 3.10 / Phase 8 — Schedule Frontend | ⬜ PENDING | — | Blocking schedule picker, compliance badges, migration sheet (Stitch-first) |
| Phase 4 — MIS Schema Rollups | ✅ DONE | cf1c5fc | Phase4_MisSchemaRollups migration + MisRefreshJob nightly job |
| Phase 5 — Metabase + Founder Dashboard | ✅ DONE | bbd853b | docker-compose.mis.yml + 12-card founder.json + CI dashboard validator |
| Phase 6 — Owner MIS | ✅ DONE (backend) | a508191 | MisRead PaidFeature + GetFarmWeekMisHandler + GET /reports/farm-week/{farmId}; frontend: pending Stitch-first |
| Phase 7 — Behavioral Analytics + Alerts | ✅ DONE | 818d0a7 | 12 new mis.* views (feature lift, cohort quality, activity heatmap, R1-R8 red-flags) + AlertDispatcherJob |
| Phase 9 — Hygiene + Docs + CI Gates | ✅ DONE | see below | MIS_QUERY_CONTRACT + MIS_RUNBOOK + MIS_METRIC_DICTIONARY written |
---

# ShramSafal — MIS Integration Plan (2026-04-18)

> **Standalone plan.** Previously scoped as "Phase 8.5 extension" to the multi-tenant plan. Promoted to its own plan because MIS crosses every bounded context (User, Accounts, ShramSafal) and introduces a new first-class domain — **Crop Schedule & Migration Tracking** — that is too big to sit as a sub-phase.
>
> **Execution protocol:** Co-Founder OS v2.0 PRAR cycle (`_COFOUNDER/01_Operations/Protocols/EXECUTION_MODES.md`). Every phase below is PLAN → EXECUTE → VERIFY, with `dotnet build && dotnet test` + frontend `tsc --noEmit` as the VERIFY gate.
>
> **Required skills:**
> - `superpowers:executing-plans` for per-task checkbox discipline
> - `superpowers:test-driven-development` — every handler change lands a failing test first
> - `superpowers:subagent-driven-development` for the cross-cutting Phase 2 (many handlers in parallel)
> - `engineering:system-design` for the Schedule domain in Phase 3
>
> **Who this plan is for:** anyone (Claude / Codex / Gemini) implementing the observability spine of ShramSafal so the platform can be **operated like a YC-funded consumer SaaS** — measured, cohorted, and steered by behavior rather than vibes.

---

## Section 0 — TL;DR and why this plan exists separately

**The one-line version:** Build the truth-stream that lets us answer *"is the farmer forming a habit, is the owner verifying, is the schedule being followed, and is one happy farmer producing another?"* — per farm, per week, cheaply, with no PMF pretending.

**Why standalone (not an extension of the multi-tenant plan):**

1. **Scope** — it crosses `User`, `Accounts`, `ShramSafal` and introduces a new domain (`Schedule`) that needs its own entities, invariants, migrations, and handlers. Trying to bolt that onto the multi-tenant plan bloats review cycles.
2. **Sequencing** — MIS **rides alongside** multi-tenant, but individual phases are independently shippable. Phase 1 (AnalyticsEvent) can ship before Accounts lands. Phase 3 (Schedule) can ship before Phase 5 (Subscription) lands. Conversely, the multi-tenant plan ships with or without this plan.
3. **Audience** — this plan is read more by product/growth than the multi-tenant plan is. Splitting them means founders can read this end-to-end without wading through tenant architecture.
4. **Evolution velocity** — dashboard metrics evolve weekly. Domain contracts evolve quarterly. Co-locating them in one plan drags both to the slower cadence. Separation lets MIS move fast without destabilising the architectural spec.

**What's inside:**

- **Section 1** — The YC-grade metric hierarchy (Tier 0 North Star → Tier 3 behavioral)
- **Section 2** — The Schedule & Migration domain (new invariants, entities, compliance math)
- **Section 3** — Instrumentation contract (the one line every handler grows)
- **Section 4** — MIS data architecture (analytics schema + mis schema + refresh)
- **Section 5** — Three-audience dashboards (founder / owner / technical)
- **Section 6** — Behavioral analytics layer (feature-retention matrix, cohorts, silent churn)
- **Section 7** — Red-flag detectors (automated anti-PMF alerts)
- **Section 8** — Build sequencing: 9 phases, each with files, tests, commits, VERIFY gate
- **Section 9** — Explicit non-goals + dependencies + open questions

**North Star (Tier 0):** Weekly Verified Farm-Days per Farm (WVFD/farm). See §1.

---

## Section 1 — The YC-Grade Metric Hierarchy (LOCKED)

We operate the business against a four-tier metric stack. Anything not in these tiers is vanity — do not build a dashboard for it.

### 1.0 The four evaluation pillars

A YC partner evaluating this business asks four questions, and every tier below rolls up to one of them:

| Pillar | Question | Primary tier coverage |
|---|---|---|
| **Habit** | Is the farmer logging without being reminded? | Tier 0 (WVFD), Tier 1 (D30 retention) |
| **Trust** | Is the owner verifying what the operator logs? | Tier 0 (WVFD requires verify), Tier 1 (lag, correction rate) |
| **Depth** | Are they using the feature that changes behavior? | Tier 1 (schedule compliance, voice share), Tier 3 (feature-retention matrix) |
| **Virality** | Does one happy farmer produce another? | Tier 2 (K-factor decomposition), Tier 3 (cohort quality by channel) |

If a proposed metric does not strengthen one of these four pillars, reject it.

### 1.1 Tier 0 — North Star Metric (one, non-negotiable)

> **Weekly Verified Farm-Days per Farm (WVFD/farm)**
>
> For each farm in the rolling 7-day window, count the number of distinct days on which ≥1 `DailyLog` was submitted AND at least one log from that day was verified by the owner within 48 hours. Cap at 7.
>
> `NSM = avg(WVFD per active farm in window)`
>
> **Target:** ≥ 4.5/7 for paying farms. **Churn threshold:** < 3 for two consecutive weeks triggers win-back.

**Why this specific shape:**

- **"Farm-days", not "logs"** — 20 logs in one panic-catch-up day is not the same as 1 log/day for 7 days. Farm-days rewards habit, not volume.
- **"Verified within 48h"** — un-verified logs mean the owner isn't engaged, so the product loop is not closing.
- **"Per farm"** (ratio, not sum) — growth-marketing can inflate summed numbers by acquiring more farms. WVFD/farm cannot be faked by onboarding more users.
- **"Rolling 7-day"** — weekly cadence is the natural unit of farm rhythm. Daily is too noisy; monthly smooths over the churn signal.

**Failure modes this metric rejects:**

| Vanity metric | Why it lies | What WVFD catches instead |
|---|---|---|
| Total logs | One user logging 100× still equals "1 user still used it" | Caps at 7/farm/week |
| MAU | Includes users who opened-and-closed | Requires log + verify, real action |
| Verified logs | Can be rubber-stamped | Requires distinct days, not count |
| WAU | Doesn't measure *both* sides of the loop | Requires operator log + owner verify |

### 1.2 Tier 1 — Five Guardrails (weekly review, auto-alert on breach)

| Guardrail | Definition | Breach | Meaning of breach |
|---|---|---|---|
| **D30 retention (paying owners)** | % of paid owners logging in week 4 of their cohort | < 60% | Churn cliff at month-1 |
| **Log → Verify median lag** | Median hours between log creation and first verification | > 36h | Owner is disengaging |
| **Correction rate** | % of logs owner-edited after submit | > 15% | Operator is confused, or lying |
| **Schedule compliance** | % of prescribed schedule tasks done within ±2 day window (Section 2) | < 50% | Schedules feel fake to farmer |
| **Voice-log share** | % of logs with `source = voice` | < 40% | AI pipeline is not earning its cost |

Each guardrail has a Metabase card and a Phase 7 alert that fires to the founder's Slack/email within 24 hours of a weekly-window breach.

### 1.3 Tier 2 — Diagnostic Metrics (used when guardrails break)

#### 1.3.1 The Activation Funnel

Track drop-off between each pair, per cohort, per acquisition channel, per crop:

```
Signup                                 (target: 100% — baseline)
  ↓  (target: 80% in < 10 min)
First farm created
  ↓  (target: 70% in < 1 hr)
First log submitted                    ← aha-moment 1
  ↓  (target: 50% in < 24 hr)
First owner verification               ← aha-moment 2 (the real one)
  ↓  (target: 40% in < 7 days)
3rd verified log                       ← habit lock
  ↓  (target: 30% in < 14 days)
First schedule adopted                 ← depth lock
  ↓  (target: 20% in < 21 days)
Trial → Paid conversion
  ↓  (target: 12% of all signups)
D30 retained paid
```

Materialised as `mis.activation_funnel` with columns `step_name, cohort_week, channel, crop_primary, count, median_hours_from_prev_step`.

#### 1.3.2 Engagement Depth Tiers

Every farm, every week, gets bucketed:

| Tier | WVFD | Voice share | Schedule compliance | Multi-operator | Action |
|---|---|---|---|---|---|
| **A — Power** | ≥ 5 | > 60% | > 70% | 2+ | Study them. They're your ICP. |
| **B — Core** | 3–5 | 30–60% | 50–70% | ≥ 1 | Nurture — they're about to be A |
| **C — Casual** | 1–3 | Any | < 50% | Any | Habit-building nudges |
| **D — At-risk** | < 1 for 2 weeks | Any | Any | Any | Auto-trigger win-back within 24h |

**PMF signal:** ≥ 25% of paying farms in Tier A within 90 days of signup.

#### 1.3.3 Cohort Retention Curves (the chart YC always asks for)

For every signup cohort (weekly bucket), plot D1 / D7 / D14 / D30 / D60 / D90 retention, split by:
- Acquisition channel (QR-referral, WhatsApp-share, marketing-site, direct)
- Crop (grapes vs onion vs sugarcane — expected cadences differ)
- Farm size (acreage tier)
- Plan tier (trial, paid-basic, paid-pro)

**Shape classifier:**
- **Smiling curve** (bounces back after dip) = strong PMF
- **Flat curve** (plateaus) = PMF
- **Smooth decay** (D7 50%, D30 15%, D60 5%) = no habit, novelty effect
- **Cliff** (sharp drop at a specific day) = something breaks there — investigate

### 1.4 Tier 3 — Behavioral Metrics (product-direction fuel, quarterly review)

#### 1.4.1 Feature-Retention Correlation Matrix

For every major feature `F`, compute:
`lift(F) = D30_retention(users who used F in week 1) − D30_retention(users who did not)`

Sort features by `lift`. The top feature **should define onboarding**. Sample expected output:

| Feature | D30 lift | Interpretation |
|---|---|---|
| Schedule adoption | +31 pts | Force this in onboarding |
| Voice log | +22 pts | Push in first session |
| Receipt OCR | +18 pts | Push on first cost entry |
| Cost entry | +15 pts | Essential depth feature |
| Multi-operator setup | +12 pts | Mid-funnel nudge |
| Batch verify | +8 pts | Owner-specific tutorial |
| Attachments | +3 pts | Not a retention driver — don't prioritize |

Shipped as `mis.feature_retention_lift` with a weekly refresh. Product decisions ("should we invest in feature X?") must reference this view.

#### 1.4.2 Cohort Quality Score (CQS) by channel

`CQS = 0.4 × D30_retention + 0.3 × avg_WVFD + 0.2 × paid_conversion + 0.1 × referral_rate`

Compare cohorts by acquisition channel. **Spend proportionally to CQS, not volume.** Most founders over-invest in high-volume channels — CQS surfaces which channel brings farms that stick, not farms that arrive.

#### 1.4.3 First-7-Days Microscope

For each newly-signed-up farm, capture a per-day snapshot of their actions (farms created, plots created, logs count, schedule adopted Y/N, voice tried Y/N, invite sent Y/N). Cluster trajectories. The trajectory of **retained** farms becomes your onboarding script.

#### 1.4.4 Silent Churn Detector

Paid farms with WVFD = 0 for ≥ 2 consecutive weeks but still paying. **These are the single highest-value intervention targets** — call them before they cancel. Shipped as `mis.silent_churn_watchlist` with a Friday alert.

#### 1.4.5 Negative-space Metrics (what they *don't* do)

- % of farms with zero cost entries after 14 days → finance feature isn't real to them
- % of owners who never open MIS dashboard → the monetization hook is invisible
- % of logs with no attachment → photos are unnecessary *or* too hard

These surface features to **kill**, not grow.

#### 1.4.6 Time-of-Day × Day-of-Week Heatmap

When are farmers actually opening the app? Drives reminder timing. Shipped as `mis.activity_heatmap`.

#### 1.4.7 K-factor Decomposition (post Phase 7 affiliation)

`K = invites_sent_per_user × accept_rate × activation_rate_of_invited`

Track each term separately so you know which lever to pull.

---

## Section 2 — Crop Schedule & Migration Tracking (NEW FIRST-CLASS DOMAIN)

This is the single most strategically-important addition in this plan. Schedules are the **expert-knowledge layer** of the product — they turn a log-book into an agri-advisor. Compliance rate = trust. Trust = monetizable subscription. So schedule tracking gets treated as a domain, not a metric.

### 2.1 Core concept

A farm, per plot × crop × cycle, adopts **exactly one active `CropScheduleTemplate`** at a time. The template prescribes a list of tasks with due-day-offsets (e.g., "Day 14 from transplant: first fertigation"). Each `DailyLog` or `LogTask` is matched at write-time against the active schedule, producing a **delta** (early / on-time / late / missed / unscheduled). Aggregated over time, this gives us compliance.

If the farmer decides a different schedule fits better (switches from "North Maharashtra Grape Standard" to "Organic Grape Nashik"), that is a **Schedule Migration Event** — an immutable log with before/after compliance snapshots.

### 2.2 Why one-at-a-time is architecturally correct

The constraint "one active schedule per plot × crop × cycle" is not a limitation — it's a simplification that makes the rest tractable:

- **Delta math has exactly one answer** — no merge conflicts between schedules
- **Migration is a clean transition** — old → Migrated state, new → Active state, in one transaction
- **Compliance history is a single time-series per subscription** — easy to chart
- **Accountability is unambiguous** — farmer can't hide behind "well I was following Schedule B at that moment"

### 2.3 Invariants (extend the main spec's I-1..I-13)

> **Invariant I-14:** At most one `ScheduleSubscription` in state `Active` per `(plotId, cropId, cropCycleId)`. Enforced by a PostgreSQL partial unique index: `CREATE UNIQUE INDEX ux_sched_sub_active ON ssf.schedule_subscriptions (plot_id, crop_id, crop_cycle_id) WHERE state = 'Active';`

> **Invariant I-15:** Adopting a new schedule for a `(plot, crop, cycle)` that already has an Active subscription MUST transition the prior subscription to `Migrated` and write a `ScheduleMigrationEvent` in the same DB transaction. Not a two-step process. Not a compensating saga.

> **Invariant I-16:** `ScheduleMigrationEvent` is append-only. No UPDATE, no DELETE, enforced at DB layer (rule `sched_mig_no_update/no_delete`). This is a trust record, not a convenience log.

> **Invariant I-17:** `ComplianceResult` stamped on a `DailyLog` at write-time is immutable — even if the farmer later migrates schedules, the original delta stays. Otherwise migration would retroactively rewrite compliance history.

### 2.4 Entities

All new entities live in `ShramSafal.Domain.Schedules.*`.

```csharp
// Catalog — server-owned, versioned, immutable after publish
public sealed class CropScheduleTemplate : Entity<ScheduleTemplateId>
{
    public CropId CropId { get; }
    public RegionId? RegionId { get; }            // null = universal
    public string Name { get; }                    // "North Maharashtra Grape Standard"
    public string VersionTag { get; }              // "v1.2" — increments bump
    public bool IsPublished { get; }
    public DateTime CreatedAtUtc { get; }
    public IReadOnlyList<PrescribedTask> Tasks { get; }
    // Tasks reference a cropstage + day-offset from cycle start
}

public sealed record PrescribedTask(
    PrescribedTaskId Id,
    TaskTypeCode TaskType,        // "spray", "fertigation", "pruning", etc.
    CropStage Stage,
    int DayOffsetFromCycleStart,
    int ToleranceDaysPlusMinus,   // default 2
    string Notes);

// Per plot-crop-cycle: exactly one Active at a time (I-14)
public sealed class ScheduleSubscription : Entity<ScheduleSubscriptionId>
{
    public FarmId FarmId { get; }
    public PlotId PlotId { get; }
    public CropId CropId { get; }
    public CropCycleId CropCycleId { get; }
    public ScheduleTemplateId ScheduleTemplateId { get; }
    public string ScheduleVersionTag { get; }     // snapshotted at adopt-time
    public DateTime AdoptedAtUtc { get; }
    public ScheduleSubscriptionState State { get; } // Active | Migrated | Abandoned | Completed
    public ScheduleSubscriptionId? MigratedFromSubscriptionId { get; }
    public ScheduleMigrationReason? MigrationReason { get; }
    public DateTime? StateChangedAtUtc { get; }

    public void Migrate(ScheduleSubscriptionId newSubscriptionId, ScheduleMigrationReason reason, DateTime utcNow);
    public void Abandon(DateTime utcNow);
    public void Complete(DateTime utcNow);
}

public enum ScheduleSubscriptionState { Active, Migrated, Abandoned, Completed }
public enum ScheduleMigrationReason { BetterFit, WeatherShift, SwitchedCropVariety, OwnerDirective, Other }

// Append-only audit of migrations (I-16)
public sealed class ScheduleMigrationEvent : Entity<Guid>
{
    public Guid EventId { get; }
    public ScheduleSubscriptionId PrevSubscriptionId { get; }
    public ScheduleSubscriptionId NewSubscriptionId { get; }
    public ScheduleTemplateId PrevScheduleId { get; }
    public ScheduleTemplateId NewScheduleId { get; }
    public FarmId FarmId { get; }
    public PlotId PlotId { get; }
    public CropCycleId CropCycleId { get; }
    public DateTime MigratedAtUtc { get; }
    public ScheduleMigrationReason Reason { get; }
    public string? ReasonText { get; }
    public decimal ComplianceAtMigrationPct { get; }  // snapshot of previous subscription
    public UserId ActorUserId { get; }
}

// Immutable stamp on each log (I-17)
public sealed record ComplianceResult(
    ScheduleSubscriptionId? SubscriptionId,
    PrescribedTaskId? MatchedTaskId,
    int? DeltaDays,                     // null if Unscheduled
    ComplianceOutcome Outcome);

public enum ComplianceOutcome { Early, OnTime, Late, Unscheduled }
// "Missed" is not per-log — it's computed at snapshot time for prescribed tasks that never got a matching log

// Nightly rollup (computed, not written by application code)
public sealed record ScheduleComplianceSnapshot(
    ScheduleSubscriptionId SubscriptionId,
    DateOnly WeekStartUtc,
    int PrescribedCount,
    int MatchedCount,
    int EarlyCount,
    int OnTimeCount,
    int LateCount,
    int MissedCount,
    int UnscheduledCount,
    int AbsDeltaDaysSum,
    decimal ComplianceScorePct);    // onTime / prescribed × 100
```

### 2.5 Delta computation (at write-time, not batch)

In `CreateDailyLogHandler` and `AddLogTaskHandler`, after the aggregate is saved:

1. **Lookup the active subscription** for `(plotId, cropId, cropCycleId)`. If none → stamp `ComplianceResult(Unscheduled)`.
2. **Find the closest prescribed task** matching this log's `TaskType` + `Stage`, within ±N days of log date (N = task's `ToleranceDaysPlusMinus` or 5 default).
3. If match found:
   - `deltaDays = logDate − prescribedDate`
   - Outcome: `Early` if `< -tolerance`, `OnTime` if `|delta| ≤ tolerance`, `Late` if `> +tolerance`
4. If no match → `Unscheduled`.
5. Stamp `ComplianceResult` onto the log in the same transaction.

**Why at write-time:**

- **Cheap** — one row lookup (`WHERE state='Active' AND plot_id=... AND crop_id=... AND cycle_id=...`) hits the unique index
- **Immediate feedback** — UI can show "you're 2 days late on spray" at verification time
- **Rollup stays additive** — nightly aggregator just `SUM()`s pre-stamped outcomes, no recomputation needed

### 2.6 Migration event semantics

When a farmer adopts a new schedule for a plot-crop-cycle that already has an Active subscription, the handler `MigrateScheduleSubscriptionHandler` runs this exact sequence in **one DB transaction**:

1. Load current `Active` subscription → assert invariant I-14 (exactly one)
2. Compute `complianceAtMigrationPct` from the last `ScheduleComplianceSnapshot` (or 0 if no snapshots yet)
3. Call `prev.Migrate(newSubscriptionId, reason, utcNow)` — transitions to `Migrated`
4. Insert new `ScheduleSubscription` with `State = Active`, `MigratedFromSubscriptionId = prev.Id`
5. Insert `ScheduleMigrationEvent` with both IDs + snapshot
6. Emit `AnalyticsEvent("schedule.migrated", props: { prevScheduleId, newScheduleId, complianceAtMigrationPct, reasonCode })`
7. Emit `AuditEvent` for the domain record
8. Commit

If any step fails, the whole thing rolls back and invariant I-14 is preserved.

### 2.7 Metrics the schedule domain emits

All materialised in `mis.schedule_*`. One view per metric:

| Metric | View | Decision it drives |
|---|---|---|
| Schedule Adoption Rate | `mis.schedule_adoption_rate` | < 50% → onboarding schedule picker is buried |
| Compliance Score (per plot-crop-week) | `mis.schedule_compliance_weekly` | < 50% → schedule wrong or farmer distrusts it |
| Delta Distribution (histogram of deltaDays) | `mis.schedule_delta_distribution` | Skewed late = aspirational schedule |
| Schedule Migration Rate | `mis.schedule_migration_rate` | > 15%/mo = catalog is wrong |
| Migration Compliance Lift | `mis.schedule_migration_lift` | Negative = farmer fled accountability |
| Abandonment Rate | `mis.schedule_abandonment_rate` | High = schedules feel like policing |
| Catalog Popularity | `mis.schedule_catalog_popularity` | Dominant schedule = new default |
| Unscheduled Work Ratio | `mis.schedule_unscheduled_ratio` | High = catalog too narrow, expand it |

### 2.8 Behavioral cohorts from migrations

Stored as tags on `ScheduleSubscription`, refreshed weekly:

| Cohort tag | Definition | Intervention |
|---|---|---|
| `compliance_seeker` | Migrated after < 40% compliance, achieved > 60% in 30 days post | Case study — new ICP proof point |
| `schedule_runaway` | Migrated from strict to lenient, compliance didn't improve | Churn risk — call them |
| `upgrader` | Migrated mid-cycle to premium/organic schedule | Upsell trigger |
| `thrasher` | ≥ 2 migrations in one cycle | Confused — assign success manager |
| `power_follower` | Compliance > 80% for 8+ consecutive weeks | Testimonial candidate + referral push |

### 2.9 UI-level contract for schedule

Frontend surfaces driven by the domain:

- **Schedule picker** at plot creation (or first-log-in-crop-cycle if skipped) — blocking modal with ≤ 3 options per crop
- **Compliance badge** on each plot card — green/amber/red based on last-week score
- **"You're X days late on Y"** nudge in the log flow when a prescribed task is overdue
- **Migration sheet** — explicit decision, requires selecting a `MigrationReason`
- **Owner MIS** shows the migration history as a timeline with compliance lift per segment

### 2.10 Out of scope (for this plan)

- Farmer-authored custom schedules — Phase 2 of a future plan. V1 is catalog-only.
- Multi-schedule overlay (e.g., a "pest control" schedule stacked on a "growth" schedule) — architectural complexity not justified for V1.
- ML-inferred "optimal schedule" recommendation — needs ≥ 3 seasons of data.

---

## Section 3 — The Instrumentation Contract

Every handler that mutates a first-class aggregate emits exactly **one** `AnalyticsEvent` at commit time. This is the rule that makes every later dashboard possible.

### 3.1 The `AnalyticsEvent` record

```csharp
// src/AgriSync.BuildingBlocks/Analytics/AnalyticsEvent.cs
public sealed record AnalyticsEvent(
    Guid EventId,
    string EventType,             // from AnalyticsEventType catalog, see §3.3
    DateTime OccurredAtUtc,
    UserId? ActorUserId,
    FarmId? FarmId,
    OwnerAccountId? OwnerAccountId,
    string ActorRole,             // "owner" | "operator" | "mukadam" | "worker" | "system"
    string Trigger,               // "voice" | "manual" | "photo" | "sync" | "schedule_prompt" | "system"
    DateTime? DeviceOccurredAtUtc,// set when sync-delayed — measures offline lag
    string SchemaVersion,         // "v1" — bump when props shape changes
    string PropsJson);            // typed payload, one shape per EventType
```

### 3.2 Why six things this pattern buys you for free

1. **Funnel reconstruction** — any funnel is a sequence of `EventType` per `ActorUserId`
2. **Attribution** — `Trigger` tells you which nudge caused which action
3. **Offline lag histogram** — `OccurredAtUtc − DeviceOccurredAtUtc` per event
4. **Persona separation** — `ActorRole` splits owner-loop from operator-loop trivially
5. **Tenant-safe partitioning** — `OwnerAccountId` partitions data for per-tenant MIS (Section 5) and founder view
6. **Schedule delta at source** — `Props.deltaDaysVsSchedule` for log events, computed inline

### 3.3 Event-type catalog (constants, not strings)

`src/AgriSync.BuildingBlocks/Analytics/AnalyticsEventType.cs`:

```csharp
public static class AnalyticsEventType
{
    // Identity
    public const string UserRegistered = "user.registered";
    public const string UserLoggedIn = "user.logged_in";
    public const string OtpSent = "otp.sent";
    public const string OtpVerified = "otp.verified";
    public const string OtpFailed = "otp.failed";

    // Farm + memberships
    public const string FarmCreated = "farm.created";
    public const string PlotCreated = "plot.created";
    public const string InvitationIssued = "invitation.issued";
    public const string InvitationClaimed = "invitation.claimed";
    public const string MembershipRevoked = "membership.revoked";

    // Logs + verification
    public const string LogCreated = "log.created";
    public const string LogVerified = "log.verified";
    public const string LogCorrected = "log.corrected";
    public const string LogDisputed = "log.disputed";
    public const string BatchVerified = "batch.verified";

    // Schedule (NEW — Section 2)
    public const string ScheduleAdopted = "schedule.adopted";
    public const string ScheduleMigrated = "schedule.migrated";
    public const string ScheduleAbandoned = "schedule.abandoned";
    public const string ScheduleCompleted = "schedule.completed";
    public const string SchedulePromptDismissed = "schedule.prompt_dismissed";

    // Finance
    public const string CostEntryAdded = "cost.entry.added";
    public const string CostEntryCorrected = "cost.entry.corrected";
    public const string GlobalExpenseAllocated = "finance.expense.allocated";

    // Subscription (post Phase 5)
    public const string SubscriptionStartedTrial = "subscription.trial_started";
    public const string SubscriptionActivated = "subscription.activated";
    public const string SubscriptionRenewed = "subscription.renewed";
    public const string SubscriptionPastDue = "subscription.past_due";
    public const string SubscriptionExpired = "subscription.expired";
    public const string SubscriptionCancelled = "subscription.cancelled";

    // Affiliation (post Phase 7)
    public const string ReferralCodeIssued = "referral.code_issued";
    public const string ReferralMatched = "referral.matched";
    public const string BenefitLedgerEntry = "benefit.ledger_entry";
    public const string BenefitRedeemed = "benefit.redeemed";

    // AI + technical
    public const string AiInvocation = "ai.invocation";
    public const string SyncPushed = "sync.pushed";
    public const string SyncPullCompleted = "sync.pull_completed";
    public const string SyncConflict = "sync.conflict";
}
```

**Architecture rule (enforced by test):** Any raw string matching `"[a-z_]+\.[a-z_]+"` in an `EmitAsync` call is a build failure. New event types MUST be added to the catalog.

### 3.4 The handler pattern

```csharp
public sealed class CreateDailyLogHandler(
    IShramSafalRepository repository,
    IIdGenerator idGenerator,
    IClock clock,
    IScheduleComplianceService scheduleCompliance,   // NEW — §2.5
    IAnalyticsWriter analytics,
    IAuthContext authContext)
{
    public async Task<Result<DailyLogDto>> HandleAsync(CreateDailyLogCommand command, CancellationToken ct)
    {
        // 1. Domain work
        var log = DailyLog.Create(...);
        var compliance = await scheduleCompliance.StampAsync(log, ct);  // §2.5
        repository.Add(log);
        await repository.SaveChangesAsync(ct);

        // 2. Analytics emit (failure-isolated — never breaks the domain write)
        await analytics.EmitAsync(new AnalyticsEvent(
            EventId: Guid.NewGuid(),
            EventType: AnalyticsEventType.LogCreated,
            OccurredAtUtc: clock.UtcNow,
            ActorUserId: authContext.UserId,
            FarmId: command.FarmId,
            OwnerAccountId: authContext.OwnerAccountId,
            ActorRole: authContext.ResolvedRole.ToString().ToLowerInvariant(),
            Trigger: command.Source ?? "manual",
            DeviceOccurredAtUtc: command.DeviceTimestamp,
            SchemaVersion: "v1",
            PropsJson: JsonSerializer.Serialize(new
            {
                logId = log.Id,
                plotId = command.PlotId,
                cropCycleId = command.CropCycleId,
                scheduleSubscriptionId = compliance.SubscriptionId,
                matchedTaskId = compliance.MatchedTaskId,
                deltaDaysVsSchedule = compliance.DeltaDays,
                complianceOutcome = compliance.Outcome.ToString().ToLowerInvariant()
            })
        ), ct);

        return Result.Success(log.ToDto());
    }
}
```

### 3.5 Failure isolation

**Analytics writes never break the domain write.** `AnalyticsWriter.EmitAsync` wraps the EF call in a try/catch that logs but swallows. Rationale: a telemetry table's availability must never be load-bearing for a farmer's log-submission UX.

### 3.6 Architecture test (ships with Phase 2)

`tests/AgriSync.ArchitectureTests/AnalyticsBoundaryTests.cs`:

- **Test 1:** Every class ending in `Handler` that calls `SaveChangesAsync` must also call `analytics.EmitAsync` in the same method. Reflection-driven, fails the build.
- **Test 2:** No raw string literal matching event-type regex in `EmitAsync` calls. Only `AnalyticsEventType.*` constants allowed.
- **Test 3:** `AnalyticsWriter` must not declare `throws` in its interface — failure-isolation is enforced at the type level.

---

## Section 4 — MIS Data Architecture

Two schemas. One rule: the app never writes to `mis`, only to `analytics`.

### 4.1 Schemas

| Schema | Purpose | Writer | Reader |
|---|---|---|---|
| `analytics` | Raw append-only event stream | Application handlers (via `IAnalyticsWriter`) | `mis` refresh job only |
| `mis` | Denormalised rollup views | `MisRefreshJob` (hosted service) | Dashboards, owner MIS endpoints |
| `ssf`, `public` | Domain state | Application handlers | Application queries |

### 4.2 The `analytics.events` table

```sql
CREATE SCHEMA IF NOT EXISTS analytics;

CREATE TABLE analytics.events (
    event_id              uuid        PRIMARY KEY,
    event_type            varchar(80) NOT NULL,
    occurred_at_utc       timestamptz NOT NULL,
    actor_user_id         uuid        NULL,
    farm_id               uuid        NULL,
    owner_account_id      uuid        NULL,
    actor_role            varchar(16) NOT NULL,
    trigger               varchar(24) NOT NULL,
    device_occurred_at_utc timestamptz NULL,
    schema_version        varchar(8)  NOT NULL DEFAULT 'v1',
    props                 jsonb       NOT NULL DEFAULT '{}'::jsonb
) PARTITION BY RANGE (occurred_at_utc);

-- Month-partitioned. Auto-create future partitions via pg_partman or a hosted job.

CREATE INDEX ix_analytics_events_type_time ON analytics.events (event_type, occurred_at_utc DESC);
CREATE INDEX ix_analytics_events_farm_time ON analytics.events (farm_id, occurred_at_utc DESC) WHERE farm_id IS NOT NULL;
CREATE INDEX ix_analytics_events_account_time ON analytics.events (owner_account_id, occurred_at_utc DESC) WHERE owner_account_id IS NOT NULL;
CREATE INDEX ix_analytics_events_actor_time ON analytics.events (actor_user_id, occurred_at_utc DESC) WHERE actor_user_id IS NOT NULL;

-- Append-only at DB layer
CREATE RULE analytics_events_no_update AS ON UPDATE TO analytics.events DO INSTEAD NOTHING;
CREATE RULE analytics_events_no_delete AS ON DELETE TO analytics.events DO INSTEAD NOTHING;
```

**Why partitioned:** At projected volume (5k farms × 50 events/day/farm = 250k/day = ~7.5M/month), unpartitioned tables become slow at 12+ months. Month-partitioning keeps rollup scans local to the current/prior partition.

### 4.3 The `mis` schema (materialised views + tables)

Populated by `MisRefreshJob` nightly. One view per metric. Refresh is `CONCURRENTLY` so dashboards never read half-built data.

See Section 8 Phase 4 for the full view catalog. Representative view:

```sql
CREATE MATERIALIZED VIEW mis.wvfd_weekly AS
WITH day_log AS (
    SELECT
        l.farm_id,
        DATE_TRUNC('day', l.created_at_utc) AS log_day,
        BOOL_OR(l.verification_status IN ('confirmed','verified')
                AND v.verified_at_utc <= l.created_at_utc + INTERVAL '48 hours') AS verified_within_48h
    FROM ssf.daily_logs l
    LEFT JOIN ssf.verifications v ON v.log_id = l.id
    WHERE l.created_at_utc >= NOW() - INTERVAL '8 days'
    GROUP BY l.farm_id, DATE_TRUNC('day', l.created_at_utc)
),
farm_week AS (
    SELECT
        farm_id,
        COUNT(*) FILTER (WHERE verified_within_48h) AS verified_farm_days
    FROM day_log
    WHERE log_day >= NOW() - INTERVAL '7 days'
    GROUP BY farm_id
)
SELECT
    farm_id,
    LEAST(verified_farm_days, 7) AS wvfd,
    CASE
        WHEN verified_farm_days >= 5 THEN 'A'
        WHEN verified_farm_days >= 3 THEN 'B'
        WHEN verified_farm_days >= 1 THEN 'C'
        ELSE 'D'
    END AS engagement_tier
FROM farm_week;

CREATE UNIQUE INDEX ux_mis_wvfd_farm ON mis.wvfd_weekly (farm_id);
```

### 4.4 Refresh job

`src/AgriSync.Bootstrapper/Jobs/MisRefreshJob.cs` — `BackgroundService`, runs `REFRESH MATERIALIZED VIEW CONCURRENTLY <v>` for every view in the `mis` schema. Default cron: `0 2 * * *` (02:00 UTC daily). Configurable via `Mis:RefreshCron`.

**Failure handling:** each view refreshes in its own `try/catch` — one view's failure doesn't halt the rest.

### 4.5 Why not Mixpanel / Amplitude / ClickHouse / BigQuery

- **Pricing** — per-event billing kills pre-PMF margins. Mixpanel at 10M events/mo = $600+/mo. Postgres materialised views = $0 extra.
- **Schema control** — our schema evolves with our domain. External tools fight this.
- **Tenant-safety** — owner MIS needs per-tenant filtering. Baking that into an external analytics tool is more work than one WHERE clause.
- **Appropriate scale** — we won't see 1M events/day until we're 20× our current size. At that point we can migrate to ClickHouse with a single ETL. Not before.

---

## Section 5 — Three-Audience Dashboards

One MIS surface per audience. Never mix audiences — different questions, different cadences.

### 5.1 Founder MIS (internal, operator of the business)

Metabase dashboard at `build/metabase/dashboards/founder.json`. Non-public.

**Cards (top to bottom, in review order):**

1. **WVFD weekly trendline** — the single most important chart in the business
2. **Engagement-tier distribution** (stacked bar, A/B/C/D, week by week)
3. **Activation funnel** with per-step drop-off
4. **Cohort retention curves** (D1/D7/D30/D60/D90 per weekly cohort, filter by channel/crop/plan)
5. **Schedule Migration Sankey** — flows from template A → template B with compliance lift per edge (see Section 2)
6. **Feature-retention correlation matrix** (Section 1.4.1)
7. **Cohort Quality Score by channel** (Section 1.4.2)
8. **Silent churn watchlist** — paid farms with WVFD = 0 for 2 weeks
9. **MRR + ARPU by plan** (post Phase 5)
10. **K-factor decomposition** (post Phase 7)
11. **Unit economics** — CAC, LTV, payback, gross margin/farm (Gemini + SMS + storage/farm)
12. **Anti-PMF red lights** — a row of 5 boolean tiles. Green when all thresholds are clean. Red is load-bearing.

### 5.2 Owner MIS (the paying customer — a product feature)

Lives at `/reports` in `src/clients/mobile-web`. **Subscription-gated.** Workers never see. Free-tier owners never see (drives the upgrade).

**Per-farm weekly surface:**

- Big WVFD banner (green if farm is in Tier A/B, amber B-edge, red C/D)
- Logs this week / verified / pending / voice share / correction rate
- **Schedule compliance panel** — per plot-crop card showing current schedule, compliance %, delta histogram, and "you're X days behind on Y" highlights
- Per-operator scorecard — logs count, verification pass rate, correction rate *about this operator* (framed non-judgmentally, semi-literate-friendly Marathi)
- Per-plot 7-day heat strip
- Cost burn vs budget (when finance integration lands)

Data comes from `mis.*` views filtered by `farmId` (fast — heavy lifting happened overnight).

**Endpoint:** `GET /shramsafal/reports/farm-week/{farmId}` → owner-only, subscription-active, entitlement-checked.

### 5.3 Technical-Health MIS (the team operating the platform)

Metabase dashboard at `build/metabase/dashboards/tech-health.json`.

**Cards:**

- Sync failure rate per app version / device model
- Voice parse success rate per `promptVersion`
- OCR extraction success rate
- Offline-queue depth p95 (how deep does the outbox get before sync?)
- OTP send → verify rate (SMS cost guardrail)
- Gemini cost per active farm / per log / per user — by day
- AI invocation p50 / p95 / p99 latency
- Sync conflict count per day
- Error-rate heatmap (hour × day)

### 5.4 MIS Query Contract (stops dashboard rot)

`_COFOUNDER/03_Documentation/MIS_QUERY_CONTRACT.md` lists:

- Every MIS view name + columns + refresh cadence
- The 5 Tier-1 guardrail thresholds
- The 7 Anti-PMF red-light definitions
- The data contract between `analytics.events` and `mis.*` (which events feed which views)

**CI gate:** a job parses the Metabase dashboard JSONs and fails if any card references a view/column not in the contract. Dashboards evolve; the contract forces a PR when a breaking change happens.

---

## Section 6 — Behavioral Analytics Layer (Tier 3 in depth)

This section is the quarterly product-strategy fuel. Queries here don't need to be real-time — they inform decisions made once a month.

### 6.1 Feature-Retention Correlation Matrix

**View:** `mis.feature_retention_lift`

```sql
CREATE MATERIALIZED VIEW mis.feature_retention_lift AS
WITH cohort AS (
    SELECT u.id AS user_id,
           DATE_TRUNC('week', u.registered_at_utc) AS cohort_week
    FROM public.users u
    WHERE u.registered_at_utc >= NOW() - INTERVAL '12 weeks'
),
feature_used AS (
    SELECT c.user_id, c.cohort_week, e.event_type AS feature
    FROM cohort c
    JOIN analytics.events e
      ON e.actor_user_id = c.user_id
     AND e.occurred_at_utc BETWEEN c.cohort_week AND c.cohort_week + INTERVAL '7 days'
    WHERE e.event_type IN (
        'log.created',          -- baseline
        'log.verified',
        'schedule.adopted',
        'cost.entry.added',
        'invitation.issued'
    )
),
retained_d30 AS (
    SELECT c.user_id, c.cohort_week,
           BOOL_OR(e.occurred_at_utc BETWEEN c.cohort_week + INTERVAL '28 days'
                                        AND c.cohort_week + INTERVAL '32 days') AS is_retained_d30
    FROM cohort c
    LEFT JOIN analytics.events e ON e.actor_user_id = c.user_id
    GROUP BY c.user_id, c.cohort_week
)
SELECT
    fu.feature,
    COUNT(DISTINCT fu.user_id) FILTER (WHERE r.is_retained_d30) * 100.0
        / NULLIF(COUNT(DISTINCT fu.user_id), 0) AS d30_if_used,
    (SELECT COUNT(DISTINCT user_id) FILTER (WHERE is_retained_d30) * 100.0 / NULLIF(COUNT(DISTINCT user_id), 0)
     FROM retained_d30) AS d30_baseline,
    -- lift = d30_if_used - d30_baseline
    ...
FROM feature_used fu
LEFT JOIN retained_d30 r ON r.user_id = fu.user_id
GROUP BY fu.feature;
```

### 6.2 First-7-Days Microscope

**View:** `mis.new_farm_day_snapshot`

One row per (farm_id, day_since_signup) for the first 7 days, capturing: farms_created_cumulative, plots_count, logs_count, schedule_adopted_yn, voice_tried_yn, invite_sent_yn, first_verification_yn.

Downstream Metabase card clusters trajectories by retained-vs-churned outcome, highlighting which *sequences* of actions predict retention. That sequence becomes the onboarding script.

### 6.3 Silent Churn Detector

**View + alert:** `mis.silent_churn_watchlist`

```sql
CREATE MATERIALIZED VIEW mis.silent_churn_watchlist AS
SELECT
    s.owner_account_id,
    s.farm_id,
    s.plan_code,
    w_cur.wvfd AS wvfd_this_week,
    w_prev.wvfd AS wvfd_last_week,
    s.current_period_end_utc
FROM accounts.subscriptions s
LEFT JOIN mis.wvfd_weekly w_cur ON w_cur.farm_id = s.farm_id
LEFT JOIN mis.wvfd_weekly w_prev ON w_prev.farm_id = s.farm_id
WHERE s.state = 'Active'
  AND COALESCE(w_cur.wvfd, 0) = 0
  AND COALESCE(w_prev.wvfd, 0) = 0;
```

**Friday alert (Phase 7):** this view's rows are emailed to the founder every Friday 09:00 IST. These farms get a personal call before they cancel.

### 6.4 Negative-Space Metrics

`mis.zero_cost_farms`, `mis.zero_mis_visits`, `mis.logs_without_attachments` — views that surface features to **kill**, not grow.

### 6.5 Activity Heatmap

`mis.activity_heatmap` — 24 × 7 grid of event counts. Drives reminder-timing product decisions.

### 6.6 Cohort Quality Score

`mis.cohort_quality_score` per (cohort_week, channel). Monthly review decides channel spend allocation for the following month.

### 6.7 K-factor Decomposition (post Phase 7)

`mis.k_factor_decomposition` — per referrer, computes `invites_sent × accept_rate × activation_rate`. Monthly cohort.

---

## Section 7 — Red Flag Detectors (Anti-PMF Alarm System)

Automated guardians that force the team to face uncomfortable truths. Each fires to founder Slack/email within 24h of a weekly-window breach.

| Detector | Query | Why it's dangerous |
|---|---|---|
| **R1 — Smooth-decay retention** | D30 < 20% of D7 AND D60 < 40% of D30 | You're a novelty, not a habit |
| **R2 — WVFD/farm drop while MAU rises** | WAU up > 10% week-over-week AND WVFD/farm down > 10% | Growth masking product failure |
| **R3 — Rubber-stamp verification** | > 30% of owners verify batches of 10+ logs in < 10s each | Verification is fake — trust signal is fake |
| **R4 — Voice share decay** | Voice share in week 6 < 50% of week 1 | AI pipeline is becoming a liability |
| **R5 — Schedule compliance plateau** | Compliance flat at < 50% across 4+ consecutive cohorts | Catalog is wrong — farmers don't believe it |
| **R6 — Trial-paid flash-churn** | > 20% of new paid subs cancel within 30 days | Pricing wrong or perceived value < price |
| **R7 — Correction rate rising** | 4-week rolling correction rate grew ≥ 5 points | Multi-operator trust is degrading, not improving |
| **R8 — Referral cohort retention < self-signup** | D30 of QR-referral cohort < D30 of direct signup | You're incentivizing the wrong invitations |

Implemented as `mis.*_alerts` views + a Phase 7 `AlertDispatcherJob` that scans them daily.

---

## Section 8 — Build Sequencing (9 Phases)

Each phase is PLAN → EXECUTE → VERIFY with an explicit VERIFY command. Each phase is independently shippable once its dependencies are met.

### Phase 1 — AnalyticsEvent Foundation

**Goal:** Ship the append-only event table + writer port + catalog + architecture guards. Nothing emits yet.
**Agent:** Claude or Codex.
**IDE:** Codex IDE (backend-heavy).
**Context boundary:** NO (cross-cutting BuildingBlocks change).
**Verify:** `dotnet build && dotnet test --filter "Category=BuildingBlocks"`

**Deliverables:**

1. **Task 1.1** — Create `AnalyticsEvent` record + `IAnalyticsWriter` port in `BuildingBlocks/Analytics/`. TDD: write `AnalyticsEvent_PersistsAllFields_IncludingJsonProps` first.
2. **Task 1.2** — `AnalyticsEventType` string-constant catalog (Section 3.3). Architecture test `AllAnalyticsEmitCalls_UseConstant_NotLiteral`.
3. **Task 1.3** — Migration: `analytics` schema + partitioned `events` table + indexes + append-only rules. Hand-edit EF migration to include DB rules.
4. **Task 1.4** — `AnalyticsDbContext` + `AnalyticsWriter` (failure-isolated — wraps DB call in try/catch/log). Two tests: happy path + DB-failure-swallowed.
5. **Task 1.5** — Register in `Bootstrapper` DI. Smoke test via integration harness.
6. **Commit:** `feat(buildingblocks): AnalyticsEvent foundation + writer + schema`.

**Exit:** `AnalyticsEvent` is emitable from anywhere, no one emits yet.

---

### Phase 2 — Handler Emission (Cross-Cutting)

**Goal:** Every existing handler writing a first-class aggregate emits one `AnalyticsEvent` at commit time.
**Agent:** Sub-agent-parallel (one per handler) via `superpowers:subagent-driven-development`.
**IDE:** Codex IDE.
**Context boundary:** YES per handler.
**Verify:** `dotnet test` — architecture test `EveryHandlerThatWritesAggregate_EmitsAnalyticsEvent` green.

**Deliverables (one task each, parallelizable):**

| # | Handler | Event(s) emitted |
|---|---|---|
| 2.1 | `VerifyOtpHandler` | `user.registered`, `user.logged_in`, `otp.verified` |
| 2.2 | `RequestOtpHandler` | `otp.sent` |
| 2.3 | `CreateFarmHandler` | `farm.created` |
| 2.4 | `CreatePlotHandler` | `plot.created` |
| 2.5 | `CreateDailyLogHandler` | `log.created` (includes schedule delta from Phase 3) |
| 2.6 | `VerifyLogHandler` | `log.verified` |
| 2.7 | `BatchVerifyHandler` | `batch.verified` |
| 2.8 | `CorrectLogHandler` | `log.corrected` |
| 2.9 | `IssueFarmInviteHandler` | `invitation.issued` |
| 2.10 | `ClaimJoinHandler` | `invitation.claimed` |
| 2.11 | `RevokeMembershipHandler` | `membership.revoked` |
| 2.12 | `AddCostEntryHandler` | `cost.entry.added` |
| 2.13 | `CorrectCostEntryHandler` | `cost.entry.corrected` |
| 2.14 | `AllocateGlobalExpenseHandler` | `finance.expense.allocated` |
| 2.15 | AI call sites (Gemini, Sarvam) | `ai.invocation` with cost_usd + latency_ms + outcome |

Each task: 3 atomic steps — failing unit test → modify handler → green + commit.

**Architecture test ships with 2.15**: scans Application projects by reflection, fails build if any `Handler.HandleAsync` calls `SaveChangesAsync` without also calling `analytics.EmitAsync` in the same method.

**Exit:** Every log + verification + invite + cost action lands a row in `analytics.events`.

---

### Phase 3 — Schedule & Migration Domain

**Goal:** Full Section 2 — entities, invariants, handlers, catalog seed, delta stamp on log write.
**Agent:** Claude (domain design + Codex for implementation).
**IDE:** Antigravity for design → Codex for code.
**Context boundary:** YES — new domain module.
**Verify:** `dotnet build && dotnet test --filter "Category=Schedule"` + integration test `ScheduleMigration_AtomicTransaction`.

**Deliverables:**

1. **Task 3.1** — Domain entities (Section 2.4): `CropScheduleTemplate`, `PrescribedTask`, `ScheduleSubscription`, `ScheduleMigrationEvent`, `ComplianceResult`. Pure domain project.
2. **Task 3.2** — EF configurations + migrations for `ssf.crop_schedule_templates`, `ssf.schedule_subscriptions`, `ssf.schedule_migration_events`. Include partial unique index for I-14 and append-only rules for I-16.
3. **Task 3.3** — `IScheduleComplianceService` + implementation. TDD: 4 unit tests (no-active-sub → Unscheduled; on-time match; early match; late match).
4. **Task 3.4** — Wire `IScheduleComplianceService` into `CreateDailyLogHandler` + `AddLogTaskHandler`. Stamp `ComplianceResult` on log in same transaction.
5. **Task 3.5** — `AdoptScheduleHandler` (use case: farmer picks initial schedule for plot-crop-cycle). Enforces I-14.
6. **Task 3.6** — `MigrateScheduleSubscriptionHandler` (Section 2.6). Atomic: prev.Migrate → new.Active → `ScheduleMigrationEvent` → two AnalyticsEvents, all in one DB tx. Integration test asserts I-14 + I-15 under concurrent attempts.
7. **Task 3.7** — `AbandonScheduleHandler` + `CompleteScheduleHandler`.
8. **Task 3.8** — Seed: 3 initial templates (`grape_nashik_standard_v1`, `pomegranate_solapur_standard_v1`, `onion_rabi_standard_v1`). Seed JSON in `Accounts.Infrastructure/Seeds/`.
9. **Task 3.9** — Endpoints: `POST /shramsafal/plots/{plotId}/crops/{cropId}/cycles/{cycleId}/schedule/adopt`, `POST .../schedule/migrate`, `POST .../schedule/abandon`.
10. **Task 3.10** — Frontend: blocking schedule picker modal at plot creation; compliance badge on plot cards; migration sheet with reason selector.
11. **Commit cadence:** One per task, prefix `feat(schedule):` or `feat(ssf):` appropriately.

**Exit:** A new plot-crop can adopt a schedule. Log submissions get stamped with `deltaDays`. Migration is atomic and audited.

---

### Phase 4 — MIS Schema Rollups

**Goal:** All Tier-0/1 views + schedule views + refresh job.
**Agent:** Codex.
**IDE:** Codex IDE.
**Context boundary:** NO (cross-cutting SQL).
**Verify:** `dotnet test --filter "Category=Mis"` + manual `\d mis.*` sanity check.

**Deliverables:**

1. **Task 4.1** — Create `mis` schema + grant-only-to-mis_reader pattern.
2. **Task 4.2** — `mis.wvfd_weekly` (North Star). Test: `WvfdRollup_CountsOnlyVerifiedWithin48h`.
3. **Task 4.3** — Tier-1 guardrail views: `mis.d30_retention_paying`, `mis.log_verify_lag`, `mis.correction_rate`, `mis.voice_log_share`.
4. **Task 4.4** — Activation-funnel view: `mis.activation_funnel`.
5. **Task 4.5** — Engagement-tier view: `mis.engagement_tier`.
6. **Task 4.6** — Schedule views (Section 2.7): 8 views (`mis.schedule_adoption_rate`, `mis.schedule_compliance_weekly`, `mis.schedule_delta_distribution`, `mis.schedule_migration_rate`, `mis.schedule_migration_lift`, `mis.schedule_abandonment_rate`, `mis.schedule_catalog_popularity`, `mis.schedule_unscheduled_ratio`).
7. **Task 4.7** — Cost-of-AI view: `mis.gemini_cost_per_farm`.
8. **Task 4.8** — `MisRefreshJob` hosted service with `REFRESH MATERIALIZED VIEW CONCURRENTLY`. Default `0 2 * * *`. Per-view try/catch.
9. **Commit:** One per view, prefix `mis:`.

**Exit:** All Tier-0/1 metrics computable via SELECT. Nightly refresh running.

---

### Phase 5 — Metabase Deployment + Founder Dashboard

**Goal:** Metabase container + founder dashboard with Tier-0/1 + schedule Sankey.
**Agent:** Claude (config) + Codex (Docker).
**IDE:** Codex IDE.
**Context boundary:** NO.
**Verify:** Docker compose up, log in, dashboard renders, every card has data.

**Deliverables:**

1. **Task 5.1** — `build/docker-compose.mis.yml` — Metabase image + read-only PG user `mis_reader` with `SELECT` on `analytics.*` + `mis.*`, nothing else.
2. **Task 5.2** — Founder dashboard JSON: `build/metabase/dashboards/founder.json` with the 12 cards from Section 5.1.
3. **Task 5.3** — Technical-health dashboard JSON: Section 5.3 cards.
4. **Task 5.4** — MIS Query Contract doc: `_COFOUNDER/03_Documentation/MIS_QUERY_CONTRACT.md`. Locks view names + columns.
5. **Task 5.5** — CI check: dashboard JSONs parse + reference only contract-declared views. Fails build on drift.
6. **Commit:** `mis: metabase deployment + founder dashboard + query contract`.

**Exit:** Founder can see WVFD daily, schedule migrations flow, cohort retention.

---

### Phase 6 — Owner MIS (Product Feature)

**Goal:** Subscription-gated per-farm MIS page for paying owners.
**Agent:** Claude backend + Codex frontend.
**IDE:** Codex IDE.
**Context boundary:** YES.
**Verify:** `dotnet test` + frontend `vitest run --run reports/`.
**Depends on:** Phase 4 (views) + multi-tenant Phase 5 (subscriptions/entitlement).

**Deliverables:**

1. **Task 6.1** — `GetFarmWeekMisHandler` in `ShramSafal.Application`. Entitlement-gated via `IEntitlementPolicy.HasMisRead(ownerAccountId)`.
2. **Task 6.2** — Endpoint `GET /shramsafal/reports/farm-week/{farmId}` with owner + subscription-active gate.
3. **Task 6.3** — Frontend `OwnerMisPage` under `/reports`. Components: `FarmWeekCard`, `ScheduleComplianceCard`, `OperatorScorecard`, `PerPlotHeatStrip`.
4. **Task 6.4** — Entry point in `ProfilePage`: "Reports & MIS" row, owner-only + subscription-active only. Workers see nothing.
5. **Task 6.5** — Empty-state design — new farm without data yet gets Marathi copy that teaches the signals, not a sad blank screen.
6. **Tests:** `GetFarmWeekMis_DeniedForWorker`, `GetFarmWeekMis_DeniedWhenSubscriptionExpired`, `OwnerMisPage_RendersFromMockedResponse`.
7. **Commit:** `feat(ssf,web): owner MIS product feature (subscription-gated)`.

**Exit:** Paying owners have a per-farm weekly report. Workers cannot access. Free-tier owners see an upgrade nudge.

---

### Phase 7 — Behavioral Analytics + Alerts

**Goal:** Ship Tier-3 behavioral views + red-flag alert dispatcher.
**Agent:** Codex.
**IDE:** Codex IDE.
**Context boundary:** NO.
**Verify:** `dotnet test --filter "Category=Alerts"` + staging alert fires to test Slack channel.

**Deliverables:**

1. **Task 7.1** — `mis.feature_retention_lift` (Section 6.1).
2. **Task 7.2** — `mis.new_farm_day_snapshot` + clustering helper view.
3. **Task 7.3** — `mis.silent_churn_watchlist` (Section 6.3).
4. **Task 7.4** — `mis.zero_cost_farms`, `mis.zero_mis_visits` (negative-space, Section 6.4).
5. **Task 7.5** — `mis.activity_heatmap` (Section 6.5).
6. **Task 7.6** — `mis.cohort_quality_score` per channel (Section 6.6).
7. **Task 7.7** — `mis.k_factor_decomposition` (Section 6.7, depends on multi-tenant Phase 7).
8. **Task 7.8** — Red-flag detector views (R1–R8 from Section 7). Each view returns a boolean + a breach_severity column.
9. **Task 7.9** — `AlertDispatcherJob` hosted service. Runs daily 09:00 IST. Scans red-flag views. Emails founder + posts to Slack for any breach. Idempotent — doesn't re-alert the same breach within 7 days.
10. **Task 7.10** — Friday silent-churn digest email.
11. **Commit cadence:** One per view, `mis:` prefix; alert dispatcher as `feat(alerts)`.

**Exit:** Team is auto-alerted when anti-PMF signals trip. Silent-churn list emailed weekly.

---

### Phase 8 — UI Surfaces for Schedule (in frontend)

**Goal:** Farmer-facing surfaces that complete Section 2.9's UI contract.
**Agent:** Claude UI + Codex.
**IDE:** Antigravity (Gemini handoff for layout) → Codex.
**Context boundary:** YES (frontend feature).
**Verify:** Visual verification in dev server + `vitest run`.
**Depends on:** Phase 3 backend.

**Deliverables:**

1. **Task 8.1** — Blocking schedule picker modal at plot creation (or at first-log-in-crop-cycle if skipped). ≤ 3 options per crop, Marathi-first UI.
2. **Task 8.2** — Compliance badge component on plot cards (green/amber/red).
3. **Task 8.3** — Overdue-task nudge in log flow: "Y task was due 2 days ago. Log now?"
4. **Task 8.4** — Migration sheet with explicit `MigrationReason` picker (required).
5. **Task 8.5** — Schedule history timeline inside owner MIS — shows migrations with compliance lift per segment.
6. **Commit:** `feat(web,schedule): farmer-facing schedule surfaces`.

**Exit:** A new farmer cannot skip the schedule choice. A farmer migrating must record why.

---

### Phase 9 — Hygiene + Docs + CI Gates

**Goal:** Lock the long-term quality of MIS so it doesn't rot.
**Agent:** Claude.
**IDE:** Either.
**Context boundary:** NO.
**Verify:** CI green on a PR that intentionally breaks a contract — gate fires correctly.

**Deliverables:**

1. **Task 9.1** — `MIS_QUERY_CONTRACT.md` finalised — every view, every column, every refresh cadence locked.
2. **Task 9.2** — CI gate: Metabase JSON → contract validator.
3. **Task 9.3** — `_COFOUNDER/03_Documentation/MIS_RUNBOOK.md` — how to investigate a WVFD drop, how to add a new event type, how to promote a view from experiment to contract.
4. **Task 9.4** — `MIS_METRIC_DICTIONARY.md` — plain-English definition of every metric. Used by every new team member + for founder pitches.
5. **Task 9.5** — Add MIS to the Pilot Gate checklist in `_COFOUNDER/01_Operations/Protocols/`.
6. **Task 9.6** — Update `SESSION_STATE.md` + `CHANGE_LOG.md` per Co-Founder OS sync protocol.
7. **Commit:** `docs(mis): runbook + dictionary + CI hygiene gates`.

**Exit:** MIS is a first-class platform subsystem with contracts, docs, and gates.

---

## Section 9 — Non-Goals, Dependencies, Open Questions

### 9.1 Explicit non-goals

- **Mixpanel / Amplitude / Segment** — not before $500K ARR
- **ClickHouse / BigQuery / Snowflake** — not before 1M events/day
- **Realtime dashboards** — nightly refresh is correct. WVFD is a weekly unit; realtime is noise.
- **AI-generated insights overlay** — dashboards should make the founder think. Don't automate thinking away before you understand the data.
- **Farmer-authored custom schedules** — V2, after we see catalog compliance patterns
- **Per-worker activity dashboards exposed outside the owner** — violates visibility boundaries (main spec §8.8)
- **Multi-schedule stacking** (pest + growth) — complexity not justified in V1

### 9.2 Dependencies on other plans

| Dependency | Why it's needed | Earliest phase it blocks |
|---|---|---|
| Multi-tenant Phase 0–4 (OwnerAccount, FarmMembership, identity, OTP) | Source events exist, `ActorRole` + `OwnerAccountId` resolvable | Phase 2 (handler emission) |
| Multi-tenant Phase 5 (Subscription + entitlement) | Owner MIS is subscription-gated; MRR queryable | Phase 6 (Owner MIS) |
| Multi-tenant Phase 7 (Affiliation + GrowthEvent) | K-factor decomposition; referral cohorts | Phase 7 (K-factor view) |

This MIS plan's **Phase 1–5 can ship regardless of multi-tenant progress** — they just emit partial data until the source events land. Phase 6 requires multi-tenant Phase 5. Phase 7's K-factor card requires multi-tenant Phase 7.

### 9.3 Open questions (product decisions needed before Phase 7)

1. **What's the WVFD/farm target that gets published as a commitment?** 4.5/7 is my proposal. Product should sanity-check against current baseline before locking.
2. **Who owns the red-flag alerts?** Founder only, or does the success manager get them too?
3. **Marathi copy for operator scorecard** — must not feel policing. Needs behavioral-product-lead review before Phase 6 ships.
4. **Schedule catalog expansion cadence** — how often do we add new templates? Who owns them? (Agronomist partner?)
5. **Owner MIS frequency cap** — do we want to nudge an owner daily to check MIS, or let it be pull-only? Affects retention, but can overwhelm.
6. **Schedule migration cool-down** — should there be a minimum days-between-migrations to prevent thrashing? (My take: no hard limit; let data tell us via `thrasher` cohort.)

### 9.4 Success definition (plan is DONE when)

1. Every first-class handler emits the right `AnalyticsEvent` in the same commit that adds its domain code.
2. `mis.wvfd_weekly` returns a non-zero row for every farm that logged 3+ verified logs in the last 7 days.
3. All 8 schedule metrics (Section 2.7) compute correctly for a test farm across a simulated 4-week cycle with one migration event.
4. Founder Metabase dashboard shows all 12 cards from Section 5.1 with real data and no manual SQL tweaks.
5. Owner MIS is reachable from Profile → Reports for active-subscription owners, blocked otherwise, invisible to workers.
6. All 8 red-flag detectors are wired to alert dispatcher; a synthetic breach fires to test Slack.
7. The architecture tests (`EveryHandlerThatWritesAggregate_EmitsAnalyticsEvent`, `AllAnalyticsEmitCalls_UseConstant_NotLiteral`, `MetabaseDashboards_OnlyReferenceContractedViews`) are green.
8. `MIS_QUERY_CONTRACT.md` + `MIS_RUNBOOK.md` + `MIS_METRIC_DICTIONARY.md` exist and are referenced from `_COFOUNDER/README.md`.

When all 8 hold, **any new handler added after this plan is done MUST emit analytics on day one because the architecture test will block its PR**, and any new dashboard card MUST reference a contracted view. The MIS becomes a self-enforcing subsystem.

---

## Section 10 — One-sentence product truth for MIS

> **The product's value is one sentence: "the operator logged, the owner verified, the schedule said it happened on time, and that farmer just referred another." The entire MIS just measures how often that sentence is true, per farm, per week — and screams when it isn't.**

Everything in this plan exists to make that sentence measurable, attributable, and actionable.

---

## Appendix A — Phase Timeline (rough sequencing, not dates)

Assumes one full-time engineer + Claude/Codex. Dates will depend on multi-tenant plan progress.

```
Phase 1 (AnalyticsEvent foundation)            Week 1
Phase 2 (Handler emission × 15)                 Weeks 2-3 (parallel sub-agents)
Phase 3 (Schedule domain)                       Weeks 3-5 (overlaps Phase 2)
Phase 4 (MIS schema rollups)                    Weeks 4-5
Phase 5 (Metabase + founder dashboard)          Week 6
Phase 6 (Owner MIS)                             Weeks 7-8 (gated on multi-tenant Phase 5)
Phase 7 (Behavioral + alerts)                   Weeks 8-9
Phase 8 (Schedule UI)                           Weeks 9-10 (overlaps Phase 7)
Phase 9 (Hygiene + docs + CI)                   Week 11
```

Total: ~11 weeks for a lean team. Phase 1–5 can be shipped in ~6 weeks as a "minimum viable MIS" if time-constrained; Phase 6–9 become Fast-Follow v1.1.

---

## Appendix B — Relationship to Co-Founder OS artifacts

- **Master OS:** `_COFOUNDER/CLAUDE.md` (v2.0)
- **Execution Protocol:** `_COFOUNDER/01_Operations/Protocols/EXECUTION_MODES.md` (PRAR)
- **This plan's SESSION_STATE entry:** will be added when the first phase enters EXECUTE
- **CHANGE_LOG:** one entry per phase completion
- **Related plans:**
  - [SHRAMSAFAL_MULTIUSER_MULTITENANT_ARCHITECTURE_SPEC_2026-04-18.md](SHRAMSAFAL_MULTIUSER_MULTITENANT_ARCHITECTURE_SPEC_2026-04-18.md) — source events, OwnerAccountId, subscription
  - [SHRAMSAFAL_MULTIUSER_MULTITENANT_IMPLEMENTATION_PLAN_2026-04-18.md](SHRAMSAFAL_MULTIUSER_MULTITENANT_IMPLEMENTATION_PLAN_2026-04-18.md) — phase-level dependencies

**Supersedes:** `SHRAMSAFAL_PHASE_8_5_INSTRUMENTATION_MIS_EXTENSION_2026-04-18.md` — that file's content is fully absorbed into this plan's Phases 1–2 and 4–6. Delete after this plan is approved.
