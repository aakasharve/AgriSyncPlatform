import { Link, useParams } from 'react-router-dom';
import { ChevronLeft, HeartPulse } from 'lucide-react';
import { useFarmerHealth } from './hooks/useFarmerHealth';
import { EmptyState, ErrorState, LoadingState } from './components/EmptyAndErrorStates';

/**
 * Mode A — per-farmer drilldown (DWC v2 §4.5).
 *
 * STUB scaffold for Phase D Tasks 2 + 3. The full 5-band layout
 * (DwcScoreCard, FarmerTimeline, WorkerSummaryList, SyncStateBlock,
 * AiHealthBlock) is built out in Phase D Task 4 (§4.5). This stub renders
 * the back link, a header, and the loading / error / empty states so the
 * `/farmer-health/:farmId` route resolves and the search-box navigation
 * round-trip works end-to-end before D.4 lands.
 */
export default function FarmerHealthDrilldown() {
  const { farmId } = useParams<{ farmId: string }>();
  const { data, isLoading, error, refetch } = useFarmerHealth(farmId);

  return (
    <div className="flex flex-col gap-5">
      <div className="px-1">
        <Link
          to="/farmer-health"
          className="inline-flex items-center gap-1 text-[12px] font-bold text-text-muted hover:text-text-primary"
        >
          <ChevronLeft size={14} /> All farmers
        </Link>
      </div>

      <div className="flex items-center gap-2 px-1">
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-[#7c3aed] to-[#52c0be] text-white shadow-[0_4px_12px_rgba(124,58,237,0.4)]">
          <HeartPulse size={18} strokeWidth={2.5} />
        </span>
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-text-primary">
            {data?.data?.farmerName ?? (farmId ?? 'Farmer Health')}
          </h1>
          <div className="text-[12px] text-text-muted">
            Farm ID: <span className="font-mono tabular-nums">{farmId}</span>
          </div>
        </div>
      </div>

      {error && <ErrorState error={error} onRetry={() => { void refetch(); }} />}
      {isLoading && <LoadingState label="Loading farmer health" height={260} />}
      {!isLoading && !error && !data?.data && (
        <EmptyState message="Farm not found in your scope." />
      )}

      {!isLoading && !error && data?.data && (
        <div className="rounded-lg border border-dashed border-surface-border p-6 text-center text-[13px] text-text-muted">
          Mode A drilldown UI lands in <span className="font-bold text-text-primary">DWC v2 Phase D Task 4</span>.
          {' '}Backend payload reached the page — check React Query devtools for{' '}
          <span className="font-mono">[&apos;farmer-health&apos;, &apos;drilldown&apos;, &apos;{farmId}&apos;]</span>.
        </div>
      )}
    </div>
  );
}
