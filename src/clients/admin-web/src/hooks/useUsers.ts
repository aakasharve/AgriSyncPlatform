import { useQuery } from '@tanstack/react-query';
import { adminApi, type AdminResponse } from '@/lib/api';
import { keepPreviousDataWithinOrg, useOrgKey } from '@/lib/orgQuery';

export interface UserSummary {
  userId: string; phone: string; displayName: string | null; email: string | null;
  apps: string[]; createdAt: string; lastLoginAt: string | null;
}
export interface UsersList { items: UserSummary[]; totalCount: number; page: number; pageSize: number; }

/** Org in the key, and `keepPreviousData` stopped at the org boundary (A7, A25,
 *  T12 S3) — see the notes in `useFarms.ts` and `lib/orgQuery.ts`. */
export function useUsersList(page: number, pageSize: number, search?: string) {
  const org = useOrgKey();
  return useQuery<AdminResponse<UsersList>>({
    queryKey: ['users', 'list', org, page, pageSize, search],
    queryFn: async () => {
      const sp = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
      if (search) sp.set('search', search);
      const { data } = await adminApi.get<AdminResponse<UsersList>>(`/shramsafal/admin/users?${sp}`);
      return data;
    },
    staleTime: 60_000, placeholderData: keepPreviousDataWithinOrg<AdminResponse<UsersList>>(org),
  });
}
