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
import { useAdminScope } from '@/hooks/useAdminScope';
import { DATE_FORMATS, fmt } from '@/lib/format';
import { FarmerTimeline } from './components/FarmerTimeline';
import { OPS_BLOCKS } from './drilldown';
import type { FarmerHealthSyncStateDto } from './farmer-health.types';
import { useFarmerHealth } from './hooks/useFarmerHealth';

/**
 * THE ONE-FARM PAGE (`/farmer-health/:farmId`) — two real parts, nine ideas
 * (amendment B24, 2026-11-17).
 *
 * It still calls its drilldown feed, but renders only two things from it:
 *
 *  - P3, the 14-day timeline: started, submitted, proof, summary viewed. Its
 *    "Checked" and "Errors" rows are ideas (P4, P5): the rows keep their place,
 *    marked "Not built yet", and draw no count.
 *  - P8, "Last entry reached the server".
 *
 * Everything else is an idea parked for reference, and shows "Not built yet"
 * with its two lines and no number, no zero, no chart and no empty list:
 * the farmer's name and phone (P1), the farm score and its six parts (P2), the
 * checks on entries (P6), the workers (P7), refused uploads (P9), and the voice
 * and photo reading rates and counts (P10, P11). No score, band badge or flag
 * notice is drawn: they came from the score, which is not counted on real
 * inputs yet.
 *
 * Kept from the older page, because they are not numbers:
 *  - the header renders in ALL FOUR branches (error, loading, not found, data):
 *    the farm id in the address is the only thing saying which farm failed, and
 *    the back link must survive an error (A40);
 *  - "Farm not found in your scope." is a scope statement and a database
 *    failure at once (`IsFarmInScopeAsync` ends in `catch { return false; }`),
 *    and says both;
 *  - a 404 is an answer, not a failure, and the hook's `retry: 0` is why it is
 *    fast (A28).
 *
 * P8 reads the sync block, which the server sends only with the ops grant. A
 * reader without it sees the reason, never a blank.
 */

/** A 404 is not a failure to load — it is an answer. */
function isNotFound(error: unknown): boolean {
  const status = (error as { response?: { status?: number } } | null)?.response?.status;
  return status === 404;
}

/** P8. The value of the old "Last device event": the newest sync.completed or log.created event. */
function LastEntry({
  canSee,
  state,
}: {
  canSee: boolean;
  state: FarmerHealthSyncStateDto | null | undefined;
}) {
  const at = canSee ? fmt.dateTime(state?.lastSyncAt, DATE_FORMATS.drilldownSyncRow) : null;
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
            state={canSee && state ? 'never' : 'unmeasured'}
            why={
              !canSee
                ? 'Your role cannot read this farm’s sync record, so the time is not shown.'
                : state
                  ? 'No sync.completed or log.created event has ever been recorded for this farm.'
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
  const { canRead } = useAdminScope();

  const farmer = data?.data;

  /* `canRead` is false while the scope is in flight — deliberately: a block
     the server redacted must not be drawn as a measured empty. */
  const canSeeSync = canRead(OPS_BLOCKS.sync.module);

  const notFound = isNotFound(error);
  const failed = error != null && !notFound;
  const missing = !isLoading && !failed && (notFound || !farmer);

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

      {/* ══ the data: two real parts, nine ideas ════════════════════════ */}
      {!isLoading && !failed && farmer && (
        <>
          <NotBuiltYet metric="fh-name-phone" />
          <NotBuiltYet metric="fh-score" />
          <FarmerTimeline timeline={farmer.timeline ?? []} />
          <LastEntry canSee={canSeeSync} state={farmer.syncState} />

          <div className="grid gap-4 md:grid-cols-2">
            <NotBuiltYet metric="fh-verification-counts" />
            <NotBuiltYet metric="fh-workers" />
            <NotBuiltYet metric="fh-failed-uploads" />
          </div>

          <section className="flex flex-col gap-3" aria-labelledby="fh-reading-head">
            <h2 id="fh-reading-head" className="text-h2 font-bold text-text-1">
              Voice and photo reading
            </h2>
            <div className="grid gap-4 md:grid-cols-2">
              <NotBuiltYet metric="fh-reading-rates" />
              <NotBuiltYet metric="fh-reading-count" />
            </div>
          </section>
        </>
      )}
    </div>
  );
}
