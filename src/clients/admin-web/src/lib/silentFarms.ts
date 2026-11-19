import { AdminModuleForbiddenError } from '@/lib/adminErrors';
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
  2: 'Paid, active',
  3: 'Paid, payment overdue',
  4: 'Expired',
  5: 'Cancelled',
  6: 'Suspended',
};

export const FREE_PLAN_LABEL = 'Free plan';

/**
 * The plan in plain words, never the raw code. Plan code `free` is "Free plan";
 * otherwise the status word. Nothing recorded (or a status this console does not
 * know) is "No plan recorded", never "Trial".
 */
export function planWords(f: Pick<SilentFarm, 'planCode' | 'planStatus'>): string {
  if (f.planCode !== null && f.planCode.trim().toLowerCase() === 'free') return FREE_PLAN_LABEL;
  if (f.planStatus !== null) {
    const status = PLAN_STATUS_WORDS[f.planStatus];
    if (status) return status;
  }
  return NO_PLAN_LABEL;
}

/** The group a farm falls in when grouped by plan: the same plain words. */
export function planGroup(f: Pick<SilentFarm, 'planCode' | 'planStatus'>): string {
  return planWords(f);
}

/** True for a 403 from the server, typed (`AdminModuleForbiddenError`) or raw. */
export function isForbiddenError(error: unknown): boolean {
  if (error instanceof AdminModuleForbiddenError) return true;
  if (typeof error === 'object' && error !== null) {
    const status = (error as { response?: { status?: unknown } }).response?.status;
    return status === 403;
  }
  return false;
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

export function daysSilentWords(f: Pick<SilentFarm, 'daysSilent' | 'band'>): string {
  if (f.daysSilent === null) return f.band === 'never' ? 'Never saved an entry' : 'not measured';
  return `${f.daysSilent} ${f.daysSilent === 1 ? 'day' : 'days'}`;
}
