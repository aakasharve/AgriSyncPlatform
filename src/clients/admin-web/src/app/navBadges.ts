import { useShouldCallToday } from '@/hooks/useShouldCallToday';

/**
 * THE NAV BADGE STOPS BEING EMPTY (Preservation Register A53).
 *
 * `NavItem.badge` has been declared, styled and unset since Task 10, kept on
 * purpose with a note that said exactly why: *"it renders nothing today, so it
 * appears in no screenshot and gets removed as dead code, then gets 'invented'
 * later as a new feature."* This is the file that fills it.
 *
 * ── Why the sidebar does not know what a suffering farm is ────────────────
 * `AdminShell` renders destinations. It must not learn which watchlists exist,
 * which module keys gate them, or how two of them merge — that knowledge lives
 * in one hook and this map is the whole of the coupling: a route path to a
 * number. Adding a second badge is a line here, not a change to the shell.
 *
 * ── The cost, measured rather than waved at ───────────────────────────────
 * The count is only useful from OTHER screens — a badge visible only while you
 * are already looking at Home is decoration — so it is computed in the shell
 * and therefore on every screen. React Query dedupes it against Home's own
 * copy, so opening Home adds nothing.
 *
 *   `/admin/farms/silent-churn`  staleTime 300s, NO refetchInterval, behind the
 *                                server's `AdminMaterialized` output cache.
 *   `/admin/farms/suffering`     staleTime 60s + refetchInterval 60s, behind a
 *                                30-second `AdminLive` output cache.
 *
 * So a console left open costs about one extra request per minute to a
 * 30-second-cached endpoint. The measured ceiling on the production box is
 * roughly 32 simultaneous requests; this is a rounding error against it, and it
 * is stated here so the next person adding a badge knows the budget exists.
 *
 * Both requests are gated on the reader's own entitlements inside the hook, so
 * an admin who may not read either watchlist issues neither request — the
 * sidebar cannot become a way to ask for data the route guards refuse.
 */

/** Keyed by `NavItem.to`. A path absent from the map has no computed badge. */
export type NavBadgeMap = Partial<Record<string, number>>;

export function useNavBadges(): NavBadgeMap {
  const { badgeCount } = useShouldCallToday();

  /* `null` means the count would be a floor — see `badgeCount`'s own note.
     Leaving the key out is what makes the pill disappear, rather than a 0,
     which would be the "measured zero over a broken feed" defect wearing a
     sidebar. */
  return badgeCount === null ? {} : { '/': badgeCount };
}
