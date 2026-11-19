import { ChevronLeft } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import {
  LoadFailed,
  LoadingState,
  MetricLines,
  NotBuiltYet,
  NotMeasured,
  NotMeasuredPanel,
} from '@/components/state';
import { describeAdminDenial } from '@/lib/adminErrors';
import { DATE_FORMATS, fmt } from '@/lib/format';
import { FarmerTimeline } from './components/FarmerTimeline';
import { FarmerIdentity } from './components/FarmerIdentity';
import { FarmWorkers } from './components/FarmWorkers';
import { ReadingBlock } from './components/ReadingBlock';
import { VerificationCounts } from './components/VerificationCounts';
import type { FarmerHealthLastSyncDto } from './farmer-health.types';
import { useFarmerHealth } from './hooks/useFarmerHealth';

/**
 * THE ONE-FARM PAGE (`/farmer-health/:farmId`), Platform owners only.
 *
 * Real: the owner's name and phone (P1), the 14-day timeline with its checked
 * and error rows (P3, P4, P5), the last entry reached the server (P8), the
 * checks on entries (P6), the workers (P7) and voice and photo reading (P10,
 * P11). Still "Not built yet", with no number: the farm score (P2) and refused
 * uploads (P9).
 *
 * The header renders in every branch: the farm id in the address is the only
 * thing saying which farm failed, and the back link must survive an error.
 * A 403 shows the console's own no-access wording, a 404 says the farm was not
 * found, anything else says it could not load. The hook never polls: each load
 * writes an audit row.
 */

/** A 404 is not a failure to load — it is an answer. */
function isNotFound(error: unknown): boolean {
  const status = (error as { response?: { status?: number } } | null)?.response?.status;
  return status === 404;
}

/** P8. When the farm's latest entry reached the server. */
function LastEntry({ state }: { state: FarmerHealthLastSyncDto | null | undefined }) {
  const at = fmt.dateTime(state?.lastSyncAt, DATE_FORMATS.drilldownSyncRow);
  return (
    <section
      data-metric="fh-last-activity"
      aria-label="Last entry reached the server"
      className="glass-panel rounded-panel p-5"
    >
      <h3 className="text-h3 font-semibold text-text-1">Last entry reached the server</h3>
      <p className="mt-2 text-h2 font-bold tabular-nums text-text-1">
        {at ?? (
          <NotMeasured
            state={state ? 'never' : 'unmeasured'}
            why={
              state
                ? 'No entry from this farm has reached the server yet.'
                : 'The server sent no sync record for this farm.'
            }
          />
        )}
      </p>
      <MetricLines metric="fh-last-activity" className="mt-2" />
    </section>
  );
}

export default function FarmerHealthDrilldown() {
  const { farmId } = useParams<{ farmId: string }>();
  const { data, isLoading, error, refetch } = useFarmerHealth(farmId);

  const farmer = data?.data;

  const notFound = isNotFound(error);
  const denial = describeAdminDenial(error);
  const failed = error != null && !notFound && !denial;
  const missing = !isLoading && !failed && (notFound || !farmer) && !denial;

  return (
    <div className="flex flex-col gap-6">
      {/* ══ the header — outside every branch (A40) ═════════════════════ */}
      <div data-band="header" className="flex flex-col gap-2">
        <Link
          to="/farmer-health"
          className="inline-flex w-fit items-center gap-1 rounded-chip text-caption font-semibold text-text-2 hover:text-text-1"
        >
          <ChevronLeft size={14} aria-hidden="true" /> All farmers
        </Link>

        <h1 className="min-w-0 text-h1 font-bold text-text-1">Farm health</h1>

        <p className="text-caption text-text-3">
          Farm ID <span className="tabular-nums text-text-2">{farmId}</span>
        </p>
      </div>

      {/* ══ no access: the console's own wording ═══════════════════════ */}
      {denial && (
        <NotMeasuredPanel
          title={denial.message}
          why={
            <>
              <p>{denial.remedy}</p>
              {denial.detail ? <p className="mt-2">{denial.detail}</p> : null}
            </>
          }
        />
      )}

      {/* ══ the request broke ═══════════════════════════════════════════ */}
      {failed && (
        <LoadFailed
          error={error}
          what="this farmer's health record"
          onRetry={() => {
            void refetch();
          }}
        />
      )}

      {/* ══ still loading ═══════════════════════════════════════════════ */}
      {isLoading && (
        <>
          <LoadingState label="Loading 14-day timeline" height={260} />
          <LoadingState label="Loading last entry" height={120} />
        </>
      )}

      {/* ══ the farm is not there, for one of two reasons ═══════════════ */}
      {missing && (
        <NotMeasuredPanel
          title="Farm not found in your scope."
          why="The server has no farm with this id. Check the id in the address."
        />
      )}

      {/* ══ the data ═════════════════════════════════════════════════════ */}
      {!isLoading && !failed && !denial && farmer && (
        <>
          <FarmerIdentity
            farmerName={farmer.farmerName}
            farmName={farmer.farmName}
            phone={farmer.phone}
          />
          <NotBuiltYet metric="fh-score" />
          <FarmerTimeline timeline={farmer.timeline ?? []} />
          <LastEntry state={farmer.syncState} />

          <div className="grid gap-4 md:grid-cols-2">
            {farmer.verifications ? (
              <VerificationCounts counts={farmer.verifications} />
            ) : (
              <NotMeasuredPanel
                title="Checks on entries"
                why="The server did not send the check counts for this farm, so none are shown rather than a made-up zero."
              />
            )}
            <FarmWorkers workers={farmer.workerSummary ?? []} />
            <NotBuiltYet metric="fh-failed-uploads" />
          </div>

          {farmer.aiHealth ? (
            <ReadingBlock reading={farmer.aiHealth} />
          ) : (
            <NotMeasuredPanel
              title="Voice and photo reading"
              why="The server did not send the reading figures for this farm, so none are shown rather than a made-up zero."
            />
          )}
        </>
      )}
    </div>
  );
}
