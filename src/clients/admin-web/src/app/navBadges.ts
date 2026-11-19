/**
 * THE NAV BADGE SLOT IS KEPT, AND IT IS EMPTY AGAIN (Preservation Register A53; B24).
 *
 * `NavItem.badge` is declared and styled, and this map is the one place a route's
 * computed badge would come from. It is empty and makes NO request: a count
 * drawn from the call-list feeds must not appear in the sidebar of every
 * screen (amendment C8). No badge is planned here.
 */

/** Keyed by `NavItem.to`. A path absent from the map has no computed badge. */
export type NavBadgeMap = Partial<Record<string, number>>;

const NO_BADGES: NavBadgeMap = {};

export function useNavBadges(): NavBadgeMap {
  return NO_BADGES;
}
