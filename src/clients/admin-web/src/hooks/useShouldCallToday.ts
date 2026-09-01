import { useMemo } from 'react';
import { ModuleKeys } from '@/lib/moduleKeys';
import { useAdminScope } from './useAdminScope';
import {
  partitionSilentChurn,
  useSilentChurn,
  useSuffering,
  type SilentChurnItem,
  type SufferingItem,
} from './useFarms';

/**
 * FARMS A PERSON SHOULD CALL TODAY — the one thing the v3 redesign adds that
 * needs no new endpoint, and the one thing on Home that is not a reading of
 * another screen.
 *
 * It is a UNION over three sets that already exist: the suffering watchlist,
 * the silent-churn watchlist, and silent churn's held-out rows. One row per
 * farm, carrying EVERY reason it was flagged. A farm on two lists is one call,
 * not two.
 *
 * ── WHY THE SORT IS NOT "ERRORS DESCENDING" ───────────────────────────────
 * The plan asks for errors-descending then weeks-descending. The first half
 * cannot be built from an honest number, and Task 16 is why.
 *
 * `mis.farmer_suffering_watchlist.error_count` is a bare `COUNT(*)` over
 * `event_type IN ('api.error','client.error','ai.invocation')` with NO outcome
 * filter (`20260502000000_AnalyticsRewrite.cs:399`). Only the `HAVING` clause
 * filters to failures. All three AI handlers emit an `ai.invocation` row on the
 * happy path, so EVERY SUCCESSFUL VOICE PARSE INFLATES THE FIGURE. Task 16
 * renamed the column to "Events counted" on its own screen and stated the flaw
 * rather than papering it. Ranking a CALL LIST by that number would put the
 * heaviest, happiest users at the top of it — and Home would have quietly
 * undone the honesty the screen beside it paid for.
 *
 * The three channel counts are clean (`sync_errors`, `log_errors`,
 * `voice_errors` each `COUNT(*) FILTER` to failures) but they OVERLAP: they are
 * `LIKE '%sync%'` / `LIKE '%log%'` / `LIKE '%voice%'` matches on one endpoint
 * string, so an endpoint containing two of those words is counted twice and
 * their sum can EXCEED the number of failing events. A sum of overlapping
 * filters is not a count either.
 *
 * So there is no per-farm failure magnitude on this feed that means what it
 * says, and the sort uses none:
 *
 *   1. HOW MANY WATCHLISTS FLAGGED THE FARM, descending. Derived here, from
 *      nothing but set membership. A farm that is BOTH failing and silent needs
 *      a person more than one that is only one of the two.
 *   2. WEEKS SILENT, descending. The one magnitude on this screen that measures
 *      exactly one thing — `GREATEST(1, days/7)` over a 14-day threshold, an
 *      integer division and therefore a floor (Task 15).
 *   3. NAME, ascending. A stable, explicable tiebreak.
 *
 * MEMBERSHIP OF THE SUFFERING LIST IS STILL TRUSTWORTHY, and that is what makes
 * this workable: the `HAVING` clause counts only `api.error`, `client.error`
 * and FAILED `ai.invocation`, and requires three or more of them in seven days.
 * So "this farm hit at least three real failures" is a true statement about
 * every row. It is only the SIZE of the number, and the order the server sorted
 * by, that cannot be trusted. The screen shows the figure under Task 16's name
 * and says it is not what ordered the list.
 *
 * ── WHY IT IS A HOOK AND NOT A FUNCTION ON THE PAGE ───────────────────────
 * Two callers: Home renders the table, and the sidebar renders the count as the
 * nav badge (A53). React Query dedupes both to one request per key, so the
 * second caller costs nothing. Two copies of the merge would cost a badge that
 * disagrees with the table under it.
 */

/* ══════════════════════════════════════════════════════ the merged row ══ */

export type CallReasonKind = 'failing' | 'silent' | 'no-last-log';

export interface CallReason {
  kind: CallReasonKind;
  /** The pill's words. Short, because it sits beside up to two others. */
  label: string;
  /** v3's flag tones. Rose for a failure, amber for a silence, grey for an
   *  absence — grey because "we have no last log" is not a severity. */
  tone: 'red' | 'amber' | 'grey';
}

export interface CallRow {
  farmId: string;
  /** The farm's name as the feed sent it — possibly `**redacted**`, which is a
   *  permission fact and is rendered by `Masked`, never printed. */
  name: string;
  /** Every reason, in a fixed order so two farms flagged the same way read the
   *  same way. */
  reasons: CallReason[];
  /** The suffering row, when there is one. Its `errorCount` is the mis-named
   *  figure above; its three channel counts are clean. */
  suffering: SufferingItem | null;
  /** The silent-churn row, when there is one and it has a last log. */
  churn: SilentChurnItem | null;
  /** A silent-churn row with NO last log — held out of the watchlist. Empty by
   *  construction today; the guard ships anyway (see `partitionSilentChurn`). */
  heldOut: SilentChurnItem | null;
}

const REASON_ORDER: CallReasonKind[] = ['failing', 'silent', 'no-last-log'];

/**
 * The entry condition, in the words of the `HAVING` clause rather than in the
 * words of the column above it. Shown on screen; not paraphrased twice.
 */
export const SUFFERING_ENTRY_RULE =
  'three or more failed events in the last 7 days';

/** Task 15: 14 days, and "N full weeks" because the SQL floors. */
export const CHURN_ENTRY_RULE = 'no log recorded for more than 14 days';

/* ═══════════════════════════════════════════════════════════ the merge ══ */

/**
 * Pure, exported and unit-testable. The screen renders what this returns and
 * decides nothing about the order itself.
 */
export function mergeCallList(
  suffering: SufferingItem[],
  churnWatchlist: SilentChurnItem[],
  churnHeldOut: SilentChurnItem[],
): CallRow[] {
  const byFarm = new Map<string, CallRow>();

  const entryFor = (farmId: string, name: string): CallRow => {
    const existing = byFarm.get(farmId);
    if (existing) return existing;
    const created: CallRow = {
      farmId,
      name,
      reasons: [],
      suffering: null,
      churn: null,
      heldOut: null,
    };
    byFarm.set(farmId, created);
    return created;
  };

  for (const row of suffering) {
    const entry = entryFor(row.farmId, row.name);
    entry.suffering = row;
    entry.reasons.push({ kind: 'failing', label: 'Failed events', tone: 'red' });
  }

  for (const row of churnWatchlist) {
    const entry = entryFor(row.farmId, row.name);
    entry.churn = row;
    entry.reasons.push({
      kind: 'silent',
      label: `Silent ${row.weeksSilent} full ${row.weeksSilent === 1 ? 'week' : 'weeks'}`,
      tone: 'amber',
    });
  }

  for (const row of churnHeldOut) {
    const entry = entryFor(row.farmId, row.name);
    entry.heldOut = row;
    /* NOT "Never logged". Task 15 proved the feed cannot report that: a farm
       with no log is dropped by an INNER JOIN before the list is built, so the
       only thing knowable here is that this row arrived without a last log. */
    entry.reasons.push({ kind: 'no-last-log', label: 'No last log', tone: 'grey' });
  }

  const rows = [...byFarm.values()];
  for (const row of rows) {
    row.reasons.sort((a, b) => REASON_ORDER.indexOf(a.kind) - REASON_ORDER.indexOf(b.kind));
  }

  return rows.sort(compareCallRows);
}

/** The three keys, in order. Exported so the screen can name them and a test
 *  can break exactly one of them. */
export function compareCallRows(a: CallRow, b: CallRow): number {
  if (a.reasons.length !== b.reasons.length) return b.reasons.length - a.reasons.length;

  const aw = a.churn?.weeksSilent ?? null;
  const bw = b.churn?.weeksSilent ?? null;
  /* A farm with no silence reading sorts BELOW one with a reading, in either
     direction — the missing-sorts-last rule the list component already applies
     to every other column (`sortRows.ts`). */
  if (aw !== bw) {
    if (aw === null) return 1;
    if (bw === null) return -1;
    return bw - aw;
  }

  return a.name.localeCompare(b.name);
}

/* ════════════════════════════════════════════════════════════ the hook ══ */

export interface ShouldCallToday {
  rows: CallRow[];
  /**
   * THE NAV BADGE'S NUMBER, AND `null` WHENEVER IT WOULD BE A FLOOR.
   *
   * It counts the rows THIS READER would see on Home — not the rows that
   * exist. A reader entitled to one watchlist gets a count of one watchlist,
   * which is the honest answer to "how many are on your list".
   *
   * It is `null`, and the badge renders nothing at all, when:
   *   · neither feed is readable at this role — there is no list to count;
   *   · a feed the reader IS entitled to has not answered, or failed. A pill
   *     has no room to say "at least"; a count that silently dropped a whole
   *     watchlist is worse than no count.
   */
  badgeCount: number | null;
  /** Whether each feed was even asked for. */
  mayReadSuffering: boolean;
  mayReadChurn: boolean;
  suffering: ReturnType<typeof useSuffering>;
  churn: ReturnType<typeof useSilentChurn>;
  /** The held-out rows, kept separate so a screen can state them apart. */
  heldOut: SilentChurnItem[];
}

export function useShouldCallToday(): ShouldCallToday {
  const { canRead } = useAdminScope();
  const mayReadSuffering = canRead(ModuleKeys.FarmsSuffering);
  const mayReadChurn = canRead(ModuleKeys.FarmsSilentChurn);

  /* FAIL CLOSED AT THE REQUEST. Home carries no route guard (A4), so without
     these gates an admin holding neither key would fire two denials, each of
     which invalidates the cached scope, which re-renders, which fires them
     again. See `useFarms.ts`. */
  const suffering = useSuffering({ enabled: mayReadSuffering });
  const churn = useSilentChurn({ enabled: mayReadChurn });

  /* The hold-out split runs BEFORE the merge, exactly as it does on Silent
     Churn: a row with no last log is not a watchlist row, and it must not
     become one by passing through here. */
  const { watchlist, heldOut } = useMemo(
    () => partitionSilentChurn(churn.data?.data ?? []),
    [churn.data],
  );

  const rows = useMemo(
    () => mergeCallList(suffering.data?.data ?? [], watchlist, heldOut),
    [suffering.data, watchlist, heldOut],
  );

  const sufferingSettled = !mayReadSuffering || suffering.isSuccess;
  const churnSettled = !mayReadChurn || churn.isSuccess;
  const anyFeed = mayReadSuffering || mayReadChurn;

  const badgeCount = anyFeed && sufferingSettled && churnSettled ? rows.length : null;

  return {
    rows,
    badgeCount,
    mayReadSuffering,
    mayReadChurn,
    suffering,
    churn,
    heldOut,
  };
}
