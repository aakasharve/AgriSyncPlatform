import { useQuery } from '@tanstack/react-query';
import { adminApi, type AdminResponse } from '@/lib/api';

// spec: control-room-app-versions-2026-11-12 (CR-1c Task V3).

export type AppVersionsDays = 7 | 30;

export interface AppVersionRow {
  appVersion: string;
  people: number;
  isNewest: boolean;
}

export interface OlderVersionPerson {
  name: string | null;
  farmNames: string[];
  appVersion: string;
  lastSeenUtc: string;
}

export interface AppVersions {
  days: number;
  /** null: nothing recorded yet. */
  measuredSinceUtc: string | null;
  people: number;
  phones: number;
  otherDevices: number;
  peopleWithUnknownDevice: number;
  /** Newest seen in use in the period. The server does not know what the store has published. */
  newestVersion: string | null;
  /** Newest first. */
  versions: AppVersionRow[];
  /** Most recently seen first; the server sends at most 200. */
  onOlderVersions: OlderVersionPerson[];
}

/**
 * Who used which app version in the last 7 or 30 days.
 *
 * Nothing here is automatic. Each load can write an audit row on the server, so the
 * request goes out once when the page opens and once when the period changes: no
 * polling, no refetch on focus or reconnect, no retry of a failed request, and no
 * cached answer shown under a period it was not asked for.
 */
export function useAppVersions(days: AppVersionsDays) {
  return useQuery<AppVersions>({
    queryKey: ['ops', 'app-versions', days],
    queryFn: async () => {
      const { data } = await adminApi.get<AdminResponse<AppVersions>>(
        `/shramsafal/admin/ops/app-versions?days=${days}`
      );
      // An answer without its lists is a failed load, never an empty page.
      const answer: AppVersions | undefined = data?.data;
      if (!answer || !Array.isArray(answer.versions) || !Array.isArray(answer.onOlderVersions)) {
        throw new Error('app-versions: the answer is not in the expected shape');
      }
      return answer;
    },
    staleTime: 0,
    gcTime: 0,
    retry: false,
    refetchInterval: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}
