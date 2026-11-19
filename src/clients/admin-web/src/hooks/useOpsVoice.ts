import { useQuery } from '@tanstack/react-query';
import { adminApi, type AdminResponse } from '@/lib/api';
import { useOrgKey } from '@/lib/orgQuery';

export interface OpsVoiceDay {
  date: string;
  invocations: number;
  failures: number;
  successRatePct: number;
  avgLatencyMs: number;
}
export interface OpsVoiceTrend {
  days: OpsVoiceDay[];
}

/**
 * Org in the key (A7, T12 S3) — see the note in `useFarms.ts`.
 *
 * 🛑 `days` IS IN THE KEY, AND IT HAS TO BE (A19, Task 19). It is the third
 * of the four places the window has to reach — hook argument, QUERY KEY,
 * query string, and the interpolated card title on the screen. Drop it and 7,
 * 14 and 30 become one cache entry: the screen then draws a fortnight under a
 * heading that says thirty days, with no request in the network tab, no error
 * anywhere and no way for the reader to tell. `OpsVoicePage.test.tsx` breaks
 * if the second window stops issuing its own request.
 */
export function useOpsVoice(days = 14) {
  const org = useOrgKey();
  return useQuery<AdminResponse<OpsVoiceTrend>>({
    queryKey: ['ops', 'voice', org, days],
    queryFn: async () => {
      const { data } = await adminApi.get<AdminResponse<OpsVoiceTrend>>(
        `/shramsafal/admin/ops/voice?days=${days}`
      );
      return data;
    },
    staleTime: 300_000,
    refetchInterval: 300_000,
  });
}
