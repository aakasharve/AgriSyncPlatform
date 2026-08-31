import { useActiveOrg } from '@/app/ActiveOrgProvider';

/**
 * HOW A QUERY IS SCOPED TO AN ORGANISATION. Two rules, one file.
 *
 * `useOrgKey()` is the segment every DATA query key carries. `useAdminScope`
 * has always keyed on the active org (useAdminScope.ts:72); every DATA key
 * omitted it, which is why switching organisations used to need a full page
 * reload — without one, React Query answered the new organisation's question
 * out of the previous organisation's cache. Nothing went red and nothing
 * looked wrong. The numbers were just somebody else's.
 *
 * `'none'` rather than `null`, because a query key is compared structurally
 * and a literal reads unambiguously in a devtools cache listing. It is the
 * spelling `useAdminScope` already used, so the two agree.
 */
export function useOrgKey(): string {
  return useActiveOrg().activeOrgId ?? 'none';
}

/**
 * `keepPreviousData`, STOPPED AT THE TENANT BOUNDARY.
 *
 * ── The hole this closes ──────────────────────────────────────────────────
 * Task 12 put the active organisation into every data query key, so a switch
 * changes the key and React Query can no longer answer org B's question out of
 * org A's cache entry. That is necessary and it is not sufficient.
 *
 * Farms, Users and API Errors are paginated and carry
 * `placeholderData: keepPreviousData` (Preservation Register A25). Its whole
 * job is to keep the PREVIOUS key's rows on screen while the next key loads,
 * so page 2 does not flash empty on the way to page 3. Put the org in the key
 * and that same mechanism cheerfully keeps the previous ORGANISATION's rows on
 * screen while the new organisation's rows load — one tenant's farmer names and
 * phone numbers, rendered under another tenant's name in the topbar, with a
 * "Refreshing…" label that reads as reassurance.
 *
 * Measured, not assumed: without the guard below, switching organisation on
 * `/farms` leaves org A's rows in the DOM for the whole flight of org B's
 * request. It is silent, nothing turns red, and the only visible clue is that
 * the numbers belong to somebody else.
 *
 * ── Why this is not just "drop keepPreviousData" ──────────────────────────
 * Because paging is the case it exists for, and paging is not a tenancy event.
 * The rule is narrower than the mechanism: keep the previous rows across a
 * PAGE or FILTER change, never across an ORGANISATION change.
 *
 * ── Why an index and not a search ─────────────────────────────────────────
 * Every data key in this console is spelled `[resource, view, org, ...vars]` —
 * prefix, then org, then the variables. `tenancy.contract.test.tsx` asserts
 * that position for all twelve keys, so this constant cannot silently drift
 * out of agreement with them.
 */
export const ORG_KEY_INDEX = 2;

/** The subset of a React Query `Query` this module needs. */
interface KeyedQuery {
  queryKey: readonly unknown[];
}

/**
 * Use as `placeholderData` on an org-scoped, paginated query.
 *
 * Returns the previous page's data when the previous query belonged to the
 * SAME organisation, and `undefined` — which renders as loading — when it did
 * not.
 */
export function keepPreviousDataWithinOrg<T>(
  org: string,
): (previousData: T | undefined, previousQuery: KeyedQuery | undefined) => T | undefined {
  return (previousData, previousQuery) => {
    if (!previousQuery) return previousData;
    return previousQuery.queryKey[ORG_KEY_INDEX] === org ? previousData : undefined;
  };
}
