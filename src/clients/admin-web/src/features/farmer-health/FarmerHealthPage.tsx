import { HeartPulse } from 'lucide-react';
import { useActiveOrg } from '@/app/ActiveOrgProvider';
import { useAdminScope } from '@/hooks/useAdminScope';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { FreshnessChip } from '@/components/ui/FreshnessChip';
import { useCohortPatterns } from './hooks/useCohortPatterns';
import { FarmerSearchBox } from './components/FarmerSearchBox';
import { InterventionQueueTable } from './components/InterventionQueueTable';
import { WatchlistTable } from './components/WatchlistTable';
import { ScoreDistributionChart } from './components/ScoreDistributionChart';
import { EngagementTierBreakdown } from './components/EngagementTierBreakdown';
import { PillarHeatmap } from './components/PillarHeatmap';
import { WeeklyTrendChart } from './components/WeeklyTrendChart';
import { ErrorState, LoadingState, ScoringActiveBanner } from './components/EmptyAndErrorStates';

/**
 * Mode B — cohort patterns landing page.
 *
 * Layout (per UI_DESIGN_BRIEF_GEMINI.md §3, four bands):
 *  Band 1 — header (title + subtitle + FarmerSearchBox)
 *  Band 2 — intervention queue (most prominent surface)
 *  Band 3 — 4-cell visualization grid (2×2 desktop)
 *  Band 4 — watchlist (collapsed by default)
 *
 * Empty / loading / error states use shared `EmptyAndErrorStates` per §4.3
 * Step 6. Mandatory C5 banner ("Scoring active from {DEPLOY_DATE}; data
 * accumulating.") renders whenever the cohort response carries no rows
 * (first-deploy pre-accumulation window).
 */
export default function FarmerHealthPage() {
  const { activeOrgId } = useActiveOrg();
  const { memberships } = useAdminScope();
  const activeOrgName = memberships.find(m => m.orgId === activeOrgId)?.orgName ?? 'No active organization';
  const { data, isLoading, error, refetch, isFetching } = useCohortPatterns();
  const cohort = data?.data;
  const lastRefreshed = data?.meta?.lastRefreshed;

  const totalRowsAcrossSurfaces =
    (cohort?.interventionQueue.length ?? 0) +
    (cohort?.watchlist.length ?? 0) +
    (cohort?.scoreDistribution.reduce((s, b) => s + b.count, 0) ?? 0);
  const isEmpty = !!cohort && totalRowsAcrossSurfaces === 0;

  return (
    <div className="flex flex-col gap-5">
      {/* Band 1 — header strip */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-1">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-extrabold tracking-tight text-text-primary">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-[#7c3aed] to-[#52c0be] text-white shadow-[0_4px_12px_rgba(124,58,237,0.4)]">
              <HeartPulse size={18} strokeWidth={2.5} />
            </span>
            Farmer Health
          </h1>
          <div className="mt-0.5 text-[13px] text-text-muted">
            DWC v2 · {activeOrgName}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <FarmerSearchBox />
          {lastRefreshed && <FreshnessChip source="materialized" lastRefreshed={lastRefreshed} />}
        </div>
      </div>

      {/* Error banner above page chrome (per UI brief Error state). */}
      {error && (
        <ErrorState error={error} onRetry={() => { void refetch(); }} />
      )}

      {/* C5 mandatory banner when cohort is empty (first-deploy backfill = none). */}
      {isEmpty && (
        <ScoringActiveBanner deployDate="first deploy" />
      )}

      {/* Band 2 — intervention queue (most prominent table). */}
      <Card>
        <CardHeader>
          <CardTitle>
            <span className="inline-grid h-6 w-6 place-items-center rounded-[7px] bg-danger text-white">
              <HeartPulse size={13} strokeWidth={2.5} />
            </span>
            Intervention queue
            <span className="ml-1 rounded-md bg-[color:rgba(220,38,38,0.12)] px-2 py-0.5 font-mono text-[11px] font-extrabold tabular-nums text-danger">
              {cohort?.interventionQueue.length ?? 0}
            </span>
          </CardTitle>
          {isFetching && !isLoading && (
            <span className="text-[11px] text-text-muted">Refreshing…</span>
          )}
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <LoadingState label="Loading intervention queue" height={220} />
          ) : (
            <InterventionQueueTable
              rows={cohort?.interventionQueue ?? []}
              understatedEmpty={isEmpty}
            />
          )}
        </CardContent>
      </Card>

      {/* Band 3 — 4-cell visualisation grid. */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Score distribution</CardTitle></CardHeader>
          <CardContent>
            {isLoading
              ? <LoadingState label="Loading score histogram" height={220} />
              : <ScoreDistributionChart bins={cohort?.scoreDistribution ?? []} />}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Engagement tiers</CardTitle></CardHeader>
          <CardContent>
            {isLoading
              ? <LoadingState label="Loading engagement tiers" height={200} />
              : <EngagementTierBreakdown tiers={cohort?.engagementTierBreakdown ?? []} />}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Pillar heatmap</CardTitle></CardHeader>
          <CardContent>
            {isLoading
              ? <LoadingState label="Loading pillar heatmap" height={220} />
              : <PillarHeatmap rows={cohort?.pillarHeatmap ?? []} />}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Weekly trend (8 weeks)</CardTitle></CardHeader>
          <CardContent>
            {isLoading
              ? <LoadingState label="Loading weekly trend" height={220} />
              : <WeeklyTrendChart weeks={cohort?.trendByWeek ?? []} />}
          </CardContent>
        </Card>
      </div>

      {/* Band 4 — watchlist (collapsed by default). */}
      {!isLoading && (
        <WatchlistTable rows={cohort?.watchlist ?? []} />
      )}
    </div>
  );
}
