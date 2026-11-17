import type { SilentBand, SilentFarm, SilentNotMeasuredReason } from '@/hooks/useFarms';

/** The bands in the order the server sorts them, with their plain names. */
export const SILENT_BANDS: readonly { band: SilentBand; label: string }[] = [
  { band: '7-13', label: '7 to 13 days silent' },
  { band: '14-29', label: '14 to 29 days silent' },
  { band: '30+', label: '30 days or more silent' },
  { band: 'never', label: 'Never saved an entry' },
];

export const NO_PLAN_LABEL = 'No plan recorded';

const PLAN_STATUS_WORDS: Record<number, string> = {
  1: 'Trial',
  2: 'Active',
  3: 'Past due',
  4: 'Expired',
  5: 'Cancelled',
  6: 'Suspended',
};

/** The plan in plain words. Both plan fields null is "No plan recorded", never "Trial". */
export function planWords(f: Pick<SilentFarm, 'planCode' | 'planStatus'>): string {
  const status = f.planStatus === null ? null : (PLAN_STATUS_WORDS[f.planStatus] ?? null);
  if (status && f.planCode) return `${f.planCode}, ${status}`;
  if (status) return status;
  if (f.planCode) return f.planCode;
  return NO_PLAN_LABEL;
}

/** The group a farm falls in when grouped by plan: its status word, or no plan. */
export function planGroup(f: Pick<SilentFarm, 'planCode' | 'planStatus'>): string {
  if (f.planStatus === null && !f.planCode) return NO_PLAN_LABEL;
  return planWords(f);
}

export function notMeasuredWords(reason: SilentNotMeasuredReason | string): string {
  switch (reason) {
    case 'farm_list_unreadable':
      return 'The list of farms could not be read, so silent farms were not counted.';
    case 'too_many_farms_for_live_count':
      return 'There are too many farms to count silent ones live, so they were not counted.';
    default:
      return 'The server did not count silent farms.';
  }
}

export function daysSilentWords(f: Pick<SilentFarm, 'daysSilent'>): string {
  return f.daysSilent === null ? 'Never saved an entry' : `${f.daysSilent} ${f.daysSilent === 1 ? 'day' : 'days'}`;
}
