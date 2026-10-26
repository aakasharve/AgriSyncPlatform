/**
 * spec: plr-d7-m1-multiuser-2026-10-26 (step 1) — the ONE phone-side reading of a farm seat's
 * status. Both farm lists the phone holds (`/shramsafal/farms/mine` and `/me/context`) now list
 * every seat that has not ended, so they can carry a typed-code join REQUEST still waiting for
 * the owner (`PendingApproval`) and, later, a paused seat (`Suspended`). The server grants such
 * a seat nothing (every data and write gate counts Active seats only), so the phone must never
 * open, select or label one as a farm the person is in.
 *
 * A seat WITHOUT a status comes from an older server, which granted every seat it listed:
 * reading it as Active is what that server meant (doctrine P11 — no behaviour change there).
 */
export const isActiveSeat = (seat: { status?: string | null }): boolean =>
    !seat.status || seat.status === 'Active';

/**
 * spec: plr-d7-m1-multiuser-2026-10-26 (step 1) — the query this phone adds to EVERY call of
 * `GET /shramsafal/farms/mine` and `GET /user/auth/me/context`. Only with it does the server list
 * the seats that are not Active (PendingApproval / Suspended / PendingOtpClaim); without it the
 * server answers Active seats only — exactly what an installed older app (e.g. the 1.0.16 APK)
 * understood, so that app is never shown a request as a farm it is in (doctrine P11). This phone
 * asks for every seat and reads each one through `isActiveSeat`.
 */
export const INCLUDE_PENDING_SEATS_QUERY = 'includePending=true';
