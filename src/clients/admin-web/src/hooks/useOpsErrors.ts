import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { adminApi, type AdminResponse } from '@/lib/api';
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

export function useOpsErrors(params: OpsErrorsParams) {
  return useQuery<AdminResponse<OpsErrorsPage>>({
    queryKey: ['ops', 'errors', params],
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
    placeholderData: keepPreviousData,
  });
}
