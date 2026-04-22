import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { adminApi, type AdminResponse } from '@/lib/api';

export interface FarmSummary {
  farmId: string; name: string; ownerPhone: string; plan: string;
  wvfd7d: number | null; engagementTier: string | null;
  errors24h: number; lastLogAt: string | null; createdAt: string;
}
export interface FarmsList { items: FarmSummary[]; totalCount: number; page: number; pageSize: number; }
export interface SilentChurnItem { farmId: string; name: string; ownerPhone: string; plan: string; weeksSilent: number; lastLogAt: string | null; }
export interface SufferingItem { farmId: string; name: string; errorCount: number; syncErrors: number; logErrors: number; voiceErrors: number; lastErrorAt: string; }

export function useFarmsList(page: number, pageSize: number, search?: string, tier?: string) {
  return useQuery<AdminResponse<FarmsList>>({
    queryKey: ['farms', 'list', page, pageSize, search, tier],
    queryFn: async () => {
      const sp = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
      if (search) sp.set('search', search);
      if (tier) sp.set('tier', tier);
      const { data } = await adminApi.get<AdminResponse<FarmsList>>(`/shramsafal/admin/farms?${sp}`);
      return data;
    },
    staleTime: 60_000, placeholderData: keepPreviousData,
  });
}
export function useSilentChurn() {
  return useQuery<AdminResponse<SilentChurnItem[]>>({
    queryKey: ['farms', 'silent-churn'],
    queryFn: async () => { const { data } = await adminApi.get<AdminResponse<SilentChurnItem[]>>('/shramsafal/admin/farms/silent-churn'); return data; },
    staleTime: 300_000,
  });
}
export function useSuffering() {
  return useQuery<AdminResponse<SufferingItem[]>>({
    queryKey: ['farms', 'suffering'],
    queryFn: async () => { const { data } = await adminApi.get<AdminResponse<SufferingItem[]>>('/shramsafal/admin/farms/suffering'); return data; },
    staleTime: 60_000, refetchInterval: 60_000,
  });
}
