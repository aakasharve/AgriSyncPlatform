import { useQuery } from '@tanstack/react-query';
import { adminApi, AdminModuleForbiddenError } from '@/lib/api';
import { useOrgKey } from '@/lib/orgQuery';
import type { AlertCheck } from '@/lib/alertRules';

/**
 * R10 (voice failing over 20% in six hours), asked of its own route.
 *
 * Each call counts live and writes audit rows on the server, and the answer is
 * not cached there. So it is requested once when the page opens and again only
 * when a person presses "Check again": no polling, no retry, no refetch on
 * window focus, and the answer never goes stale on its own.
 */
export function useOpsVoiceCheck() {
  const org = useOrgKey();
  return useQuery<AlertCheck>({
    queryKey: ['ops', 'voice-check', org],
    queryFn: async () => {
      const { data } = await adminApi.get<AlertCheck>('/shramsafal/admin/ops/voice-check');
      return data;
    },
    refetchInterval: false,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    staleTime: Infinity,
  });
}

/** True when the route refused this account (403 admin_platform_only). */
export function isVoiceCheckForbidden(error: unknown): boolean {
  if (error instanceof AdminModuleForbiddenError) return true;
  const status = (error as { response?: { status?: number } } | null)?.response?.status;
  return status === 403;
}
