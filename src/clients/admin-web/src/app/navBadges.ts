/**
 * THE NAV BADGE SLOT IS KEPT, AND IT IS EMPTY AGAIN (Preservation Register A53; B24).
 *
 * `NavItem.badge` is declared and styled, and this map is the one place a route's
 * computed badge would come from. It used to hold the "farms a person should call
 * today" count on Home, built from the silent-farms and repeated-problems feeds.
 * That list is now an idea ("Not built yet", H9, amendment B24): its two feeds
 * are broken, and a count drawn from them must not appear in the sidebar of every
 * screen. So this makes NO request and returns no badge. When H9 is real, the
 * count comes back here as one line, keyed by the route.
 */

/** Keyed by `NavItem.to`. A path absent from the map has no computed badge. */
export type NavBadgeMap = Partial<Record<string, number>>;

const NO_BADGES: NavBadgeMap = {};

export function useNavBadges(): NavBadgeMap {
  return NO_BADGES;
}
