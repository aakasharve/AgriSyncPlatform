import { useQuery } from '@tanstack/react-query';
import { adminApi, type AdminResponse } from '@/lib/api';
import { useOrgKey } from '@/lib/orgQuery';

export interface WvfdWeek {
  weekStart: string;
  avgWvfd: number;
  activeFarms: number;
}
export interface WvfdFarmRow {
  farmId: string;
  wvfd: number;
  engagementTier: 'A' | 'B' | 'C' | 'D';
  activeFarms: number;
}
export interface WvfdHistory {
  currentWvfd: number;
  priorWvfd: number | null;
  goalWvfd: number;
  weeks: WvfdWeek[];
  topFarms: WvfdFarmRow[];
}

/** Org in the key (A7, T12 S3) — see the note in `useFarms.ts`. */
export function useWvfd(weeks = 12) {
  const org = useOrgKey();
  return useQuery<AdminResponse<WvfdHistory>>({
    queryKey: ['metrics', 'wvfd', org, weeks],
    queryFn: async () => {
      const { data } = await adminApi.get<AdminResponse<WvfdHistory>>(
        `/shramsafal/admin/metrics/wvfd?weeks=${weeks}`
      );
      return data;
    },
    staleTime: 300_000,
    refetchInterval: 300_000,
  });
}
