import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { adminApi, type AdminResponse } from '@/lib/api';

export interface UserSummary {
  userId: string; phone: string; displayName: string | null; email: string | null;
  apps: string[]; createdAt: string; lastLoginAt: string | null;
}
export interface UsersList { items: UserSummary[]; totalCount: number; page: number; pageSize: number; }

export function useUsersList(page: number, pageSize: number, search?: string) {
  return useQuery<AdminResponse<UsersList>>({
    queryKey: ['users', 'list', page, pageSize, search],
    queryFn: async () => {
      const sp = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
      if (search) sp.set('search', search);
      const { data } = await adminApi.get<AdminResponse<UsersList>>(`/shramsafal/admin/users?${sp}`);
      return data;
    },
    staleTime: 60_000, placeholderData: keepPreviousData,
  });
}
