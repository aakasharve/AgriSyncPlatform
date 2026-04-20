# MIS Metric Dictionary (2026-04-20)

> Plain-English definitions of every metric. Use this for team onboarding, founder pitches, and investor data rooms. Every metric maps to at least one `mis.*` view.

---

## Tier 0 — North Star

### WVFD/farm — Weekly Verified Farm-Days per Farm

**What it is:** For each farm, count the distinct calendar days in the rolling 7-day window where at least one daily log was submitted AND that same day's log was verified by the owner within 48 hours. Cap at 7. Average across all active farms.

**Why this shape:** 20 logs on a single catch-up day = same WVFD as 1 log for 1 day. We reward *habit*, not *volume*. The verification requirement means *both sides of the trust loop* must close.

**Target:** ≥ 4.5. Below 3 for two consecutive weeks = win-back intervention.

**Source view:** `mis.wvfd_weekly`

---

## Tier 1 — Guardrails

### D30 Retention (Paying Owners)
% of paying owners who are still active in week 4 of their signup cohort.
- **Target:** ≥ 60%. **Breach:** < 60%.
- **Source:** `mis.d30_retention_paying`

### Log→Verify Median Lag
Median hours between a log being submitted and its first owner verification.
- **Target:** ≤ 36h. **Breach:** > 36h. Rising lag = owner disengaging.
- **Source:** `mis.log_verify_lag`

### Correction Rate
% of submitted logs that the owner edited at least once after submission.
- **Target:** ≤ 15%. **Breach:** > 15%. High rate = operator confusion OR deliberate misreporting.
- **Source:** `mis.correction_rate`

### Schedule Compliance
% of prescribed tasks (from the active CropScheduleTemplate) completed within ±2 days of their scheduled day.
- **Target:** ≥ 50%. **Breach:** < 50%. Below = farmers don't trust the schedule.
- **Source:** `mis.schedule_compliance_weekly`

### Voice-Log Share
% of logs submitted via voice (Sarvam STT pipeline) vs manual text entry.
- **Target:** ≥ 40%. **Breach:** < 40%. Falling = AI not forming habit, may not justify infra cost.
- **Source:** `mis.voice_log_share`

---

## Tier 2 — Diagnostic

### Activation Funnel Steps
In order: Signup → Farm Created → First Log → First Verify → 3rd Verified Log → Schedule Adopted → Trial→Paid → D30 Retained.
- **Source:** `mis.activation_funnel`

### Engagement Tier (A/B/C/D)
- **A (Power):** WVFD ≥ 5, voice share > 60%, compliance > 70%, 2+ operators. Study them — they're your ICP.
- **B (Core):** WVFD 3–5. Nurture — about to become A.
- **C (Casual):** WVFD 1–3. Habit-building nudges.
- **D (At-risk):** WVFD < 1 for 2 weeks. Auto win-back within 24h.
- **PMF signal:** ≥ 25% of paying farms in tier A within 90 days of signup.
- **Source:** `mis.engagement_tier`

### Cohort Quality Score (CQS) by Channel
Composite score: `0.4 × D30_retention + 0.3 × avg_WVFD + 0.2 × paid_conversion + 0.1 × referral_rate`.
- **Use:** Allocate marketing spend proportionally to CQS, not raw volume.
- **Source:** `mis.cohort_quality_score`

---

## Tier 3 — Behavioral

### Feature-Retention Lift
For each major feature F: `D30_retention(users who used F in week 1) − D30_retention(users who did not)`.
- **Use:** Top feature by lift should define onboarding. If Schedule Adoption has +31 pts lift, block the onboarding until the schedule is chosen.
- **Source:** `mis.feature_retention_lift`

### First-7-Day Microscope
Per-farm, per-day snapshot of actions in the first 30 days. Cluster trajectories to find the "retained" trajectory and encode it as onboarding.
- **Source:** `mis.new_farm_day_snapshot`

### Silent Churn Watchlist
Paid farms with avg WVFD < 1 over two consecutive weeks while still paying. **Highest-value intervention target.** Call before they self-cancel.
- **Source:** `mis.silent_churn_watchlist`

### Activity Heatmap
When do farmers log? Day-of-week × hour (IST). Tells you: when to send nudges, when to schedule downtime, what "normal" usage rhythm looks like.
- **Source:** `mis.activity_heatmap`

---

## Schedule-Specific Metrics

| Metric | Definition | Source view |
|---|---|---|
| Schedule Adoption Rate | % farms that have adopted a CropScheduleTemplate for at least one crop cycle | `mis.schedule_adoption_rate` |
| Schedule Migration Rate | % farms that have ever migrated a schedule (intent to follow the plan) | `mis.schedule_migration_rate` |
| Schedule Abandonment Rate | % farms that abandoned (gave up) a schedule | `mis.schedule_abandonment_rate` |
| Unscheduled Log % | % of logs with no active schedule for that crop — direct signal that adoption is low | `mis.schedule_unscheduled_ratio` |
| Compliance Weekly | % prescribed tasks done on time (±2 days), per farm per week | `mis.schedule_compliance_weekly` |

---

## Red-Flag Detectors

| Code | Breach condition | Meaning |
|---|---|---|
| R1 | D30 < 20% of D7 AND D60 < 40% of D30 | Novelty effect — no habit forming |
| R2 | WAU up > 10% but WVFD/farm down > 10% | Growth masking product failure |
| R3 | > 30% of owners verify 10+ logs in < 10s | Verification is rubber-stamp — trust signal is fake |
| R4 | Week-6 voice share < 50% of week-1 voice share | AI pipeline not earning its cost |
| R5 | Compliance flat < 50% for 4+ cohorts | Schedule catalog mismatch — farmers don't believe it |
| R6 | > 20% of new paid subs cancel within 30 days | Pricing wrong or perceived value < price |
| R7 | 4-week rolling correction rate grew ≥ 5 pts | Operator-owner trust is degrading |
| R8 | QR-referral D30 < direct-signup D30 | Incentivizing wrong invitations |

---

## AI Cost Metrics

### Gemini Cost per Farm (USD, 7d)
Sum of `props.cost_usd` from all `ai.invocation` events, grouped by farm and day.
- **Budget alert:** > $0.50/farm/week triggers review.
- **Source:** `mis.gemini_cost_per_farm`

---

## Glossary

| Term | Definition |
|---|---|
| **WVFD** | Weekly Verified Farm-Days |
| **D30** | 30-day retention (active in week 4 of cohort) |
| **CQS** | Cohort Quality Score — weighted retention+WVFD+conversion+referral |
| **Compliance** | % of prescribed schedule tasks done within ±2 days |
| **ComplianceOutcome** | Enum: Unscheduled / OnTime / Early / Late (stamped on every LogTask) |
| **MigrationReason** | Why a schedule was swapped: BetterFit / WeatherShift / SwitchedCropVariety / OwnerDirective / Other |
| **mis_reader** | PostgreSQL role with SELECT on analytics.* and mis.* — used by Metabase only |
