import { NotMeasured, NotMeasuredPanel } from '@/components/state';
import { DATE_FORMATS, fmt } from '@/lib/format';
import { cn } from '@/lib/utils';
import {
  FAILED_PUSHES_WHY,
  LAST_SYNC_WHY,
  PENDING_PUSHES_WHY,
  SYNC_ERRORS_SHOWN,
  syncErrorsWithheld,
} from '../drilldown';
import type { FarmerHealthSyncStateDto } from '../farmer-health.types';
import { OpsPanel } from './OpsPanel';

/**
 * BAND 5a — sync posture. PRIVILEGED: the server only fills this block for a
 * caller holding `ops.errors` (`AdminFarmerHealthRepository.cs:80-82`).
 *
 * ── C8 lives in `OpsPanel`, not here ─────────────────────────────────────
 * The slate inset edge is how an admin tells privileged ops data from the
 * core farmer profile at a glance. It had two homes — this file and
 * `AiHealthBlock` — plus a third on the denial panel, all three writing the
 * same inline shadow. One component owns it now, so a constraint cannot be
 * kept in two places and changed in one.
 *
 * ── THREE OF THE FOUR FIGURES ARE NOT WHAT THEIR LABELS SAY ─────────────
 * All three are read out of `GetSyncStateAsync`, and the panel now says each
 * one rather than leaving a plausible label to stand for a different query:
 *
 *   Pending pushes  IS NOT A MEASUREMENT. `PendingPushes: 0` is hard-coded,
 *                   with the repository's own comment beside it: "server-side
 *                   cannot observe device-side queue depth" (`:386`). It was
 *                   rendered as a figure with a conditional amber tone that
 *                   could never fire — a zero that means "we cannot see",
 *                   drawn as a zero that means "none".
 *   Failed (7d)     counts every `api.error` and `client.error` event, not
 *                   only failed pushes — the same events the table below
 *                   lists and the same ones the timeline's Errors row counts.
 *   Last sync       is `MAX(occurred_at)` over `sync.completed` OR
 *                   `log.created`, so a log written on the device and never
 *                   pushed moves it.
 *
 * ── AND THE TABLE IS FIVE OF TEN ────────────────────────────────────────
 * The query takes ten rows and the panel showed five, silently. Five of ten
 * presented as "recent errors" is a list pretending to be a set; the count is
 * stated and the withheld remainder is named.
 */

export interface SyncStateBlockProps {
  state?: FarmerHealthSyncStateDto | null;
}

export function SyncStateBlock({ state }: SyncStateBlockProps) {
  /*
    A null block reaching this component means the caller HAS the grant (the
    gate above would not have rendered it otherwise) and the server still sent
    nothing — which on this endpoint means the whole sub-block was skipped or
    the read failed. It is not "no sync activity", which is what the live panel
    said, and which reads as a fact about a device.
  */
  if (!state) {
    return (
      <OpsPanel title="Sync state" grant="ops.errors">
        <NotMeasuredPanel
          title="No sync block was sent for this farm"
          why="Your role includes the grant this block needs, so an absent block is the server declining to assemble it rather than a device with nothing to report."
        />
      </OpsPanel>
    );
  }

  const lastSync = fmt.dateTime(state.lastSyncAt, DATE_FORMATS.drilldownSyncRow);
  const errors = state.lastErrors ?? [];
  const shown = errors.slice(0, SYNC_ERRORS_SHOWN);
  const withheld = syncErrorsWithheld(state);

  return (
    <OpsPanel title="Sync state" grant="ops.errors">
      <dl className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div>
          <dt className="text-caption text-text-2">Last device event</dt>
          <dd className="mt-0.5 text-body font-semibold tabular-nums text-text-1">
            {lastSync === null ? (
              <NotMeasured
                state="never"
                why="No sync.completed or log.created event has ever been recorded for this farm."
              />
            ) : (
              lastSync
            )}
          </dd>
          <p className="mt-0.5 text-caption text-text-3">{LAST_SYNC_WHY}</p>
        </div>

        <div>
          <dt className="text-caption text-text-2">Pending pushes</dt>
          {/*
            THE ONE FIGURE ON THIS SCREEN THAT IS A CONSTANT. Rendering it as
            a number — any number — asserts that the server looked.
          */}
          <dd data-pending="" className="mt-0.5 text-body font-semibold text-text-1">
            <NotMeasured state="unmeasured" why={PENDING_PUSHES_WHY} />
          </dd>
          <p className="mt-0.5 text-caption text-text-3">{PENDING_PUSHES_WHY}</p>
        </div>

        <div>
          <dt className="text-caption text-text-2">Error events (7d)</dt>
          <dd
            className={cn(
              'mt-0.5 text-body font-semibold tabular-nums',
              state.failedPushesLast7d > 0 ? 'text-red' : 'text-text-1'
            )}
          >
            {fmt.num(state.failedPushesLast7d)}
          </dd>
          <p className="mt-0.5 text-caption text-text-3">{FAILED_PUSHES_WHY}</p>
        </div>
      </dl>

      {shown.length > 0 && (
        <div className="mt-4">
          <h4 className="mb-2 text-caption font-semibold text-text-2">
            {withheld > 0 ? (
              <>
                The {fmt.num(SYNC_ERRORS_SHOWN)} most recent of {fmt.num(errors.length)} returned
              </>
            ) : (
              <>
                {errors.length === 1 ? 'The one error returned' : `All ${fmt.num(errors.length)} errors returned`}
              </>
            )}
          </h4>
          <div className="overflow-x-auto">
            <table data-sync-errors="" className="w-full text-caption">
              <caption className="sr-only">
                The most recent api.error and client.error events for this farm in the last seven
                days.
              </caption>
              <thead>
                <tr className="text-left text-text-2">
                  <th className="py-1.5 pr-3 font-semibold">When</th>
                  <th className="py-1.5 pr-3 font-semibold">Endpoint</th>
                  <th className="py-1.5 pr-3 text-right font-semibold">Status</th>
                  <th className="py-1.5 font-semibold">Message</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((e, i) => {
                  const when = fmt.dateTime(e.ts, DATE_FORMATS.drilldownSyncRow);
                  return (
                    <tr key={`${e.ts}-${i}`} className="border-t border-line align-top">
                      <td className="py-1.5 pr-3 tabular-nums text-text-2">
                        {/* Step 6 — the em-dash fallback on an unparseable
                            timestamp, now through the one component allowed
                            to print a missing value. */}
                        {when === null ? (
                          <NotMeasured
                            state="unmeasured"
                            why="This event carried a timestamp that did not parse."
                          />
                        ) : (
                          when
                        )}
                      </td>
                      <td className="py-1.5 pr-3 text-text-1">{e.endpoint}</td>
                      <td className="py-1.5 pr-3 text-right font-semibold tabular-nums text-red">
                        {fmt.num(e.status)}
                      </td>
                      <td className="py-1.5 break-words text-text-2">{e.message}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {withheld > 0 && (
            <p className="mt-2 text-caption text-text-3">
              {fmt.num(withheld)} older {withheld === 1 ? 'event was' : 'events were'} returned by
              the server and are not shown here.
            </p>
          )}
        </div>
      )}

      {shown.length === 0 && state.failedPushesLast7d > 0 && (
        <p className="mt-4 text-caption text-text-3">
          The count above is {fmt.num(state.failedPushesLast7d)} but no error rows came back. The
          count and the rows are two separate queries and either can fail on its own, so this is a
          disagreement inside one response rather than a farm with unlisted errors.
        </p>
      )}
    </OpsPanel>
  );
}
