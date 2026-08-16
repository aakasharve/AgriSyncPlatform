/**
 * verifierIdentity — who, in server terms, is approving this log?
 *
 * WHY THIS EXISTS (WAVE-1.4 fix, spec: dfes-companion-2026-07-11):
 * `useTrustLayer` sent `farmerProfile.activeOperatorId` as the wire's
 * `verifierUserId`. On a fresh device that field is the LITERAL STRING
 * `'owner'` — `useAppData`'s initial profile seeds three placeholder
 * operators (`'owner'`, `'manager1'`, `'verifier1'`) so the UI has names to
 * show before the first sync. The canonical `verify_log_v2` contract
 * (`sync-contract/schemas/payloads/verify_log_v2.zod.ts`) types
 * `verifierUserId` as `ZGuid`, so the placeholder made
 * `mutationQueue.enqueue` throw at the offline boundary and the approval
 * silently rolled back. The button did nothing, every time, until a sync
 * pull happened to carry operators (`profileAndCropsReconciler` returns the
 * existing profile untouched when `operators.length === 0`, so a delta pull
 * keeps `'owner'` indefinitely).
 *
 * SAME DAY-ONE HOLE CLASS AS WAVE-1.1 (`LogFactory.hasApprovalAuthority`):
 * there, an identity comparison (`activeOperatorId === 'owner'`) broke
 * post-sync; here an identity is DEMANDED pre-sync. Both come from treating
 * the placeholder as if it were a real identity. It never is.
 *
 * THE RULE: the only real identities on this device are (a) an operator id
 * that came from the server (a UUID, written by `profileAndCropsReconciler`
 * from `SyncOperatorDto.userId`) and (b) the authenticated session's
 * `userId` (`AuthTokenStore`, minted by the server at login). Prefer the
 * active operator when it is real; otherwise fall back to the signed-in
 * user — who is, on a fresh single-user device, the same person. If neither
 * is real, return `null` and let the caller BLOCK the action. We never
 * invent an id, and we never hand a placeholder to a contract that requires
 * a UUID.
 *
 * NOT AN AUTHORITY CLAIM. The server ignores `verifierUserId` when deciding
 * whether the approval is allowed — it derives the actor from the JWT and
 * the role from `GetUserRoleForFarmAsync`, and refuses any payload that
 * declares its own authority. This resolver only answers "which id do we
 * put on the wire", never "may this person approve".
 */

/**
 * Mirrors `ZGuid` in `sync-contract/schemas/payloads/_shared.zod.ts`.
 * Duplicated rather than imported so `core/domain` keeps zero dependencies
 * on the sync contract package; the drift risk is covered by
 * `useTrustLayer.freshDevice.test.tsx`, which parses the queued payload with
 * the REAL `VerifyLogV2Payload` schema rather than this regex.
 */
const SERVER_IDENTITY_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * True only for an id the SERVER issued. The pre-sync placeholders
 * (`'owner'`, `'manager1'`, `'verifier1'`) and `'unknown'` all fail this.
 */
export function isServerIdentity(candidate: string | null | undefined): boolean {
    return typeof candidate === 'string' && SERVER_IDENTITY_PATTERN.test(candidate.trim());
}

/**
 * Resolves the id to put on a `verify_log_v2` payload, or `null` when this
 * device holds no real identity yet (not signed in AND not synced). `null`
 * means BLOCK — never substitute a placeholder.
 */
export function resolveVerifierUserId(
    activeOperatorId: string | null | undefined,
    sessionUserId: string | null | undefined
): string | null {
    const operatorId = activeOperatorId?.trim();
    if (isServerIdentity(operatorId)) {
        return operatorId as string;
    }

    const userId = sessionUserId?.trim();
    if (isServerIdentity(userId)) {
        return userId as string;
    }

    return null;
}
