import { useQuery } from '@tanstack/react-query';
import { adminApi, type AdminResponse } from '@/lib/api';
import { keepPreviousDataWithinOrg, useOrgKey } from '@/lib/orgQuery';
import type { OpsErrorEvent } from './useOpsHealth';
export type { OpsErrorEvent };

export interface OpsErrorsPage {
  items: OpsErrorEvent[];
  totalCount: number;
  page: number;
  pageSize: number;
}

export interface OpsErrorsParams {
  page: number;
  pageSize: number;
  endpoint?: string;
  since?: string;
}

/** Org in the key, and `keepPreviousData` stopped at the org boundary (A7, A25,
 *  T12 S3) — see the notes in `useFarms.ts` and `lib/orgQuery.ts`. */
export function useOpsErrors(params: OpsErrorsParams) {
  const org = useOrgKey();
  return useQuery<AdminResponse<OpsErrorsPage>>({
    queryKey: ['ops', 'errors', org, params],
    queryFn: async () => {
      const sp = new URLSearchParams({
        page: String(params.page),
        pageSize: String(params.pageSize),
      });
      if (params.endpoint) sp.set('endpoint', params.endpoint);
      if (params.since) sp.set('since', params.since);
      const { data } = await adminApi.get<AdminResponse<OpsErrorsPage>>(
        `/shramsafal/admin/ops/errors?${sp}`
      );
      return data;
    },
    staleTime: 25_000,
    refetchInterval: 30_000,
    placeholderData: keepPreviousDataWithinOrg<AdminResponse<OpsErrorsPage>>(org),
  });
}
