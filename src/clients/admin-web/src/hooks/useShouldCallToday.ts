import { useMemo } from 'react';
import { ModuleKeys } from '@/lib/moduleKeys';
import { analyticsFlagFromMeta, analyticsNotMeasuredSentence } from '@/lib/analyticsNotMeasured';
import { isForbiddenError } from '@/lib/silentFarms';
import { useAdminScope } from './useAdminScope';
import { useFarmContactsState } from './useFarmContacts';
import { useSilentChurn, useSuffering, type SilentFarm, type SufferingItem } from './useFarms';

/**
 * FARMS A PERSON SHOULD CALL TODAY (Home, H9; CR-2e C26/C27/C28).
 *
 * Two real answers (halves), merged by farm id:
 *   - silent farms in the bands 7-13 and 14-29 days, and
 *   - farms with repeated problems in the last 7 days (the Suffering list).
 *
 * Every row takes its name and phone from the silent answer when that answer
 * names the farm (any band). Only a farm the silent answer does not name is
 * looked up in `useFarmContacts`; until that answers, its phone is "not fetched".
 *
 * Each half has its own state. A half that is not counted never hides the other
 * half's real rows. The list is "empty" only when BOTH halves are real and empty.
 */

export interface CallReason {
  kind: 'silent' | 'problems';
  /** Plain words, e.g. "Gone quiet 9 days". */
  label: string;
}

export interface CallRow {
  farmId: string;
  /** Null while a farm's name has not been fetched (or is unknown). */
  name: string | null;
  ownerPhone: string | null;
  /** False while the phone is still being fetched or its fetch failed. A real null is true. */
  phoneKnown: boolean;
  daysSilent: number | null;
  reasons: CallReason[];
}

export type HalfState =
  | 'loading'
  | 'failed'
  | 'not-measured'
  | 'restricted'
  | 'forbidden'
  | 'ready';

const CALL_BANDS = new Set(['7-13', '14-29']);

export interface ContactLookup {
  get(key: string): { name: string; ownerPhone: string | null } | undefined;
}

export function mergeCallList(
  silent: SilentFarm[],
  suffering: SufferingItem[],
  contacts: ContactLookup,
): CallRow[] {
  const byFarm = new Map<string, CallRow>();
  const silentById = new Map<string, SilentFarm>();
  for (const f of silent) silentById.set(f.farmId.toLowerCase(), f);

  for (const f of silent) {
    if (!CALL_BANDS.has(f.band)) continue;
    byFarm.set(f.farmId.toLowerCase(), {
      farmId: f.farmId,
      name: f.name,
      ownerPhone: f.ownerPhone,
      phoneKnown: true,
      daysSilent: f.daysSilent,
      reasons: [
        {
          kind: 'silent',
          label:
            f.daysSilent === null
              ? 'Gone quiet, days not measured'
              : `Gone quiet ${f.daysSilent} ${f.daysSilent === 1 ? 'day' : 'days'}`,
        },
      ],
    });
  }

  for (const s of suffering) {
    const key = s.farmId.toLowerCase();
    const reason: CallReason = { kind: 'problems', label: 'Repeated problems in the last 7 days' };
    const existing = byFarm.get(key);
    if (existing) {
      existing.reasons.push(reason);
      continue;
    }
    const named = silentById.get(key);
    if (named) {
      byFarm.set(key, {
        farmId: s.farmId,
        name: named.name,
        ownerPhone: named.ownerPhone,
        phoneKnown: true,
        daysSilent: named.daysSilent,
        reasons: [reason],
      });
      continue;
    }
    const contact = contacts.get(key);
    byFarm.set(key, {
      farmId: s.farmId,
      name: contact?.name ?? null,
      ownerPhone: contact?.ownerPhone ?? null,
      phoneKnown: contact !== undefined,
      daysSilent: null,
      reasons: [reason],
    });
  }

  return [...byFarm.values()].sort(
    (a, b) =>
      b.reasons.length - a.reasons.length ||
      (b.daysSilent ?? -1) - (a.daysSilent ?? -1) ||
      (a.name ?? a.farmId).localeCompare(b.name ?? b.farmId),
  );
}

export function useShouldCallToday() {
  const { canRead } = useAdminScope();
  const mayReadSuffering = canRead(ModuleKeys.FarmsSuffering);
  const mayReadChurn = canRead(ModuleKeys.FarmsSilentChurn);

  /* Fail closed at the request: Home has no route guard, and a denial
     invalidates the cached scope and would loop. */
  const suffering = useSuffering({ enabled: mayReadSuffering });
  const churn = useSilentChurn({ enabled: mayReadChurn });

  const notMeasuredReason = churn.data?.data.notMeasuredReason ?? null;
  /* W-1: while the server says app events are not being recorded, the Suffering answer is not a
     list of farms with no problems; it is not measured, and the problems half says so. */
  const problemsFlag = analyticsFlagFromMeta(suffering.data?.meta);
  const problemsNotMeasuredText = problemsFlag ? analyticsNotMeasuredSentence(problemsFlag) : null;

  const silentFarms = useMemo(() => churn.data?.data.farms ?? [], [churn.data]);
  const sufferingItems = useMemo(() => suffering.data?.data ?? [], [suffering.data]);

  /* m7 and round 2: the problems half shows farms only when it is ready (allowed, loaded, not failed,
     not forbidden, not flagged not-recording). Otherwise no owner phone is fetched for its farms,
     whatever older data is in hand: each fetch writes a History look that the trust report counts. */
  const problemsShown = mayReadSuffering && !suffering.isError && !suffering.isLoading && !problemsFlag;
  const unnamedIds = useMemo(() => {
    if (!problemsShown) return [];
    const named = new Set(silentFarms.map((f) => f.farmId.toLowerCase()));
    return sufferingItems.map((s) => s.farmId).filter((id) => !named.has(id.toLowerCase()));
  }, [silentFarms, sufferingItems, problemsShown]);
  const { contacts, failed: contactsFailed } = useFarmContactsState(unnamedIds);

  const silentState: HalfState = !mayReadChurn
    ? 'restricted'
    : churn.isError
      ? isForbiddenError(churn.error)
        ? 'forbidden'
        : 'failed'
      : churn.isLoading
        ? 'loading'
        : notMeasuredReason
          ? 'not-measured'
          : 'ready';
  const problemsState: HalfState = !mayReadSuffering
    ? 'restricted'
    : suffering.isError
      ? isForbiddenError(suffering.error)
        ? 'forbidden'
        : 'failed'
      : suffering.isLoading
        ? 'loading'
        : problemsFlag
          ? 'not-measured'
          : 'ready';

  const rows = useMemo(
    () =>
      mergeCallList(
        silentState === 'ready' ? silentFarms : [],
        problemsState === 'ready' ? sufferingItems : [],
        contacts,
      ),
    [silentFarms, sufferingItems, contacts, silentState, problemsState],
  );

  return {
    rows,
    silentState,
    problemsState,
    notMeasuredReason,
    problemsNotMeasuredText,
    contactsFailed,
    churn,
    suffering,
  };
}
