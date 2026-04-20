# MIS Runbook (2026-04-20)

> How to operate, debug, and evolve the AgriSync MIS subsystem.

---

## 1. How to investigate a WVFD drop

**Symptom:** `mis.wvfd_weekly` avg drops below 3.0 for 2+ consecutive days.

**Step-by-step:**

1. **Check if the refresh ran.** Look in application logs for `"Completed nightly MIS materialized view refreshes"`. If missing, MisRefreshJob failed — check `"Failed to refresh"` errors.
2. **Check raw log counts.** Query `analytics.events` directly:
   ```sql
   SELECT DATE_TRUNC('day', occurred_at_utc) AS day, COUNT(*) AS logs
   FROM analytics.events
   WHERE event_type = 'log.created'
     AND occurred_at_utc >= NOW() - INTERVAL '10 days'
   GROUP BY day ORDER BY day;
   ```
3. **Check verification rate.** Are logs being verified within 48h?
   ```sql
   SELECT DATE_TRUNC('day', occurred_at_utc) AS day, COUNT(*) AS verifies
   FROM analytics.events
   WHERE event_type = 'log.verified'
     AND occurred_at_utc >= NOW() - INTERVAL '10 days'
   GROUP BY day ORDER BY day;
   ```
4. **Inspect per-farm WVFD.** Which farms are dragging the average?
   ```sql
   SELECT farm_id, wvfd, engagement_tier FROM mis.wvfd_weekly ORDER BY wvfd;
   ```
5. **Check silent churn watchlist.** Are high-WVFD farms suddenly disappearing?
   ```sql
   SELECT * FROM mis.silent_churn_watchlist ORDER BY avg_wvfd_2w;
   ```
6. **If data is missing for a specific farm** — check if that farm's events have `farm_id IS NOT NULL`. Missing farm_id on analytics events = handler bug (emit contract violated).

---

## 2. How to add a new event type

1. Add the constant to `AgriSync.BuildingBlocks/Analytics/AnalyticsEventType.cs`.
2. Emit from the handler: `await analytics.EmitAsync(new AnalyticsEvent(...), ct)` after `SaveChangesAsync`.
3. Write a unit test asserting the event is emitted (`CapturingAnalyticsWriter` pattern).
4. If the event needs a `mis.*` view, add it to `Phase7_BehavioralAnalytics` or a new migration, and add to `MIS_QUERY_CONTRACT.md`.
5. Architecture test `AllAnalyticsEmitCalls_UseConstant_NotLiteral` will fail if you inline a string literal — use the constant.

---

## 3. How to promote a view from experiment to contract

1. Create the view in a new migration (prefix `mis:` in commit message).
2. Add the view + columns to `MIS_QUERY_CONTRACT.md`.
3. If Metabase references it, add to `_views_required` in the dashboard JSON.
4. Run `build/scripts/validate-mis-dashboards.ps1` locally to verify.
5. Add to `MisRefreshJob.ViewsToRefresh` array (in refresh-dependency order).
6. Mark the view as contracted in this runbook.

---

## 4. How to run a manual MIS refresh

```sql
-- Connect to agrisync DB as superuser or mis_writer
REFRESH MATERIALIZED VIEW CONCURRENTLY mis.wvfd_weekly;
REFRESH MATERIALIZED VIEW CONCURRENTLY mis.silent_churn_watchlist;
-- ... etc for each view in MisRefreshJob.ViewsToRefresh order
```

Or restart the Bootstrapper service — MisRefreshJob will run at the next 02:00 UTC window.

---

## 5. How to test a red-flag alert

1. Insert synthetic data into `analytics.events` to trigger the breach condition.
2. Manually refresh the relevant alert view:
   ```sql
   REFRESH MATERIALIZED VIEW CONCURRENTLY mis.alert_r1_smooth_decay;
   ```
3. Query the view to confirm `breached = true`.
4. Set `Alerts:FounderEmail` in config to a test inbox.
5. Either wait for AlertDispatcherJob's 03:30 UTC run, or temporarily lower the `now.Hour >= 3` check to fire immediately.
6. Verify the Warning log appears with the expected detector + description.

---

## 6. Monitoring checklist (weekly, every Monday)

- [ ] All `mis.*` views have data for last 7 days (check `wvfd_weekly` row count)
- [ ] No `"Failed to refresh"` in last 7 days of application logs
- [ ] `mis.alert_r*` views — any persistent breaches? Investigate before the weekly review
- [ ] WVFD trend in Metabase — is it flat, rising, or falling?
- [ ] Cohort quality score by channel — any channel diverging?
- [ ] Silent churn watchlist — call each farm on the list before Monday EOD

---

## 7. Known limitations (v1)

- **`REFRESH MATERIALIZED VIEW CONCURRENTLY`** requires a unique index on each view. If a new view is added without a unique index, the refresh will fail silently and log an error.
- **AlertDispatcherJob deduplication** is in-memory per process. Restarting the service resets the 7-day dedupe window — a single breach may fire twice if the service restarts mid-week.
- **MisRead entitlement** (Phase 6) uses `PaidFeature.MisRead` with the standard EvaluateAsync gate. Until the Accounts subscription service is live, `DefaultEntitlementPolicy` allows all requests.
- **`mis.schedule_compliance_weekly`** — not yet implemented as a materialized view; `GetFarmWeekMisHandler` falls back to null if the view doesn't exist. Phase 4 migration should add this view before Phase 6 goes to production.
