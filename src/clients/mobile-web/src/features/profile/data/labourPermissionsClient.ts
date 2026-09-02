/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * labourPermissionsClient — who may fix labour on this farm.
 *
 *   `GET  /shramsafal/farms/{farmId}/labour-permissions`
 *   `PUT  /shramsafal/farms/{farmId}/labour-permissions/{targetUserId}`
 *
 * ── THE DEFECT THIS EXISTS TO CLOSE (`P5`) ───────────────────────────────────
 * `TeamMemberCard` has been rendering four per-member capability switches that
 * are LOCAL STATE AND NOTHING ELSE. They reach no server, and the pull
 * reconciler recomputes `capabilities` from the member's role on every sync
 * (`profileAndCropsReconciler.ts:150` -> `capabilitiesForRole`), so an owner's
 * decision is silently overwritten the next time the app talks to the server.
 * A control that looks functional and does nothing is the exact thing `P5`
 * forbids. Phase 5 shipped the two routes above; this is the client half.
 *
 * ── TWO THINGS THAT WOULD RE-CREATE THE DEFECT ───────────────────────────────
 *
 * 1. **`isGrantEditable: false` MUST render permanently-on and non-interactive.**
 *    An owner-tier member carries the capability BY ROLE (owner-tier ONLY since
 *    2026-09-02, D5 — a Mukadam's switch is real now); their stored grant flag
 *    is `false` and setting it changes nothing. The server refuses such a
 *    request outright (409 `ShramSafal.LabourManagementCarriedByRole`), so a
 *    switch that appears to move and then does not is today's mock wearing a
 *    server's clothes. Render `canManageLabourRecords`, never
 *    `hasExplicitGrant` — the first is the effective answer, the second is only
 *    the stored column.
 *
 * 2. **The roster MUST come from this read.** `profile.operators[].id` is a
 *    LOCAL profile id, not a server `userId`; `TeamMemberCard` keys on it
 *    today. Addressing a PUT with one would target a user the server has never
 *    heard of. There is no mapping between the two, so there is no clever way
 *    to reconcile them — the server's own list is the only correct roster for
 *    this control.
 *
 * ── DESIRED STATE, NOT A TOGGLE ──────────────────────────────────────────────
 * The PUT carries `canManageLabourRecords: true|false` — what the caller wants
 * to be TRUE, not "flip it". A farmer on a rural connection who taps, loses
 * signal, and retries converges on the state he chose instead of oscillating
 * back. That is what makes it idempotent without an Idempotency-Key.
 *
 * TRANSPORT (binding, same reasoning as `labourClient` / `fieldOperatorClient`):
 * the app's ONE shared HTTP client, `agriSyncClient.http`. Its interceptor
 * attaches the access token and `X-Device-Id`, and refreshes-and-replays a 401
 * once before any caller sees it. No private `fetch()` copy.
 *
 * @module features/profile/data/labourPermissionsClient
 */
import { agriSyncClient } from '../../../infrastructure/api/AgriSyncClient';

/**
 * WHY this member may (or may not) manage labour records. Mirrors
 * `LabourPermissionDto.Source` — sent as the enum NAME, never its ordinal, so
 * inserting a member into the server enum cannot silently re-map history.
 */
export type LabourPermissionSource =
    /** Owner tier — carries the capability by role. Not editable. */
    | 'OwnerTier'
    /** An owner granted it explicitly. Editable. */
    | 'ExplicitGrant'
    /** No grant, and the role does not carry it. Editable. */
    | 'NotGranted';

/**
 * One member's labour authority on one farm, exactly as the server reports it.
 *
 * Kept as its own frontend type rather than re-exporting a DTO, following
 * `fieldOperatorClient`'s convention: a wire-shape change then costs one mapper
 * rather than a signature change at every call site.
 */
export interface LabourPermission {
    /** The SERVER's user id. The only id a PUT may be addressed with. */
    userId: string;
    /** `AppRole` name — "PrimaryOwner" / "Mukadam" / "Worker" / … */
    role: string;
    /** Membership status name — "Active" / "Suspended" / "PendingApproval" / … */
    status: string;
    /**
     * The EFFECTIVE answer: may this member correct labour, manage
     * field-operator identity, change attribution, approve/verify and correct
     * duration? THIS is what a switch renders — never `hasExplicitGrant`.
     */
    canManageLabourRecords: boolean;
    /**
     * The stored column — the owner's explicit decision. Always `false` for
     * owner-tier, the roles that carry the capability anyway, which is
     * precisely why rendering it would show an owner as "off" while he can in
     * fact do everything.
     */
    hasExplicitGrant: boolean;
    source: LabourPermissionSource;
    /**
     * `false` for owner tier ONLY: that switch must render permanently on and
     * NON-INTERACTIVE. `true` for everyone else — a Mukadam included (D5,
     * 2026-09-02). The server refuses a non-editable write independently, so a
     * client that ignores this cannot fake it — it can only lie about it.
     */
    isGrantEditable: boolean;
    /**
     * ISO instant the responsibility ends, or null for कायम. Null once lapsed —
     * the server never reports an expired window as a live one.
     */
    labourGrantExpiresAtUtc: string | null;
}

/** The server's error code when a role already carries the capability. */
export const LABOUR_CAPABILITY_CARRIED_BY_ROLE =
    'ShramSafal.LabourManagementCarriedByRole';

/** Relative to `agriSyncClient.http`'s `baseURL`, same convention as `labourDataPath`. */
export const labourPermissionsPath = (farmId: string): string =>
    `/shramsafal/farms/${farmId}/labour-permissions`;

export const labourPermissionPath = (farmId: string, targetUserId: string): string =>
    `${labourPermissionsPath(farmId)}/${targetUserId}`;

/**
 * The farm's labour-permission roster.
 *
 * Throws on failure. This client never falls back to a mock roster or to the
 * local profile: rendering a switch beside a name the server did not send is
 * how a PUT ends up addressed to an id that does not exist.
 */
export async function fetchLabourPermissions(farmId: string): Promise<LabourPermission[]> {
    const response = await agriSyncClient.http.get<LabourPermission[]>(
        labourPermissionsPath(farmId),
    );
    return response.data;
}

/**
 * Sets — not toggles — one member's labour authority, and returns the single
 * row the server now holds.
 *
 * The RESPONSE is the truth, not the request. The caller must adopt the
 * returned row rather than assuming the value it asked for: `source` and
 * `isGrantEditable` can only be recomputed server-side, and a UI that assumed
 * its own request had landed would drift out of step with the rules it is
 * meant to be displaying.
 *
 * Throws on 403 (not an owner, self-target, target not a member, unknown farm)
 * and on 409 (`LABOUR_CAPABILITY_CARRIED_BY_ROLE`). Both must be surfaced, not
 * swallowed — a switch that silently fails to move is the defect this module
 * exists to remove.
 */
export async function setLabourPermission(
    farmId: string,
    targetUserId: string,
    canManageLabourRecords: boolean,
    labourGrantExpiresAtUtc: string | null = null,
): Promise<LabourPermission> {
    const response = await agriSyncClient.http.put<LabourPermission>(
        labourPermissionPath(farmId, targetUserId),
        { canManageLabourRecords, labourGrantExpiresAtUtc },
    );
    return response.data;
}

/**
 * Is this the server saying "that member's ROLE already carries it"?
 *
 * Narrow on purpose. A 409 with any other code, or a 403, is a different
 * situation and must not be dressed up as this one — an owner told the wrong
 * reason cannot act on it.
 *
 * Structural rather than `instanceof AxiosError`: the shared client's
 * interceptor re-throws, and asserting on the error CLASS would couple this to
 * the transport it deliberately does not name.
 */
export function isCarriedByRoleError(error: unknown): boolean {
    if (typeof error !== 'object' || error === null) return false;

    const response = (error as { response?: { status?: number; data?: unknown } }).response;
    if (!response || response.status !== 409) return false;

    const data = response.data;
    if (typeof data !== 'object' || data === null) return false;

    return (data as { error?: unknown }).error === LABOUR_CAPABILITY_CARRIED_BY_ROLE;
}
