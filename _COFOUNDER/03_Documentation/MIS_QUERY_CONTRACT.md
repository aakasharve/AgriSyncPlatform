# MIS Query Contract — v1 (2026-04-20)

> **This document is locked.** Any CI gate, Metabase dashboard, or backend query referencing a `mis.*` view must use the view names and columns declared here. Adding a column is non-breaking. Removing or renaming a column requires a contract version bump and migration.

---

## Schema: `mis`

All views are materialized. Refresh cadence: **nightly at 02:00 UTC** via `MisRefreshJob`. Granted read-only to `mis_reader` role (used by Metabase).

---

## Phase 4 — Tier-0/1 Core Views

### `mis.wvfd_weekly`
Weekly Verified Farm-Days. Source of the North Star metric.

| Column | Type | Description |
|---|---|---|
| `farm_id` | uuid PK | Farm identifier |
| `wvfd` | int (0–7) | Verified farm-days in rolling 7-day window |
| `engagement_tier` | char(1) | A (≥5), B (3–5), C (1–3), D (<1) |

### `mis.d30_retention_paying`
D30 retention per user cohort. Based on `analytics.events`.

| Column | Type | Description |
|---|---|---|
| `user_id` | uuid PK | User |
| `cohort_week` | date | Week of signup |
| `retained_d30` | bool | Active in week 4 of cohort |

### `mis.log_verify_lag`
Median hours from log creation to first verification, per farm.

| Column | Type | Description |
|---|---|---|
| `farm_id` | uuid PK | Farm |
| `median_hours_lag` | numeric | Median lag. Target ≤ 36h |

### `mis.correction_rate`
% of logs owner-edited after submit, per farm (rolling 7d).

| Column | Type | Description |
|---|---|---|
| `farm_id` | uuid PK | Farm |
| `correction_rate_pct` | numeric | 0–100. Target ≤ 15% |

### `mis.voice_log_share`
% of logs with `trigger = 'voice'`, per farm (rolling 7d).

| Column | Type | Description |
|---|---|---|
| `farm_id` | uuid PK | Farm |
| `voice_share_pct` | numeric | 0–100. Target ≥ 40% |

### `mis.activation_funnel`
Step-level funnel counts (all time).

| Column | Type | Description |
|---|---|---|
| `step` | text PK | Step name (e.g. `1. registered`) |
| `count` | bigint | Distinct users reaching step |

### `mis.engagement_tier`
Farm-count per engagement tier for this week.

| Column | Type | Description |
|---|---|---|
| `engagement_tier` | char(1) PK | A/B/C/D |
| `farm_count` | bigint | Farms in this tier |

### `mis.schedule_adoption_rate`
Single-row scalar.

| Column | Type | Description |
|---|---|---|
| `id` | int PK | Always 1 |
| `adoption_rate_pct` | numeric | % farms that adopted a schedule |

### `mis.schedule_migration_rate`
Single-row scalar.

| Column | Type | Description |
|---|---|---|
| `id` | int PK | Always 1 |
| `migration_rate_pct` | numeric | % farms that migrated a schedule |

### `mis.schedule_abandonment_rate`
Single-row scalar.

| Column | Type | Description |
|---|---|---|
| `id` | int PK | Always 1 |
| `abandonment_rate_pct` | numeric | % farms that abandoned a schedule |

### `mis.schedule_unscheduled_ratio`
% of logs with `complianceOutcome = 'unscheduled'`, per farm.

| Column | Type | Description |
|---|---|---|
| `farm_id` | uuid PK | Farm |
| `unscheduled_pct` | numeric | 0–100. Lower = more schedule depth |

### `mis.gemini_cost_per_farm`
Gemini AI cost per farm per day.

| Column | Type | Description |
|---|---|---|
| `farm_id` | uuid | Farm |
| `day` | date | Day |
| `total_cost_usd` | numeric | Sum of `props.cost_usd` from `ai.invocation` events |

---

## Phase 7 — Behavioral & Alert Views

### `mis.feature_retention_lift`
D30 retention lift per feature. Refreshed nightly.

| Column | Type | Description |
|---|---|---|
| `feature` | text PK | Feature name (e.g. `schedule_adopted`, `voice_log`) |
| `d30_lift_pts` | numeric | Lift in percentage points. Sort DESC for onboarding priority |

### `mis.new_farm_day_snapshot`
Per (farm, snapshot_day) row for first-30-day analysis.

| Column | Type | Description |
|---|---|---|
| `farm_id` | uuid | Farm |
| `snapshot_day` | date | Calendar day |
| `farm_first_event_utc` | timestamptz | When farm first appeared |
| `day_of_cohort` | int | Days since first event |
| `logs_that_day` | bigint | Log events |
| `verifications_that_day` | bigint | Verify events |
| `schedule_adopted_today` | bool | Schedule adopted on this day |
| `voice_tried_today` | bool | Voice log on this day |
| `invite_sent_today` | bool | Invite issued on this day |

### `mis.silent_churn_watchlist`
Paid farms with avg WVFD < 1 over last 2 weeks.

| Column | Type | Description |
|---|---|---|
| `farm_id` | uuid PK | Farm |
| `owner_account_id` | uuid | Account |
| `plan_code` | text | Subscription plan |
| `avg_wvfd_2w` | numeric | 2-week average WVFD |
| `current_period_end_utc` | timestamptz | When subscription renews |
| `days_until_renewal` | interval | Time to next billing |

### `mis.zero_engagement_farms`
Active/trialing farms with no logs or no costs.

| Column | Type | Description |
|---|---|---|
| `farm_id` | uuid PK | Farm |
| `owner_account_id` | uuid | Account |
| `plan_code` | text | Plan |
| `total_logs_ever` | bigint | Total log.created events |
| `total_costs_ever` | bigint | Total cost.entry.added events |

### `mis.activity_heatmap`
Log event density by day-of-week and IST hour (rolling 30d).

| Column | Type | Description |
|---|---|---|
| `day_of_week` | int PK | 0=Sun … 6=Sat |
| `hour_ist` | int PK | 0–23 (IST) |
| `event_count` | bigint | Log events in this cell |

### `mis.cohort_quality_score`
CQS per channel per signup week. CQS = 0.4×D30 + 0.3×WVFD + 0.2×paid + 0.1×referral.

| Column | Type | Description |
|---|---|---|
| `channel` | text | Acquisition channel (direct, qr_referral, marketing_site, …) |
| `signup_week` | date | ISO week start |
| `cohort_size` | bigint | Users in cohort |
| `d30_retention_pct` | numeric | D30 retention % |
| `paid_conversion_pct` | numeric | Trial→paid % |
| `referral_rate_pct` | numeric | % who sent invites |
| `cohort_quality_score` | numeric | Composite CQS 0–100 |

### `mis.alert_r1_smooth_decay` through `mis.alert_r8_referral_quality`
Each alert view has the same schema:

| Column | Type | Description |
|---|---|---|
| `id` | int PK | Always 1 |
| `detector` | text | E.g. `R1_smooth_decay` |
| `description` | text | Human-readable breach explanation |
| `breached` | bool | True = breach active |

Rows only appear when `breached = true`. AlertDispatcherJob queries these daily.

---

## Contract Rules

1. **Renaming a column** → new column alias + deprecation note + 1 release grace period → bump contract version.
2. **Adding a column** → non-breaking, no version bump required, add to this doc.
3. **Removing a view** → break the CI gate intentionally, force explicit review.
4. **Dashboard JSONs** must list all queried views in `_views_required`. CI script `build/scripts/validate-mis-dashboards.ps1` enforces this.
5. **Handler queries** that hit `mis.*` go through `IMisReportRepository`. No raw SQL in handlers.
