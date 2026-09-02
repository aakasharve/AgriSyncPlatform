import { NotMeasured, NotMeasuredPanel } from '@/components/state';
import { PersonName } from '@/components/ui/PersonName';
import { DATE_FORMATS, fmt } from '@/lib/format';
import { WORKER_DISCLAIMER, WORKER_LIMIT, realName } from '../drilldown';
import type { FarmerHealthWorkerSummaryDto } from '../farmer-health.types';

/**
 * BAND 4 — WTL v0. The workers seen on this farm, and NOTHING ELSE.
 *
 * ── 🛑 THE RED LINE, CARRIED FROM THE SOURCE ─────────────────────────────
 * **DO NOT add fields here without a new task. No reputation, no dispute,
 * no payout, no skill, no score.**
 *
 * That sentence is the whole reason this component is three columns wide and
 * looks unfinished. It is not unfinished. Worker names are captured PASSIVELY
 * from voice transcripts — no worker ever asked to be listed here, and no
 * worker can see or correct what is written about them — so every field added
 * to this panel is a fact recorded about a person who has no standing in the
 * system that records it. The founder's line is that worker names ARE the
 * product and that nothing may accrete around them without a decision; a
 * redesign that reads the disclaimer as copy and "fills out" a thin-looking
 * list crosses it in one commit and looks like an improvement in review.
 *
 * Renders exactly three things per row: the name (through `PersonName`, so
 * Marathi resolves to Noto Sans Devanagari and a withheld name never prints a
 * marker), the count, and the first-seen date.
 *
 * ── The disclaimer is MANDATORY COPY (A35), byte for byte ────────────────
 * `WORKER_DISCLAIMER` lives in `../drilldown` and is asserted
 * character-for-character in this screen's test. It sets the expectation for
 * an admin who would otherwise assume the count means something it does not.
 *
 * ── A34 dies here ────────────────────────────────────────────────────────
 * This file held the LAST of the four copy-pasted `HAS_DEVANAGARI` + `fontFor`
 * pairs (`:20-26`). Task 6 built `PersonName` and deliberately gave it no call
 * sites; Task 22 took two, and this is the fourth and last.
 *
 * ── What the list is NOT ─────────────────────────────────────────────────
 * The server sends at most five rows, ordered by `assignment_count DESC`
 * (`AdminFarmerHealthRepository.cs:296-303`). Five is a TOP FIVE, not a
 * roster, and a panel that shows five names beside a count labelled with the
 * total would read as one. The heading says top five and the caption says what
 * the count is a count of.
 */

export interface WorkerSummaryListProps {
  workers: FarmerHealthWorkerSummaryDto[];
}

export function WorkerSummaryList({ workers }: WorkerSummaryListProps) {
  const rows = workers.slice(0, WORKER_LIMIT);

  return (
    <section
      data-band="workers"
      className="rounded-panel bg-page p-5 shadow-surface"
      aria-label="Workers seen on this farm"
    >
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-h3 font-semibold text-text-1">
          Workers seen on this farm{rows.length > 0 && <> — top {fmt.num(rows.length)}</>}
        </h3>
      </div>

      {rows.length === 0 ? (
        /*
          NOT "No workers captured yet." — that sentence promises a pipeline
          that is running and has found nobody. `GetTopWorkersAsync` ends in a
          bare `catch { }` (`AdminFarmerHealthRepository.cs:320`), so a missing
          table, a revoked grant and a farm whose logs named nobody all arrive
          here as the same empty array with HTTP 200.
        */
        <NotMeasuredPanel
          title="No worker names on this farm"
          why="Names are captured passively from voice transcripts, so an empty list can mean the logs named nobody, that no voice log has been parsed for this farm, or that the query failed — this read answers its own exception with an empty result, and the response carries nothing that separates the three."
        />
      ) : (
        <ul className="flex flex-col divide-y divide-line" aria-label="Worker list">
          {rows.map((w) => {
            const since = fmt.date(w.firstSeenUtc, DATE_FORMATS.workerSince);
            return (
              <li key={w.workerId} className="flex items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <PersonName
                    name={realName(w.name)}
                    className="block truncate text-body font-semibold text-text-1"
                  />
                  <div className="text-caption text-text-3">
                    {since === null ? (
                      <NotMeasured
                        state="unmeasured"
                        why="The first-seen timestamp on this worker row did not parse."
                      />
                    ) : (
                      <>since {since}</>
                    )}
                  </div>
                </div>
                <span
                  className="shrink-0 rounded-chip bg-wash px-2 py-0.5 text-caption font-semibold tabular-nums text-text-1"
                  aria-label={`${w.assignmentCount} mentions`}
                >
                  {fmt.num(w.assignmentCount)}×
                </span>
              </li>
            );
          })}
        </ul>
      )}

      <p className="mt-3 text-caption leading-snug text-text-3">
        The count is how many times this name was picked out of a voice log on this farm — not
        shifts, not days worked and not payments. {WORKER_DISCLAIMER}
      </p>
    </section>
  );
}
