import { Link, useParams } from 'react-router-dom';
import { AlertTriangle, ChevronLeft, HeartPulse, Lock } from 'lucide-react';
import { useAdminScope } from '@/hooks/useAdminScope';
import { ModuleKeys } from '@/lib/moduleKeys';
import type { Bucket } from './farmer-health.types';
import { useFarmerHealth } from './hooks/useFarmerHealth';
import { EmptyState, ErrorState, LoadingState } from './components/EmptyAndErrorStates';
import { DwcScoreCard } from './components/DwcScoreCard';
import { FarmerTimeline } from './components/FarmerTimeline';
import { WorkerSummaryList } from './components/WorkerSummaryList';
import { SyncStateBlock } from './components/SyncStateBlock';
import { AiHealthBlock } from './components/AiHealthBlock';

/**
 * Mode A — per-farmer drilldown (DWC v2 §4.5; UI brief §4 — five bands).
 *
 *   Band 1 — Drilldown header (back link + name + farmId + bucket badge,
 *            suspicious-flag banner if score.flag === 'suspicious')
 *   Band 2 — DwcScoreCard (big total + 6 pillar bars)
 *   Band 3 — FarmerTimeline (14-day × 6-event heatmap)
 *   Band 4 — WorkerSummaryList (WTL v0 — name + count + first seen)
 *   Band 5 — Ops sections (gated by canRead(OpsLive); placeholder if not)
 *
 * `ops:read` claim → mapped to `ModuleKeys.OpsLive` per the admin-web
 * scope model (see useAdminScope.ts + moduleKeys.ts). Scope still loading
 * is treated as "no access" so we never render server-redacted nulls
 * pretending to be data.
 */

const HAS_DEVANAGARI = /[ऀ-ॿ]/;

function fontFor(name: string): string {
  return HAS_DEVANAGARI.test(name)
    ? "'Noto Sans Devanagari', sans-serif"
    : "'DM Sans', sans-serif";
}

const BUCKET_TONE: Record<Bucket, { bg: string; fg: string; label: string }> = {
  intervention: { bg: 'rgba(220,38,38,0.14)',  fg: '#dc2626', label: 'Intervention' },
  watchlist:    { bg: 'rgba(245,158,11,0.18)', fg: '#b45309', label: 'Watchlist' },
  healthy:      { bg: 'rgba(82,192,190,0.16)', fg: '#0e7d7b', label: 'Healthy' },
};

export default function FarmerHealthDrilldown() {
  const { farmId } = useParams<{ farmId: string }>();
  const { data, isLoading, error, refetch } = useFarmerHealth(farmId);
  const { canRead } = useAdminScope();
  const hasOpsRead = canRead(ModuleKeys.OpsLive);

  // Band 1 always renders — preserves context across loading/error/empty.
  const farmer = data?.data;
  const farmerName = farmer?.farmerName?.trim() || (farmId ?? 'Farmer Health');
  const tone = farmer ? BUCKET_TONE[farmer.score.bucket] : null;
  const isSuspicious = farmer?.score.flag === 'suspicious';

  return (
    <div className="flex flex-col gap-5">
      {/* ── Band 1 — Drilldown header ─────────────────────────────────── */}
      <div className="px-1">
        <Link
          to="/farmer-health"
          className="inline-flex items-center gap-1 rounded-sm text-[12px] font-bold text-text-muted hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-teal"
        >
          <ChevronLeft size={14} /> All farmers
        </Link>
      </div>

      <div className="flex items-center gap-3 px-1">
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-[#7c3aed] to-[#52c0be] text-white shadow-[0_4px_12px_rgba(124,58,237,0.4)]">
          <HeartPulse size={18} strokeWidth={2.5} />
        </span>
        <div className="min-w-0">
          <h1
            className="truncate text-2xl font-extrabold tracking-tight text-text-primary"
            style={{ fontFamily: fontFor(farmerName) }}
          >
            {farmerName}
          </h1>
          <div className="flex flex-wrap items-center gap-2 text-[12px] text-text-muted">
            <span>
              Farm ID: <span className="font-mono tabular-nums text-text-secondary">{farmId}</span>
            </span>
            {tone && (
              <>
                <span aria-hidden>·</span>
                <span>Bucket:</span>
                <span
                  className="inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-[0.08em]"
                  style={{ background: tone.bg, color: tone.fg }}
                >
                  {tone.label}
                </span>
              </>
            )}
          </div>
        </div>
      </div>

      {isSuspicious && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-[color:rgba(220,38,38,0.4)] bg-[color:rgba(220,38,38,0.08)] px-4 py-3 text-[13px] text-text-primary"
        >
          <AlertTriangle size={16} className="mt-0.5 text-danger" aria-hidden />
          <div>
            <div className="font-extrabold text-danger">This farm shows gaming signals.</div>
            <div className="mt-0.5 text-[12px] text-text-secondary">
              Review before drawing conclusions — closure cadence, proof rate, or worker overlap is unusual.
            </div>
          </div>
        </div>
      )}

      {/* ── Page-level state branches ─────────────────────────────────── */}
      {error && <ErrorState error={error} onRetry={() => { void refetch(); }} />}

      {isLoading && (
        <>
          <LoadingState label="Loading DWC score" height={220} />
          <LoadingState label="Loading 14-day timeline" height={260} />
          <LoadingState label="Loading worker summary" height={180} />
        </>
      )}

      {!isLoading && !error && !farmer && (
        <EmptyState message="Farm not found in your scope." />
      )}

      {/* ── Bands 2–5 — only when we have data ────────────────────────── */}
      {!isLoading && !error && farmer && (
        <>
          {/* Band 2 */}
          <DwcScoreCard score={farmer.score} />

          {/* Band 3 */}
          <FarmerTimeline timeline={farmer.timeline} />

          {/* Band 4 */}
          <WorkerSummaryList workers={farmer.workerSummary} />

          {/* Band 5 — gated by ops:read (mapped to ModuleKeys.OpsLive). */}
          {hasOpsRead ? (
            <>
              <SyncStateBlock state={farmer.syncState} />
              <AiHealthBlock health={farmer.aiHealth} />
            </>
          ) : (
            <section
              className="glass-panel p-5"
              style={{ boxShadow: 'inset 4px 0 0 0 rgba(100, 116, 139, 0.55)' }}
              aria-label="Ops data hidden"
            >
              <div className="flex items-start gap-2.5">
                <span className="grid h-7 w-7 place-items-center rounded-md bg-surface-sidebar text-text-muted">
                  <Lock size={14} strokeWidth={2.4} aria-hidden />
                </span>
                <div>
                  <div className="text-sm font-extrabold text-text-primary">
                    Ops data hidden — requires <span className="font-mono">ops:read</span> permission.
                  </div>
                  <div className="mt-0.5 text-[12px] text-text-muted">
                    Sync posture and AI invocation health for this farm exist but are not visible at your role.
                  </div>
                </div>
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
