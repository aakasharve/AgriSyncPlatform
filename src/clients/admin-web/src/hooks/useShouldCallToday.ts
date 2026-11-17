import { useMemo } from 'react';
import { ModuleKeys } from '@/lib/moduleKeys';
import { useAdminScope } from './useAdminScope';
import { useFarmContacts } from './useFarmContacts';
import { useSilentChurn, useSuffering, type SilentFarm, type SufferingItem } from './useFarms';

/**
 * FARMS A PERSON SHOULD CALL TODAY (Home, H9; CR-2e C26/C27).
 *
 * Two real answers, merged by farm id:
 *   - silent farms in the bands 7-13 and 14-29 days (names and phones from the
 *     silent-churn answer), and
 *   - farms with repeated problems in the last 7 days (the Suffering list; its
 *     names and phones come from `useFarmContacts`, asked only for farms that
 *     are not already named by the silent answer).
 *
 * Each row says why it is listed. A farm on both lists is one row with both
 * reasons. Farms silent 30+ days or never are not on this list.
 *
 * The list is "empty" only when BOTH answers are real and empty. A failed,
 * loading, not-measured or not-permitted answer is its own state, never "nobody".
 */

export interface CallReason {
  kind: 'silent' | 'problems';
  /** Plain words, e.g. "Gone quiet 9 days". */
  label: string;
}

export interface CallRow {
  farmId: string;
  /** Null while a Suffering-only farm's name has not been fetched (or is unknown). */
  name: string | null;
  ownerPhone: string | null;
  daysSilent: number | null;
  reasons: CallReason[];
}

export type CallListState = 'loading' | 'failed' | 'not-measured' | 'restricted' | 'ready';

const CALL_BANDS = new Set(['7-13', '14-29']);

export function mergeCallList(
  silent: SilentFarm[],
  suffering: SufferingItem[],
  contacts: Map<string, { name: string; ownerPhone: string | null }>,
): CallRow[] {
  const byFarm = new Map<string, CallRow>();

  for (const f of silent) {
    if (!CALL_BANDS.has(f.band)) continue;
    byFarm.set(f.farmId.toLowerCase(), {
      farmId: f.farmId,
      name: f.name,
      ownerPhone: f.ownerPhone,
      daysSilent: f.daysSilent,
      reasons: [
        {
          kind: 'silent',
          label: `Gone quiet ${f.daysSilent ?? 0} ${f.daysSilent === 1 ? 'day' : 'days'}`,
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
    const contact = contacts.get(key);
    byFarm.set(key, {
      farmId: s.farmId,
      name: contact?.name ?? null,
      ownerPhone: contact?.ownerPhone ?? null,
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

  const silentFarms = useMemo(() => churn.data?.data.farms ?? [], [churn.data]);
  const sufferingItems = useMemo(() => suffering.data?.data ?? [], [suffering.data]);

  const unnamedIds = useMemo(() => {
    const named = new Set(silentFarms.map((f) => f.farmId.toLowerCase()));
    return sufferingItems.map((s) => s.farmId).filter((id) => !named.has(id.toLowerCase()));
  }, [silentFarms, sufferingItems]);
  const contacts = useFarmContacts(unnamedIds);

  const notMeasuredReason = churn.data?.data.notMeasuredReason ?? null;

  const rows = useMemo(
    () => mergeCallList(notMeasuredReason ? [] : silentFarms, sufferingItems, contacts),
    [silentFarms, sufferingItems, contacts, notMeasuredReason],
  );

  let state: CallListState;
  if (!mayReadSuffering || !mayReadChurn) state = 'restricted';
  else if (churn.isError || suffering.isError) state = 'failed';
  else if (churn.isLoading || suffering.isLoading) state = 'loading';
  else if (notMeasuredReason) state = 'not-measured';
  else state = 'ready';

  return { rows, state, notMeasuredReason, churn, suffering, mayReadSuffering, mayReadChurn };
}
