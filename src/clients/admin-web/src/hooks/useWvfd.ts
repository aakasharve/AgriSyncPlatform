import { useQuery } from '@tanstack/react-query';
import { adminApi, type AdminResponse } from '@/lib/api';

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

export function useWvfd(weeks = 12) {
  return useQuery<AdminResponse<WvfdHistory>>({
    queryKey: ['metrics', 'wvfd', weeks],
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
