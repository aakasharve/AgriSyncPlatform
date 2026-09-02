import type { ReactNode } from 'react';
import { HeartPulse } from 'lucide-react';
import { Link } from 'react-router-dom';
import {
  ChartShell,
  DataList,
  GapBar,
  SCORE_BINS,
  Sparkline,
  TIER_ORDER,
  byMostRecent,
  fillAxis,
  isGap,
  measuredSlots,
} from '@/components/data';
import type { AxisSlot, ChartDataTable, DataListColumn, SparkTone } from '@/components/data';
import {
  INTERVENTION_EMPTY,
  LoadFailed,
  NotMeasured,
  NotMeasuredPanel,
  ScoringActiveBanner,
  StandingNote,
  isRedacted,
} from '@/components/state';
import { PersonName } from '@/components/ui/PersonName';
import { useActiveOrg } from '@/app/ActiveOrgProvider';
import { useAdminScope } from '@/hooks/useAdminScope';
import { DATE_FORMATS, fmt } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useCohortPatterns } from './hooks/useCohortPatterns';
import { FarmerSearchBox } from './components/FarmerSearchBox';
import {
  INTERVENTION_AT,
  PILLARS,
  PILLAR_AXIS,
  PILLAR_BY_KEY,
  QUEUE_LIMIT,
  SCORE_MAX,
  SCORE_REACHABLE,
  WATCHLIST_FROM,
  WATCHLIST_LIMIT,
  WATCHLIST_TO,
  bandTone,
  trendAxis,
} from './cohort';
import type {
  CohortBucketDto,
  CohortEngagementTierDto,
  CohortPillarHeatmapDto,
  CohortScoreBinDto,
  CohortWeeklyTrendDto,
} from './farmer-health.types';

/**
 * FARMER HEALTH — the cohort landing. Two lists, four charts, one search box,
 * and more untrue statements removed than on any other screen in this port.
 *
 * ── WHAT WAS READ, AND WHERE ─────────────────────────────────────────────
 * Everything below is taken from the backend on 2026-09-01, not from the plan
 * and not from the v3 prototype:
 *   `AdminFarmerHealthEndpoints.cs`              the two routes
 *   `GetCohortPatternsHandler.cs`                the (missing) envelope
 *   `AdminCohortPatternsRepository.cs`           seven queries, seven `catch`
 *   `20260505000000_DwcV2Matviews.cs:220-300`    what the score IS
 *   `20260817150453_WvfdWeekBoundaryToIst.cs`    the same, recreated, plus D3
 *   `ResponseRedactor.cs` + `RedactionMatrix.cs` what redaction reaches here
 * `./cohort.ts` carries the six properties of the SCORE; this file carries the
 * six that belong to the REQUEST.
 *
 * ── (A) 🔴 THE RESPONSE HAS NO ENVELOPE, AND THE OLD PAGE RENDERED BLANK ──
 * `GetCohortPatternsHandler.cs:34` returns `Result<CohortPatternsDto>`, not
 * `Result<AdminResponseDto<…>>` — the only two admin handlers that do this are
 * the two farmer-health ones. The old page read `data.data`, got `undefined`,
 * and drew an empty queue, an empty watchlist and four "not enough data yet"
 * charts over a healthy 200. `farmerHealthApi` now normalises both shapes; see
 * its header. A27 registers ONE unenveloped endpoint. There are three.
 *
 * ── (B) 🛑 THERE IS NO SERVER CLOCK ON THIS SCREEN ───────────────────────
 * No envelope means no `meta.lastRefreshedUtc`, so:
 *   - there is NO freshness chip here, and there cannot honestly be one (a
 *     chip may only state an age it has — D5);
 *   - `MeasuredZero`'s sentence, "The window was checked at {time}", cannot be
 *     written. Every empty block on this screen therefore takes the `unproven`
 *     path instead — which is the honest one for a second reason, (C).
 *
 * ── (C) 🔴 SEVEN SWALLOW SITES IN ONE FILE, AND TWO OF THEM FABRICATE ────
 * `AdminCohortPatternsRepository.cs` ends every one of its seven queries in a
 * bare `catch { }`: the histogram, each of the two buckets, the tiers, each
 * pillar, the trend and the suffering top ten. A dropped connection, an
 * unpopulated matview or a permission failure on `mis` reaches this screen as
 * an empty result with HTTP 200.
 *
 * Two are worse than empty. The histogram builds all ten bins zero-filled
 * OUTSIDE the try, and the pillar loop falls through to
 * `new CohortPillarHeatmapDto(name, 0m, 0)`. So a failed query arrives
 * carrying a COMPLETE SET OF ZEROS — the `AdminMisRepository.cs:78` shape
 * Task 21 found, twice more. Twelve sites were catalogued before this screen.
 *
 * ── (D) 🔴 THE SCORE MATVIEW IS UNPOPULATED ON PRODUCTION ────────────────
 * Recorded in the repo itself
 * (`20260817150453_WvfdWeekBoundaryToIst.cs:95-110`):
 * `mis.dwc_score_per_farm_week` is created `WITH NO DATA`, `MisRefreshJob`
 * refreshes CONCURRENTLY, and CONCURRENTLY cannot populate an empty matview.
 * The one-time repair is deployment-tracker task D3, logged there as NOT LIVE,
 * with production's own error quoted. So the most likely reading of an empty
 * Farmer Health screen in production is NOT "scoring active, data
 * accumulating" — it is a view nobody ever filled. That is why the mandatory
 * C5 banner is not the only thing the empty state says. The banner's words are
 * untouched; a second block names what the banner cannot rule out.
 *
 * ── (E) 🛑 THIS ENDPOINT *IS* ORG-SCOPED — EXCEPT FOR A PLATFORM ADMIN ────
 * Eight endpoints were checked in Tasks 14-21 and none took an org parameter.
 * This is the ninth and the FIRST that does: every query joins
 * `mis.effective_org_farm_scope` and filters `efs.org_id = @org`
 * (`AdminCohortPatternsRepository.cs:70-76`). So A39's subtitle can honestly
 * name the organisation — for most readers.
 *
 * `ScopeJoin` returns an EMPTY fragment when `scope.IsPlatformAdmin`, so a
 * platform admin's figures cover every farm on the platform while the topbar
 * still names one organisation. Naming it in the subtitle too would be the
 * fourth sentence of that kind (three were corrected in `74da3d3b`). The
 * subtitle therefore branches on `scope.isPlatformAdmin`, which the client
 * already holds (`useAdminScope.ts:11`).
 *
 * ── (F) 🛑 THE REDACTOR IS A NO-OP ON THIS PAYLOAD (A14) ─────────────────
 * `GetCohortPatternsHandler.cs:36` does call `IResponseRedactor`, which is why
 * Tasks 14-17 could report that this endpoint redacts while the farms list
 * does not. It does not redact anything reachable here, for two independent
 * reasons:
 *   1. `ResponseRedactor.ApplyPolicy` reflects over the TOP-LEVEL record's
 *      constructor parameters only. It does not recurse, and every parameter
 *      of `CohortPatternsDto` is a collection.
 *   2. `RedactionMatrix` names six fields — `ownerPhone`, `workerPhone`,
 *      `workerName`, `payoutAmount`, `farmGpsCoordinates`, `deviationNote`.
 *      `farmerName` is not one of them, in any role.
 * The literal marker `**redacted**` appears NOWHERE in the C# outside one doc
 * comment; the redactor masks by rewriting a string to `ab****yz`. So a
 * farmer's name on this screen is FULL PII TODAY, exactly as on `/admin/farms`
 * (Task 14's B16 finding). The rendering stays redaction-tolerant —
 * `PersonName` falls back to the farm id and never prints a marker — because
 * that is the half a frontend can own, and it must not have to change on the
 * day the server starts masking. **Do not tick B16.**
 *
 * ── WHY THERE IS NO recharts ON THIS SCREEN ANY MORE ─────────────────────
 * The charts here were the last three recharts importers in the console
 * (`ScoreDistributionChart`, `EngagementTierBreakdown`, `WeeklyTrendChart`;
 * `PillarHeatmap` never used it). Tasks 19 and 21 replaced theirs for a reason
 * that applies here unchanged: **recharts cannot draw the hatch.** A `<Bar>`
 * has one height, so a period nobody measured is drawn at zero — the single
 * fabrication this redesign exists to delete. Keeping a 399 kB dependency to
 * draw a four-slice donut, while every other chart in the console draws its
 * own gaps correctly, is paying for the ability to be wrong. The donut is now
 * a proportion bar on the same fixed A-D axis: same figures, and it can show a
 * tier that was never measured. `@tanstack/react-table` went to zero importers
 * in Task 18 and recharts goes to zero here — Task 27 removes both.
 *
 * ── THE ACCESSIBLE DATA TABLE UNDER EVERY CHART (A32) ────────────────────
 * All four charts render through `ChartShell`, whose `dataTable` is REQUIRED
 * at the type level. The donut's table was `<details className="sr-only">`
 * (`EngagementTierBreakdown.tsx:95`) — screen-reader-only, therefore invisible
 * in every screenshot review, which is exactly why Task 9 made the prop
 * mandatory and the disclosure VISIBLE. It still exists, under the same chart,
 * with the same figures; it is no longer hidden from the sighted operator who
 * wanted an exact number out of a picture.
 */

/* ══════════════════════════════════════════════════ the missing clock ════ */

/**
 * `DataList` and `ChartShell` both REQUIRE `measuredZero.checkedAt`, and this
 * screen has no server stamp to put in it (property B).
 *
 * It is never rendered: every block here supplies `unproven`, which takes the
 * other branch. It is a true sentence rather than a placeholder anyway, so
 * that if somebody removes an `unproven` the block degrades into an awkward
 * truth rather than into a fabricated time.
 */
const NO_SERVER_CLOCK = 'a time this feed does not send';

/* ════════════════════════════════════════════════════════ the columns ════ */

/**
 * ONE COLUMN SET, TWO LISTS — and they are NOT the same contract.
 *
 * The columns are shared because the rows are the same shape
 * (`CohortBucketDto` for both). What is not shared is what the reader may do
 * with them, and that difference is the whole of A30 versus A31:
 *
 *   INTERVENTION QUEUE  four sortable columns, live `aria-sort`, per-column
 *                       default direction, default `score` ASC with the
 *                       `lastActiveAt` DESC tiebreak — and the sort is now in
 *                       the URL, so it survives a refresh and a shared link.
 *   WATCHLIST           FIXED at `weeklyDelta` ascending. Not sortable at all.
 *
 * `DataList` renders no sort control when `fixedSort` is set
 * (`DataList.tsx:487`), so passing the same columns to both cannot leak the
 * queue's sortability into the watchlist.
 */
function bucketColumns(): DataListColumn<CohortBucketDto>[] {
  return [
    {
      key: 'farmerName',
      label: 'Farmer',
      /* A34 dies here. Two of the four duplicated Devanagari regex checks
         lived in `InterventionQueueTable.tsx:27-33` and
         `WatchlistTable.tsx:17-23`; both files are deleted and both names now
         render through the one primitive (T6). The other two are Task 23's. */
      render: (r) => <PersonName name={r.farmerName} fallback={r.farmId} />,
      sortType: 'text',
      /* A withheld name has no place in an alphabet, so it sorts as MISSING
         and parks at the bottom in both directions rather than under `*`. */
      sortValue: (r) => (isRedacted(r.farmerName) ? null : r.farmerName),
      defaultDir: 'asc',
    },
    {
      key: 'score',
      label: 'Score',
      align: 'right',
      render: (r) => <ScorePill score={r.score} />,
      sortType: 'num',
      sortValue: (r) => r.score,
      /* A30 — score opens DESCENDING on its first click. */
      defaultDir: 'desc',
      /**
       * THE PRODUCT TIEBREAK (A30). Equal scores break by most recently
       * active — the worst farms who are still turning up, first.
       *
       * It hangs off the COLUMN, so it applies whenever `score` is the sort
       * column in EITHER direction. That is what the live code did
       * (`InterventionQueueTable.tsx:60-62` keyed on `sortKey === 'score'`)
       * despite its comment saying "score-asc"; Task 8 carried the code, not
       * the comment, and this is the call site that keeps it running.
       */
      tiebreak: byMostRecent((r) => r.lastActiveAt),
    },
    {
      key: 'weeklyDelta',
      label: <span title="Change against the previous scored week">&Delta; wk</span>,
      align: 'right',
      render: (r) => <Delta value={r.weeklyDelta} />,
      sortType: 'num',
      sortValue: (r) => r.weeklyDelta,
      defaultDir: 'desc',
    },
    {
      key: 'lastActiveAt',
      label: 'Last active',
      render: (r) => {
        const when = fmt.dateTime(r.lastActiveAt, DATE_FORMATS.cohortRow);
        return when === null ? (
          <NotMeasured state="never" why="No log has ever been recorded for this farm." />
        ) : (
          <span className="font-mono text-caption tabular-nums text-text-2">{when}</span>
        );
      },
      sortType: 'date',
      sortValue: (r) => r.lastActiveAt,
      defaultDir: 'desc',
    },
    {
      key: 'open',
      label: 'Open',
      headerHidden: true,
      align: 'right',
      render: (r) => (
        <Link
          to={`/farmer-health/${encodeURIComponent(r.farmId)}`}
          className="glass-quiet rounded-chip border-control-edge px-2.5 py-1.5 text-caption font-semibold text-text-1 hover:bg-wash"
          aria-label={`Open the drilldown for farm ${r.farmId}`}
        >
          Open
        </Link>
      ),
    },
  ];
}

function ScorePill({ score }: { score: number }) {
  const tone = bandTone(score / SCORE_MAX);
  return (
    <span
      data-tone={tone}
      className={cn(
        'inline-block rounded-chip px-2 py-0.5 font-mono text-caption font-semibold tabular-nums',
        tone === 'red' && 'bg-tint-red text-red',
        tone === 'amber' && 'bg-tint-amber text-amber',
        tone === 'green' && 'bg-tint-green text-green',
      )}
    >
      {fmt.num(score)}
    </span>
  );
}

/** A delta of exactly 0 is TWO facts on this feed — see the caption under the
 *  queue — so it is drawn without a tone rather than as "steady". */
function Delta({ value }: { value: number }) {
  const text = value > 0 ? `+${fmt.num(value)}` : fmt.num(value);
  return (
    <span
      className={cn(
        'font-mono text-caption font-semibold tabular-nums',
        value < 0 && 'text-red',
        value > 0 && 'text-green',
        value === 0 && 'text-text-2',
      )}
    >
      {text}
    </span>
  );
}

/* ═══════════════════════════════════════════════════════════ the screen ══ */

export default function FarmerHealthPage() {
  const { activeOrgId } = useActiveOrg();
  const { memberships, scope } = useAdminScope();

  /* The SERVER's org first, the selection second — the order the topbar uses
     (`AdminShell.tsx:215`). A single-membership admin never picks an org, so
     reading the selection alone printed "No active organization" to an admin
     who plainly had one (the old line 33). */
  const currentOrgId = scope?.orgId ?? activeOrgId;
  const orgName = memberships.find((m) => m.orgId === currentOrgId)?.orgName ?? null;
  const platformWide = scope?.isPlatformAdmin === true;

  const { data, isLoading, isFetching, error, refetch } = useCohortPatterns();
  const cohort = data?.data;

  const queue = cohort?.interventionQueue ?? [];
  const watchlist = cohort?.watchlist ?? [];
  const bins = cohort?.scoreDistribution ?? [];
  const tiers = cohort?.engagementTierBreakdown ?? [];
  const pillars = cohort?.pillarHeatmap ?? [];
  const weeks = cohort?.trendByWeek ?? [];

  /**
   * THE CROSS-SURFACE EMPTINESS SUM (A35, A36) — preserved exactly, including
   * the third term, which is the one carrying the meaning.
   *
   * queue + watchlist + EVERY BIN IN THE HISTOGRAM. The first two answer "is
   * anybody in trouble"; the third answers "has anybody been scored at all",
   * and that is the difference between the two empties A36 splits:
   *
   *   sum === 0   nothing has been scored. The queue's copy may make no claim
   *               about farms, because there are no measured farms to make one
   *               about.
   *   sum  >  0   farms were scored and none needs a person. That IS a
   *               finding, and it is allowed to say so.
   *
   * A design that gave each table its own empty state collapses the two into
   * one celebration. `!!cohort` guards it: with no response at all the sum is
   * 0 for a third reason, and an absent request is not an empty cohort.
   */
  const scoredFarms = bins.reduce((n, b) => n + b.count, 0);
  const totalRowsAcrossSurfaces = queue.length + watchlist.length + scoredFarms;
  const isEmpty = !!cohort && totalRowsAcrossSurfaces === 0;

  /* ── the axes (A33) ───────────────────────────────────────────────────── */

  const binSlots = fillAxis<CohortScoreBinDto, number>(SCORE_BINS, bins, {
    keyOf: (b) => b.bucket,
    valueOf: (b) => b.count,
  });
  const tierSlots = fillAxis<CohortEngagementTierDto, number>(TIER_ORDER, tiers, {
    keyOf: (t) => t.tier,
    valueOf: (t) => t.count,
  });
  const pillarSlots = fillAxis<CohortPillarHeatmapDto, CohortPillarHeatmapDto>(
    PILLAR_AXIS,
    pillars,
    {
      keyOf: (p) => p.pillar,
      /* THE INVESTMENT PILLAR IS NEVER A READING (cohort.ts property 1). The
         scorer's input is a placeholder returning 0 for every farm, so the 0
         the server sends is not a measurement and must not be drawn as one.
         That is a fact about the CODE, not about this response, which is why
         it is keyed on the pillar rather than on the value. */
      valueOf: (p) => (PILLAR_BY_KEY.get(p.pillar)?.measurable === false ? null : p),
    },
  );
  const trendSlots = fillAxis<CohortWeeklyTrendDto, CohortWeeklyTrendDto>(trendAxis(weeks), weeks, {
    keyOf: (w) => w.weekStart,
    valueOf: (w) => w,
  });

  const tierTotal = measuredSlots(tierSlots).reduce((n, s) => n + s.value, 0);
  const trendMeasured = measuredSlots(trendSlots).length;
  const pillarsMeasured = measuredSlots(pillarSlots).length;

  /* ── the sentence every empty block on this screen shares ─────────────── */

  function unprovenBecause(where: string, line: string): ReactNode {
    return (
      <>
        <p>
          {where} answers its own database failures with an empty result and a success code (
          <code>catch {'{ }'}</code>, <code>{line}</code>), so a broken query and a genuinely empty
          cohort arrive here looking the same.
        </p>
        <p className="mt-2">
          There is a second reason not to call this a measured zero, and it belongs to this screen:{' '}
          <b>the view behind it has never been populated in production</b>. It is created{' '}
          <code>WITH NO DATA</code> and the nightly job refreshes <code>CONCURRENTLY</code>, which
          cannot fill an empty view; the one-time repair is deployment task <b>D3</b>, recorded as
          not live. This feed also sends no timestamp, so this screen cannot even say when it
          looked.
        </p>
      </>
    );
  }

  /* ── the words for the queue's two empties (A36) ──────────────────────── */

  const queueEmpty = isEmpty ? INTERVENTION_EMPTY.understated : INTERVENTION_EMPTY.normal;

  return (
    <div className="flex flex-col gap-6">
      {/* ── band 1: who this is about, and what it is ─────────────────── */}
      <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
        <div className="min-w-0 flex-1">
          <h1 className="flex items-center gap-2 text-h1 font-bold text-text-1">
            <HeartPulse size={20} strokeWidth={2} aria-hidden="true" className="text-text-2" />
            Farmer Health
          </h1>
          {/*
            A39 — THE ONLY PLACE IN THE CONSOLE THAT NAMES THE TENANT IN A
            SENTENCE ABOUT THE DATA. Task 10 moved the org name to the topbar,
            and this page keeps its own because it is the page where scope
            matters most. Property (E) is why it branches: for a platform admin
            the scope join is skipped and the figures are platform-wide, so
            naming an organisation here would be false for exactly the reader
            most likely to be looking.
          */}
          <p data-scope-line="" className="mt-1 text-body text-text-2">
            {platformWide ? (
              <>
                Every scored farm <b>on the platform</b>. Your role is platform-level, so this feed
                is not narrowed by the organisation named in the top bar &mdash; the scope filter is
                skipped for platform admins, and these figures cover every organisation.
              </>
            ) : orgName ? (
              <>
                Every scored farm in <b>{orgName}</b>. This feed is genuinely scoped: each query
                joins the org-to-farm projection, so a farm outside your organisation cannot appear
                below.
              </>
            ) : (
              <>
                No active organization. This feed is scoped by organisation, so until one is
                resolved there is nothing it can be asked for.
              </>
            )}
          </p>
          <p className="mt-1 text-caption text-text-3">
            A habit score out of {fmt.num(SCORE_MAX)} built from six pillars with unequal weights.{' '}
            <b>{fmt.num(INTERVENTION_AT)} or below</b> puts a farmer in the intervention queue;{' '}
            <b>
              {fmt.num(WATCHLIST_FROM)}&ndash;{fmt.num(WATCHLIST_TO)}
            </b>{' '}
            puts them on the watchlist. One of the six pillars has never been computed, so the
            highest score any farm can currently reach is <b>{fmt.num(SCORE_REACHABLE)}</b>, not{' '}
            {fmt.num(SCORE_MAX)} &mdash; and the thresholds are absolute, so they were not adjusted
            for it.
          </p>
        </div>
        {/* B7 / A29 — v3 has no farmer search at all. */}
        <FarmerSearchBox />
      </div>

      {/*
        NO FRESHNESS CHIP, AND THAT IS THE HONEST STATE (property B). Every
        other screen puts one here. This endpoint sends no envelope, so there
        is no `meta.lastRefreshedUtc` to read — and a chip may only state an
        age it actually has.
      */}
      <p data-no-clock="" className="text-caption text-text-3">
        This feed sends no timestamp, so nothing on this screen can say how old it is. The scores
        come from a view rebuilt nightly, so they can be up to a day behind; the queue&rsquo;s
        last-active column is read live and is not.
      </p>

      {/* A41 — a retryable failure, at the top, through the unwrapping ladder. */}
      {error != null && (
        <LoadFailed
          error={error}
          onRetry={() => {
            void refetch();
          }}
          what="Farmer Health"
        />
      )}

      {/* A35 — MANDATORY C5 COPY, VERBATIM, fired by the cross-surface sum. */}
      {isEmpty && (
        <div className="flex flex-col gap-3">
          <ScoringActiveBanner />
          {/*
            The banner's words are not touched. What is added is the thing the
            banner cannot rule out (property D): in production the far more
            likely reading of an empty cohort is a view that was never
            populated. Two statements side by side, rather than one quietly
            standing for both.
          */}
          <NotMeasuredPanel
            title="…and this console cannot confirm that scoring has started"
            why={
              <>
                <p>
                  Nothing has been scored: the queue is empty, the watchlist is empty, and every one
                  of the ten score bins is zero. That is what a first deploy looks like &mdash; and
                  it is also exactly what an unpopulated view looks like, and what seven swallowed
                  database failures look like, because all three arrive as an empty result with HTTP
                  200.
                </p>
                <p className="mt-2">
                  The score view is created <code>WITH NO DATA</code> and the nightly job refreshes{' '}
                  <code>CONCURRENTLY</code>, which cannot populate an empty view. The one-time
                  repair is deployment task <b>D3</b>, recorded as not live. Until it runs, an empty
                  screen here is expected and is not evidence about any farmer.
                </p>
              </>
            }
          />
        </div>
      )}

      {/* ── band 2: who needs a person ───────────────────────────────────── */}
      <section className="flex flex-col gap-3" aria-labelledby="fh-queue-head">
        <h2 id="fh-queue-head" className="text-h2 font-bold text-text-1">
          Intervention queue
        </h2>
        <p className="text-caption text-text-2">
          Farms scoring {fmt.num(INTERVENTION_AT)} or below in the most recent scored week. A farm
          that did nothing at all is scored too &mdash; the view cross-joins every farm with every
          week and fills the missing inputs with zeros &mdash; so this list mixes farmers who are
          struggling with farmers who never started, and it carries nothing that tells them apart. A
          farm flagged for gaming also lands here, because a suspicion penalty of 30 points is
          applied before the band is decided.
        </p>
        <DataList<CohortBucketDto>
          id="fh-queue"
          /*
            THE COLLISION, HANDLED. Two lists on one page, so each owns its own
            `page`/`sort`/`dir`/`open` (T20). Task 20 proved the failure by
            removing the namespaces: one header click reordered another table.
            It also closes A30's other half — the queue's sort used to be
            component-local state and died on every refresh; it is in the url
            now, so a shared link restores the order it was shared in.
          */
          urlNamespace="queue"
          label="Intervention queue"
          caption="Farms in the intervention band, with their score, the change on the previous scored week and when they were last active. Each row opens that farm's drilldown."
          noun={{ one: 'farm', many: 'farms' }}
          rows={queue}
          rowKey={(r) => r.farmId}
          columns={bucketColumns()}
          /* A30 — score ASC, worst first, with the tiebreak on the column.
             v3's rule is carried too: NO leading edge on these rows. Every row
             here already needs a person, so an edge on all of them would be
             decoration rather than a finding. */
          defaultSort={{ key: 'score', dir: 'asc' }}
          skeleton={{ rows: 6, cells: 5 }}
          states={{
            isLoading,
            isFetching,
            error: null,
            onRetry: () => {
              void refetch();
            },
            measuredZero: {
              /* A36 — the two truths, read from the one place they are
                 defined (`INTERVENTION_EMPTY`), so the byte-asserted copy in
                 `honestStates.test.tsx` and the copy this screen renders
                 cannot drift apart. */
              what: queueEmpty.message,
              checkedAt: NO_SERVER_CLOCK,
              unproven: (
                <>
                  {queueEmpty.hint && <p className="mb-2">{queueEmpty.hint}</p>}
                  {unprovenBecause('This query', 'AdminCohortPatternsRepository.cs:169')}
                </>
              ),
            },
          }}
        />
        <p className="text-caption text-text-3">
          &Delta; wk is the change against the previous scored week &mdash; but a farm with no
          previous row has its own score subtracted from itself, so <b>a delta of exactly 0 can
          mean &ldquo;no change&rdquo; or &ldquo;first week on this view&rdquo;</b>, and this feed
          does not say which. Last active is the newest <code>log.created</code> event; a farm with
          none is given a timestamp thirty days old by the query rather than left empty, so a date
          near that age may be a substitution rather than a reading.
          {queue.length >= QUEUE_LIMIT && (
            <>
              {' '}
              The server caps this list at {fmt.num(QUEUE_LIMIT)} rows and sent{' '}
              {fmt.num(QUEUE_LIMIT)}, ordered by score ascending, so this is the worst{' '}
              {fmt.num(QUEUE_LIMIT)} and not the whole band.
            </>
          )}
        </p>
      </section>

      {/* ── band 3: the cohort ───────────────────────────────────────────── */}
      <section className="flex flex-col gap-4" aria-labelledby="fh-cohort-head">
        <h2 id="fh-cohort-head" className="text-h2 font-bold text-text-1">
          The cohort
        </h2>

        <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
          {/* B8 (1 of 2) — a chart v3 never draws. */}
          <Panel>
            <ChartShell<number>
              id="fh-score-distribution"
              title="Score distribution"
              subtitle={
                <span className="text-caption text-text-2">
                  {fmt.num(scoredFarms)} scored {scoredFarms === 1 ? 'farm' : 'farms'}, in ten fixed
                  bins
                </span>
              }
              /* A33 — the bins are FIXED and a zero-yield bin keeps its place,
                 so the histogram cannot change shape between two refreshes
                 that measured the same cohort. An all-zero histogram is not a
                 shape at all: it is what a swallowed failure looks like
                 (property C), so it goes to the unproven panel rather than
                 drawing ten empty bars. */
              slots={scoredFarms === 0 ? [] : binSlots}
              slotNoun={{ one: 'bin', many: 'bins' }}
              dataTable={BIN_TABLE}
              states={{
                isLoading,
                isFetching,
                error: null,
                onRetry: () => {
                  void refetch();
                },
                measuredZero: {
                  what: 'No farm has a score in the most recent week',
                  checkedAt: NO_SERVER_CLOCK,
                  unproven: unprovenBecause(
                    'This query builds all ten bins outside its own try block, and',
                    'AdminCohortPatternsRepository.cs:106',
                  ),
                },
              }}
            >
              <Sparkline<number>
                slots={binSlots}
                valueOf={(n) => n}
                label={`Score distribution across ten bins, ${fmt.num(scoredFarms)} farms in total`}
                size="lg"
                /* A CATEGORY AXIS HAS NO RECENCY. `faint={1}` turns the step
                   off: fading the 0-10 bin because it is "oldest" would state
                   a fact about time that a histogram does not carry. */
                faint={1}
                /* The colour IS the band boundary — red to 40, amber to 60,
                   green above — which is the information the old chart's raw
                   hex ramp carried and a single-tone series would drop. */
                toneOf={(slot) => binTone(slot.key)}
              />
            </ChartShell>
          </Panel>

          {/* B8 (2 of 2) — the other chart v3 never draws. */}
          <Panel>
            <ChartShell<number>
              id="fh-engagement-tiers"
              title="Engagement tiers"
              subtitle={
                <span className="text-caption text-text-2">
                  {fmt.num(tierTotal)} {tierTotal === 1 ? 'farm' : 'farms'} &middot; a different
                  view, at a different week
                </span>
              }
              slots={tierTotal === 0 ? [] : tierSlots}
              slotNoun={{ one: 'tier', many: 'tiers' }}
              dataTable={tierTable(tierTotal)}
              states={{
                isLoading,
                isFetching,
                error: null,
                onRetry: () => {
                  void refetch();
                },
                measuredZero: {
                  what: 'No farm carries an engagement tier',
                  checkedAt: NO_SERVER_CLOCK,
                  unproven: unprovenBecause('This query', 'AdminCohortPatternsRepository.cs:199'),
                },
              }}
            >
              <TierProportions slots={tierSlots} total={tierTotal} />
            </ChartShell>
            <p className="mt-2 text-caption text-text-3">
              Tiers are read from the WVFD view at <i>its</i> newest week, while every other figure
              on this screen comes from the score view at <i>its</i> newest week &mdash; two views,
              two clocks. A farm with no tier recorded is counted as <b>D</b> by the query, so the
              worst tier absorbs the unmeasured ones.
            </p>
          </Panel>

          <Panel>
            <ChartShell<CohortPillarHeatmapDto>
              id="fh-pillars"
              title="Where the cohort loses points"
              subtitle={
                <span className="text-caption text-text-2">
                  {pillarsMeasured} of {PILLARS.length} pillars measured
                </span>
              }
              slots={pillars.length === 0 ? [] : pillarSlots}
              slotNoun={{ one: 'pillar', many: 'pillars' }}
              dataTable={PILLAR_TABLE}
              states={{
                isLoading,
                isFetching,
                error: null,
                onRetry: () => {
                  void refetch();
                },
                measuredZero: {
                  what: 'No pillar has a cohort average',
                  checkedAt: NO_SERVER_CLOCK,
                  unproven: unprovenBecause(
                    'Each pillar is queried separately and a failed one falls through to a complete row of zeros; the loop',
                    'AdminCohortPatternsRepository.cs:246',
                  ),
                },
              }}
            >
              <PillarBars slots={pillarSlots} />
            </ChartShell>
            <p className="mt-2 text-caption text-text-3">
              <b>Investment has never been computed.</b> Its input in the scorer is a placeholder
              returning 0 for every farm, so the 0 the server sends is the placeholder and a
              &ldquo;failing&rdquo; count for it would be every farm on the platform. It is drawn as
              an absence, and it is the reason the reachable maximum above is{' '}
              {fmt.num(SCORE_REACHABLE)}. Failing is the scorer&rsquo;s own flag at half a
              pillar&rsquo;s weight; a cohort average of exactly 0.0 on any pillar is also what a
              failed query for that pillar returns.
            </p>
          </Panel>

          <Panel>
            <ChartShell<CohortWeeklyTrendDto>
              id="fh-weekly-trend"
              title="Cohort average score, by week"
              subtitle={
                <span className="text-caption text-text-2">
                  {trendMeasured} of {trendSlots.length} weeks have a row
                </span>
              }
              slots={trendSlots}
              slotNoun={{ one: 'week', many: 'weeks' }}
              dataTable={TREND_TABLE}
              states={{
                isLoading,
                isFetching,
                error: null,
                onRetry: () => {
                  void refetch();
                },
                measuredZero: {
                  what: 'No week carries a cohort average',
                  checkedAt: NO_SERVER_CLOCK,
                  unproven: unprovenBecause('This query', 'AdminCohortPatternsRepository.cs:270'),
                },
              }}
            >
              <Sparkline<CohortWeeklyTrendDto>
                slots={trendSlots}
                valueOf={(w) => w.avgScore}
                label={`Cohort average score across ${trendSlots.length} weeks, oldest first`}
                size="lg"
                toneOf={(slot) => bandTone(slot.value.avgScore / SCORE_MAX)}
              />
            </ChartShell>
            <p className="mt-2 text-caption text-text-3">
              The axis runs from the oldest week this feed returned to the newest, because the
              response carries no timestamp to anchor a window to. A week missing from either{' '}
              <i>end</i> therefore cannot be shown &mdash; only holes between two returned weeks
              are. Three of the six pillars are joined without a week at all, so a farm&rsquo;s
              Action simplicity, Repeat and suspicion are the same in every week here, and this line
              can only move on Trigger fit, Proof and Reward. The farm count is every farm with any
              event in the last twelve weeks, not the farms that logged that week.
            </p>
          </Panel>
        </div>
      </section>

      {/* ── band 4: the watchlist, collapsed ─────────────────────────────── */}
      <section className="flex flex-col gap-3" aria-labelledby="fh-watch-head">
        <h2 id="fh-watch-head" className="text-h2 font-bold text-text-1">
          Watchlist
        </h2>
        <p className="text-caption text-text-2">
          Farms scoring {fmt.num(WATCHLIST_FROM)}&ndash;{fmt.num(WATCHLIST_TO)} &mdash; the band
          above the intervention queue.
        </p>
        <DataList<CohortBucketDto>
          id="fh-watch"
          urlNamespace="watch"
          label="Watchlist"
          caption="Farms in the watchlist band, ordered by the size of their drop against the previous scored week."
          noun={{ one: 'farm', many: 'farms' }}
          rows={watchlist}
          rowKey={(r) => r.farmId}
          columns={bucketColumns()}
          /**
           * A31 — A PRODUCT DECISION, NOT A PREFERENCE.
           *
           * The order is FIXED at `weeklyDelta` ascending, which is biggest
           * drop first, and the reader cannot change it. v3 makes every table
           * sortable (`data-sortable data-sort-default="1:asc"` on both queue
           * and watchlist), and porting that would silently convert a decision
           * into a setting: the list would open on whatever the last reader
           * left in the url, and "the farms falling fastest" would stop being
           * what the panel means. `DataList` renders no sort controls at all
           * when this is set, so the shared column set cannot leak the queue's
           * sortability in here.
           *
           * `because` is on screen for the same reason: an order the reader
           * cannot change and cannot explain is an order they assume is
           * arbitrary.
           */
          fixedSort={{
            key: 'weeklyDelta',
            dir: 'asc',
            because: 'Fixed order: biggest drop first. This list is deliberately not sortable.',
          }}
          /* A31 — collapsed by default. `DataList`'s summary-first mode owns
             the disclosure, with `aria-expanded` and `aria-controls` on the
             control (`SummaryFacets.tsx:154-155`) and `?watch.open=1` in the
             url, so the state survives a refresh. */
          collapsible={{
            defaultOpen: false,
            summary: (rows) => <WatchlistSummary rows={rows} />,
          }}
          /* v3's rule, and here it earns its keep: the edge marks the subset
             still falling, which is the subset worth a call this week. */
          rowEdge={(r) => (r.weeklyDelta < 0 ? 'amber' : null)}
          skeleton={{ rows: 6, cells: 5 }}
          states={{
            isLoading,
            isFetching,
            error: null,
            onRetry: () => {
              void refetch();
            },
            measuredZero: {
              what: isEmpty
                ? 'No farms in the watchlist band yet.'
                : 'No farms in the watchlist band.',
              checkedAt: NO_SERVER_CLOCK,
              unproven: (
                <>
                  {!isEmpty && (
                    <p className="mb-2">
                      No scored farm sat between {fmt.num(WATCHLIST_FROM)} and{' '}
                      {fmt.num(WATCHLIST_TO)} in the most recent scored week.
                    </p>
                  )}
                  {unprovenBecause('This query', 'AdminCohortPatternsRepository.cs:169')}
                </>
              ),
            },
          }}
        />
        {watchlist.length >= WATCHLIST_LIMIT && (
          <p className="text-caption text-text-3">
            The server caps this list at {fmt.num(WATCHLIST_LIMIT)} rows and sent{' '}
            {fmt.num(WATCHLIST_LIMIT)}, ordered by <i>score</i> ascending before the cap. So
            &ldquo;biggest drop first&rdquo; orders the lowest-scoring {fmt.num(WATCHLIST_LIMIT)}{' '}
            farms, not the whole band &mdash; a farm near the top of the band with a large drop can
            be outside this list entirely.
          </p>
        )}
      </section>

      <StandingNote
        title="What this screen cannot tell you"
        why={
          <>
            <p>
              <b>How old any of it is.</b> These two endpoints are the only admin endpoints that
              return no response envelope, so there is no <code>lastRefreshed</code> to read and no
              freshness chip to draw. The scores are rebuilt nightly at best.
            </p>
            <p className="mt-2">
              <b>Whether a farmer is struggling or absent.</b> The score view cross-joins every farm
              with every week and fills missing inputs with zeros, so an inactive farm and a failing
              farm produce the same low number. The scorer computes an{' '}
              <code>insufficient_data</code> flag for exactly this, and the cohort payload does not
              carry it.
            </p>
            <p className="mt-2">
              <b>Who the farmer is, safely.</b> The handler calls the redactor, but the redactor
              does not recurse into collections and no role&rsquo;s policy names{' '}
              <code>farmerName</code>, so names arrive unmasked for every admin who can open this
              screen. This screen renders them redaction-tolerantly &mdash; a withheld name shows
              the farm id and never a marker &mdash; but that is a client that is ready, not a
              server that is masking.
            </p>
          </>
        }
      />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════ small pieces ═══ */

function Panel({ children }: { children: ReactNode }) {
  return <div className="glass-panel rounded-panel p-5">{children}</div>;
}

/** The band a score bin sits in, read from its own label — '41-50' -> amber. */
function binTone(bucket: string): SparkTone {
  const lo = Number.parseInt(bucket.split('-')[0] ?? '0', 10);
  if (!Number.isFinite(lo)) return 'grey';
  if (lo <= INTERVENTION_AT) return 'red';
  if (lo <= WATCHLIST_TO) return 'amber';
  return 'green';
}

const BIN_TABLE: ChartDataTable<number> = {
  caption: 'Number of farms in each ten-point score bin, for the most recent scored week.',
  slotHeader: 'Score bin',
  columns: [{ key: 'count', label: 'Farms', align: 'right', value: (n) => fmt.num(n) }],
};

function tierTable(total: number): ChartDataTable<number> {
  return {
    caption: 'Number and share of farms in each engagement tier, A to D.',
    slotHeader: 'Tier',
    columns: [
      { key: 'count', label: 'Farms', align: 'right', value: (n) => fmt.num(n) },
      {
        key: 'share',
        label: 'Share',
        align: 'right',
        /* A share of a total that is itself zero is not 0% — there is nothing
           to take a share OF, and printing 0% would be a figure about farms
           that do not exist. */
        value: (n) => (total > 0 ? fmt.pct((n / total) * 100, 0) : <NotMeasured />),
      },
    ],
  };
}

const PILLAR_TABLE: ChartDataTable<CohortPillarHeatmapDto> = {
  caption:
    'Cohort average and failing-farm count for each of the six DWC pillars, against the weight each pillar carries.',
  slotHeader: 'Pillar',
  columns: [
    {
      key: 'weight',
      label: 'Weight',
      align: 'right',
      value: (_p, slot) => fmt.num(PILLAR_BY_KEY.get(slot.key)?.max ?? null),
    },
    { key: 'avg', label: 'Average', align: 'right', value: (p) => fmt.num(p.avgScore, 1) },
    { key: 'failing', label: 'Failing', align: 'right', value: (p) => fmt.num(p.failingFarmsCount) },
  ],
};

const TREND_TABLE: ChartDataTable<CohortWeeklyTrendDto> = {
  caption: 'Cohort average DWC score and the farm count it was taken over, week by week.',
  slotHeader: 'Week',
  columns: [
    { key: 'avg', label: 'Average score', align: 'right', value: (w) => fmt.num(w.avgScore, 1) },
    { key: 'farms', label: 'Farms', align: 'right', value: (w) => fmt.num(w.farmCount) },
  ],
};

const TIER_FILL: Record<string, string> = {
  A: 'bg-green-vivid',
  B: 'bg-blue-vivid',
  C: 'bg-amber-vivid',
  D: 'bg-red-vivid',
};

/**
 * THE DONUT, AS A PROPORTION BAR.
 *
 * It answers the one question a four-slice donut answers — what share of the
 * cohort sits in each tier — on the same FIXED A-D axis (A33), and unlike a
 * donut it can show a tier that was never measured: an absence has no angle.
 */
function TierProportions({ slots, total }: { slots: readonly AxisSlot<number>[]; total: number }) {
  return (
    <div className="flex flex-col gap-3">
      <div
        role="img"
        aria-label={`Engagement tier split across ${fmt.num(total)} farms`}
        className="flex h-6 w-full overflow-hidden rounded-chip border border-line"
      >
        {slots.map((slot) =>
          isGap(slot) ? (
            <div key={slot.key} className="h-full flex-1">
              <GapBar label={`Tier ${slot.label}`} why={slot.why} />
            </div>
          ) : (
            <div
              key={slot.key}
              data-tier={slot.key}
              title={`Tier ${slot.label}: ${fmt.num(slot.value)}`}
              className={cn('h-full', TIER_FILL[slot.key] ?? 'bg-edge-grey')}
              style={{ width: total > 0 ? `${(slot.value / total) * 100}%` : '0%' }}
            />
          ),
        )}
      </div>
      <ul className="flex flex-wrap gap-x-5 gap-y-1">
        {slots.map((slot) => (
          <li key={slot.key} className="flex items-center gap-2 text-caption text-text-2">
            <span
              aria-hidden="true"
              className={cn('h-3 w-3 rounded-chip', TIER_FILL[slot.key] ?? 'bg-edge-grey')}
            />
            <b className="text-text-1">{slot.label}</b>
            {isGap(slot) ? (
              <NotMeasured state={slot.why} />
            ) : (
              <span className="font-mono tabular-nums">
                {fmt.num(slot.value)}
                {total > 0 && (
                  <span className="text-text-3">
                    {' '}
                    &middot; {fmt.pct((slot.value / total) * 100, 0)}
                  </span>
                )}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Six horizontal bars at their UNEQUAL maxima, on the fixed pillar axis. */
function PillarBars({ slots }: { slots: readonly AxisSlot<CohortPillarHeatmapDto>[] }) {
  return (
    <ul className="flex flex-col gap-2.5">
      {slots.map((slot) => {
        const meta = PILLAR_BY_KEY.get(slot.key);
        const max = meta?.max ?? 0;
        const ratio = isGap(slot) || max <= 0 ? 0 : slot.value.avgScore / max;
        const tone = bandTone(ratio);
        return (
          <li key={slot.key} className="flex items-center gap-3 text-caption">
            <span className="w-36 shrink-0 font-semibold text-text-1">{slot.label}</span>
            <span className="relative flex h-3 flex-1 overflow-hidden rounded-chip bg-wash">
              {isGap(slot) ? (
                <GapBar label={slot.label} why={slot.why} />
              ) : (
                <span
                  data-tone={tone}
                  className={cn('block h-full rounded-chip', barClass(tone))}
                  style={{ width: `${Math.min(100, Math.max(0, ratio * 100))}%` }}
                />
              )}
            </span>
            <span className="w-24 shrink-0 text-right font-mono tabular-nums text-text-2">
              {isGap(slot) ? (
                <NotMeasured state={slot.why} why={meta?.why} />
              ) : (
                <>
                  {fmt.num(slot.value.avgScore, 1)}
                  <span className="text-text-3"> / {fmt.num(max)}</span>
                </>
              )}
            </span>
            <span className="w-24 shrink-0 text-right font-mono tabular-nums text-text-3">
              {isGap(slot)
                ? ''
                : slot.value.failingFarmsCount > 0
                  ? `${fmt.num(slot.value.failingFarmsCount)} failing`
                  : '—'}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function barClass(tone: SparkTone): string {
  if (tone === 'red') return 'bg-red-vivid';
  if (tone === 'amber') return 'bg-amber-vivid';
  /* C7 — a healthy pillar tops out at TEAL. Success never reaches bright
     green, so a good reading can never be mistaken for a celebration (A37). */
  return 'bg-pillar-good';
}

/** The summary a collapsed watchlist shows instead of its rows. */
function WatchlistSummary({ rows }: { rows: CohortBucketDto[] }) {
  const falling = rows.filter((r) => r.weeklyDelta < 0).length;
  return (
    <p>
      {falling === 0
        ? 'None of them is still falling.'
        : `${fmt.num(falling)} of them ${falling === 1 ? 'is' : 'are'} still falling, and ${
            falling === 1 ? 'it carries' : 'they carry'
          } the amber edge.`}
    </p>
  );
}
