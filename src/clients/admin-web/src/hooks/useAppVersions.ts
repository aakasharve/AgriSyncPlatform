import { useQuery } from '@tanstack/react-query';
import { adminApi, metaRefreshedAt, type AdminResponse } from '@/lib/api';
import { analyticsFlagFromMeta, type AnalyticsFlag } from '@/lib/analyticsNotMeasured';

// spec: control-room-app-versions-2026-11-12 (CR-1c Tasks V3 and V4).

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
  /**
   * The number every release up to 1.0.17 reports ("0.9.0"). It was never a release, so the
   * page never shows it as one. A server older than this field does not send it; the page
   * then relabels nothing, and that is not a failed load.
   */
  legacyVersionNumber: string;
  /** Newest first. */
  versions: AppVersionRow[];
  /** Most recently seen first; the server sends at most 200. */
  onOlderVersions: OlderVersionPerson[];
  /**
   * CR-3 (AM7): why the names above are not sent. `needs_all_farms` means the caller has the
   * server-health tick but not All farms, so they get the counts and no names. `null` or absent
   * (an older server) means nothing is hidden.
   */
  onOlderVersionsHiddenReason?: string | null;
}

/**
 * The answer, plus WHEN the server gave it. CR-2d join: the September console's state rules
 * name the moment a "nobody" was measured (MeasuredZero), and that moment must be the server's
 * (`meta.lastRefreshedUtc`), never this browser's clock. Null when the server did not say.
 */
export interface AppVersionsAnswer extends AppVersions {
  checkedAtUtc: string | null;
  /**
   * CR-3 fix wave W-1: set while the server says app events are not being recorded. Every count on
   * the answer is then not measured; the page says so and shows no number.
   */
  analyticsFlag: AnalyticsFlag | null;
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
  return useQuery<AppVersionsAnswer>({
    queryKey: ['ops', 'app-versions', days],
    queryFn: async () => {
      const { data } = await adminApi.get<AdminResponse<AppVersions>>(
        `/shramsafal/admin/ops/app-versions?days=${days}`
      );
      // An answer without its lists is a failed load, never an empty page. An answer without
      // legacyVersionNumber is still a good answer: the page checks for it before relabelling.
      const answer: AppVersions | undefined = data?.data;
      if (!answer || !Array.isArray(answer.versions) || !Array.isArray(answer.onOlderVersions)) {
        throw new Error('app-versions: the answer is not in the expected shape');
      }
      return {
        ...answer,
        checkedAtUtc: metaRefreshedAt(data.meta) ?? null,
        analyticsFlag: analyticsFlagFromMeta(data.meta),
      };
    },
    staleTime: 0,
    gcTime: 0,
    retry: false,
    refetchInterval: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}
