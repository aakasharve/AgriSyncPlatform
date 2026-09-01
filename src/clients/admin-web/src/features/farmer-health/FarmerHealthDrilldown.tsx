import { ChevronLeft, Lock } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { LoadFailed, LoadingState, NotMeasuredPanel } from '@/components/state';
import { PersonName } from '@/components/ui/PersonName';
import { useAdminScope } from '@/hooks/useAdminScope';
import { cn } from '@/lib/utils';
import { AiHealthBlock } from './components/AiHealthBlock';
import { DwcScoreCard } from './components/DwcScoreCard';
import { FarmerTimeline } from './components/FarmerTimeline';
import { OpsPanel } from './components/OpsPanel';
import { WorkerSummaryList } from './components/WorkerSummaryList';
import { SyncStateBlock } from './components/SyncStateBlock';
import {
  BUCKET,
  FLAG_NOTICE,
  OPS_BLOCKS,
  OPS_DENIED_AI,
  OPS_DENIED_BOTH,
  OPS_DENIED_SYNC,
  realName,
  scoreIsReadable,
} from './drilldown';
import { useFarmerHealth } from './hooks/useFarmerHealth';

/**
 * MODE A — THE PER-FARMER DRILLDOWN. Five bands, an in-page permission gate,
 * an honest partial-denial panel, and the only working row drilldown in the
 * console.
 *
 * 🛑 THE v3 DESIGN DOES NOT CONTAIN THIS SCREEN. `farmer-health.html` is flat:
 * a cohort landing and nothing behind it. Every capability below is therefore
 * invisible in a screenshot diff, and a design-led port deletes the lot while
 * the review looks clean. That is the whole reason this file is ported from
 * the running code rather than drawn from the mockup.
 *
 *   Band 1  header — back link, name, farm id, band badge, flag notice
 *   Band 2  DwcScoreCard      — the 64px total and six unequal pillars
 *   Band 3  FarmerTimeline    — 14 days × 6 event types, per-row scaled
 *   Band 4  WorkerSummaryList — top five names, and the red line around them
 *   Band 5  SyncStateBlock + AiHealthBlock, each behind its own grant
 *
 * ── A40 — BAND 1 RENDERS IN ALL FOUR BRANCHES ────────────────────────────
 * Error, loading, not-found and data are four separate branches, and the
 * header is OUTSIDE all four. A port that wraps the page in one loading
 * skeleton loses the reader's place: the farm id in the url is the only thing
 * telling them which farm failed, and it is not on screen unless this header
 * is. The back link in particular must survive an error — a dead end with no
 * way back is how somebody reloads the console.
 *
 * ── "Farm not found in your scope." IS A SCOPE STATEMENT, NOT A 404 ──────
 * Preserved verbatim, and now actually reachable. The server answers an
 * out-of-scope farm with `Results.NotFound()`
 * (`AdminFarmerHealthEndpoints.cs:70-72`), which arrives as an axios error, so
 * the old code showed a red failure panel for it and kept the scope sentence
 * for a case that essentially never happened — a 200 carrying no body. A 404
 * now takes the not-found branch, which is what the sentence was written for.
 *
 * 🛑 AND IT IS NOT ONLY A SCOPE STATEMENT. `IsFarmInScopeAsync` ends in
 * `catch { return false; }` (`AdminFarmerHealthRepository.cs:120`), so a
 * failed scope query is indistinguishable from a farm outside the caller's
 * organisation. The panel says both, because telling an admin their access is
 * missing when the database is simply down is a lie pointing the other way.
 *
 * ── A28 — `retry: 0` IS WHY THAT IS FAST ─────────────────────────────────
 * The hook overrides the console's global `retry: 1`. A 404 must fail on the
 * first attempt or the not-found path takes a doubled round trip and reads as
 * a slow console rather than as a wrong id. Do not "align it with the rest".
 *
 * ── A5 — THE IN-PAGE GATE ────────────────────────────────────────────────
 * A second, finer permission layer INSIDE a page that already passed a route
 * guard, and the only honest partial-denial UI in the app. Two properties are
 * load-bearing and both are asserted:
 *
 *  1. SCOPE-STILL-LOADING IS TREATED AS NO ACCESS. `canRead` returns false
 *     until the scope resolves (`useAdminScope.ts:86`). That is not a
 *     spinner and it must not become one: the ops sub-blocks arrive as
 *     `null` for a caller without the grant, and rendering them optimistically
 *     for the width of a request draws a server-redacted null as a measured
 *     empty.
 *  2. THE DENIAL IS NAMED, NOT SWALLOWED. The reader is told the data exists
 *     and that their role is why they cannot see it — which is a different
 *     fact from "there is nothing here", and the difference is the whole
 *     point of the panel.
 *
 * 🔴 The keys changed, and the repo is why. The plan and the old code gate on
 * `ModuleKeys.OpsLive`; the server gates the two blocks INDEPENDENTLY on
 * `ops.errors` and `ops.voice` (`AdminFarmerHealthRepository.cs:80-85`). See
 * property (1) in `./drilldown.ts` for what the mismatch did in each
 * direction. The gate is preserved; the keys now match the decision it is
 * mirroring.
 */

/** A 404 is not a failure to load — it is an answer. */
function isNotFound(error: unknown): boolean {
  const status = (error as { response?: { status?: number } } | null)?.response?.status;
  return status === 404;
}

export default function FarmerHealthDrilldown() {
  const { farmId } = useParams<{ farmId: string }>();
  const { data, isLoading, error, refetch } = useFarmerHealth(farmId);
  const { canRead } = useAdminScope();

  const farmer = data?.data;

  /* Both grants, read once. `canRead` is false while the scope is in flight —
     deliberately; see property 1 in this file's header. */
  const canSeeSync = canRead(OPS_BLOCKS.sync.module);
  const canSeeAi = canRead(OPS_BLOCKS.ai.module);

  const notFound = isNotFound(error);
  const failed = error != null && !notFound;
  const missing = !isLoading && !failed && (notFound || !farmer);

  const flag = farmer?.score.flag;
  const notice = flag && flag !== 'ok' ? FLAG_NOTICE[flag] : null;
  /* NO BADGE ON AN UNSCORED FARM. The server sends `bucket: "intervention"`
     inside its all-zero fallback row, so a badge keyed on the bucket alone
     puts a red verdict beside the name of a farm nobody has ever scored —
     which is the same fabrication Band 2 refuses, leaking into Band 1. */
  const band = farmer && scoreIsReadable(farmer.score) ? BUCKET[farmer.score.bucket] : null;

  return (
    <div className="flex flex-col gap-6">
      {/* ══ BAND 1 — outside every branch ═══════════════════════════════ */}
      <div data-band="header" className="flex flex-col gap-2">
        <Link
          to="/farmer-health"
          className="inline-flex w-fit items-center gap-1 rounded-chip text-[13px] font-semibold text-text-2 hover:text-text-1"
        >
          <ChevronLeft size={14} aria-hidden="true" /> All farmers
        </Link>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h1 className="min-w-0 text-[26px] font-semibold tracking-[-0.01em] text-text-1">
            {/*
              🔴 THE BUG THIS LINE EXISTED TO CARRY. It read
                `farmer?.farmerName?.trim() || (farmId ?? 'Farmer Health')`
              which falls back only on an EMPTY name — so a withheld name, the
              non-empty six-character string `**redacted**`, was printed into
              the page title. Tasks 5, 6 and 13 each found it and each
              correctly left it here. `PersonName` routes a withheld name
              through `Masked`, which shows the FALLBACK — the farm id — and
              never the marker.

              `realName` is the second half: the server answers its own
              identity-query failure with the literal string `—`
              (`AdminFarmerHealthRepository.cs:153-160`), which is a value, not
              an absence, and would otherwise render as a name made of one
              dash.
            */}
            <PersonName
              name={realName(farmer?.farmerName)}
              fallback={farmId}
              className="block truncate"
            />
          </h1>

          {band && (
            <span
              data-bucket={farmer?.score.bucket}
              className={cn(
                'inline-flex items-center rounded-chip px-2 py-0.5 text-[13px] font-semibold',
                band.className
              )}
            >
              {band.label}
            </span>
          )}
        </div>

        <p className="text-[13px] text-text-3">
          Farm ID <span className="tabular-nums text-text-2">{farmId}</span>
        </p>
      </div>

      {/* A35 / the flag — three of the four values reached the screen as
          nothing before this. `insufficient_data` is the one that matters
          most: it says the figures below are not a reading. */}
      {notice && (
        <div
          data-flag={flag}
          role={notice.role}
          className={cn(
            'rounded-panel px-4 py-3 text-[13px]',
            notice.role === 'alert' ? 'bg-tint-red text-text-1' : 'bg-tint-grey text-text-1'
          )}
        >
          <div className={cn('font-semibold', notice.role === 'alert' && 'text-red')}>
            {notice.title}
          </div>
          <p className="mt-0.5 text-text-2">{notice.body}</p>
        </div>
      )}

      {/* ══ BRANCH 1 — the request broke ════════════════════════════════ */}
      {failed && (
        <LoadFailed
          error={error}
          what="this farmer's health record"
          onRetry={() => {
            void refetch();
          }}
        />
      )}

      {/* ══ BRANCH 2 — still loading ════════════════════════════════════
          A32 — one LoadingState per band, each sized to its real content and
          each NAMED. Five panels announcing "loading" in the same words is the
          same as none of them announcing anything. */}
      {isLoading && (
        <>
          <LoadingState label="Loading DWC score" height={220} />
          <LoadingState label="Loading 14-day timeline" height={260} />
          <LoadingState label="Loading worker summary" height={180} />
        </>
      )}

      {/* ══ BRANCH 3 — the farm is not there, for one of two reasons ════ */}
      {missing && (
        <NotMeasuredPanel
          title="Farm not found in your scope."
          why={
            <>
              <p>
                Either this farm is not in your organisation&rsquo;s scope, or it does not exist.
                The server answers both the same way, so this console cannot tell you which.
              </p>
              <p className="mt-2">
                There is a third possibility and it is not a permissions problem at all: the scope
                check answers its own database failure with <code>false</code> (
                <code>catch &#123; return false; &#125;</code>), so a dropped connection reaches
                this screen looking exactly like a farm you may not see. If you expected this farm,
                retry before asking for a grant.
              </p>
            </>
          }
        />
      )}

      {/* ══ BRANCH 4 — the data ═════════════════════════════════════════ */}
      {!isLoading && !failed && farmer && (
        <>
          <DwcScoreCard score={farmer.score} />
          <FarmerTimeline timeline={farmer.timeline ?? []} />
          <WorkerSummaryList workers={farmer.workerSummary ?? []} />

          {/* ── BAND 5 — behind the gate ─────────────────────────────── */}
          {canSeeSync && <SyncStateBlock state={farmer.syncState} />}
          {canSeeAi && <AiHealthBlock health={farmer.aiHealth} />}
          {(!canSeeSync || !canSeeAi) && (
            <OpsDenied canSeeSync={canSeeSync} canSeeAi={canSeeAi} />
          )}
        </>
      )}
    </div>
  );
}

/* ══════════════════════════════════ the only honest partial denial we have ═ */

/**
 * 🛑 THE COPY IN `OPS_DENIED_BOTH` IS VERBATIM and is asserted
 * character-for-character. Do not reword it here; it lives in
 * `./drilldown.ts` so that the assertion and the render read the same string.
 *
 * The one-sided sentences are separate because the verbatim one names BOTH
 * blocks, and claiming a block is hidden while it is rendered three inches
 * below is the same class of untrue sentence this port exists to delete.
 */
function OpsDenied({ canSeeSync, canSeeAi }: { canSeeSync: boolean; canSeeAi: boolean }) {
  const both = !canSeeSync && !canSeeAi;
  const message = both ? OPS_DENIED_BOTH : canSeeAi ? OPS_DENIED_SYNC : OPS_DENIED_AI;
  const needed: string[] = [];
  if (!canSeeSync) needed.push(OPS_BLOCKS.sync.module);
  if (!canSeeAi) needed.push(OPS_BLOCKS.ai.module);

  return (
    /* Through `OpsPanel`, so C8's slate inset edge keeps ONE home. The denial
       is ops-side data too — it is a statement about the privileged blocks —
       and it carries the same edge for the same reason. */
    <OpsPanel title="Ops data hidden" grant={needed.join(' and ')} denied>
      <div className="flex items-start gap-2.5">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-chip bg-wash text-text-3">
          <Lock size={14} strokeWidth={2.2} aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <p data-denial-copy="" className="text-[13px] text-text-1">
            {message}
          </p>
          <p className="mt-1 text-[13px] text-text-3">
            The design calls this one <code>ops:read</code> claim; the server evaluates it as two
            separate grants, one per block, so ask for the ones named above rather than for
            &ldquo;ops&rdquo;.
          </p>
        </div>
      </div>
    </OpsPanel>
  );
}
