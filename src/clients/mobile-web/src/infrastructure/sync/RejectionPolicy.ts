/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Sub-plan 04 / T-IGH-04-CONFLICT-STATUS-DURABILITY — server-rejection
 * categorization.
 *
 * The mutation queue distinguishes two flavors of rejection:
 *
 *   RETRYABLE   — transient. Mark FAILED, let markFailedAsPending() flip
 *                 the row back to PENDING for the next worker cycle. Examples:
 *                 network blip, NO_RESULT (server didn't respond),
 *                 generic 5xx, unknown reason.
 *
 *   PERMANENT   — durable. The mutation cannot succeed without user action.
 *                 Mark REJECTED_USER_REVIEW directly so it survives
 *                 markFailedAsPending() and surfaces in OfflineConflictPage.
 *                 Examples: client too old (need app upgrade), mutation
 *                 type unknown to server (typo or stale catalog), validation
 *                 4xx (payload shape wrong; user must edit and re-queue).
 *
 * Design rationale: Plan 04 §Architecture calls for "explicit state machines
 * for offline conflict" with a `rejected_user_review` state. Without a
 * categorization step, the auto-retry path (BackgroundSyncWorker.executeCycle
 * → markFailedAsPending) churns permanent rejections every 15 seconds and
 * the UI never surfaces them durably to the user.
 */

export type RejectionCategory = 'RETRYABLE' | 'PERMANENT';

/**
 * Error codes the server is known to return for permanent rejections.
 * Anything not listed here is treated as RETRYABLE — fail-safe toward
 * letting transient errors retry rather than silently parking them.
 *
 * Keep this list aligned with the backend's ErrorKind enum (Sub-plan 03
 * §Result/ErrorKind contract). The codes are matched case-insensitively
 * and tolerate prefix punctuation (e.g. "Validation.InvalidCommand").
 */
const PERMANENT_REJECTION_CODES: readonly string[] = [
    // Client compatibility — needs app upgrade.
    'CLIENT_TOO_OLD',
    'CLIENT_OUTDATED',
    // Catalog / contract mismatches.
    'MUTATION_TYPE_UNKNOWN',
    'MUTATION_TYPE_UNIMPLEMENTED',
    'PAYLOAD_SCHEMA_MISMATCH',
    // Server-side validation 4xx — user must edit and retry.
    'INVALID_COMMAND',
    'INVALID_PAYLOAD',
    // P0.6 — THE CODE THE SERVER ACTUALLY SENDS. Verified in
    // `PushSyncBatchHandler.cs` — every allow-list refusal returns
    // `ShramSafal.SyncInvalidPayload`. `normalizeCode` keeps the tail after the
    // last dot and upper-cases it, yielding `SYNCINVALIDPAYLOAD`, which the
    // underscored `INVALID_PAYLOAD` above never matched. So the single most
    // common permanent refusal in the system was classified RETRYABLE: the row
    // burned five charged retries and parked in FAILED, and
    // `ConflictResolutionService.list()` reads only REJECTED_USER_REVIEW — so
    // the farmer's correction did not merely fail, it failed INVISIBLY.
    //
    // This does not make a refused mutation succeed. It makes the refusal
    // reach a screen the farmer can act on, which is the honest half (`P5`).
    'SyncInvalidPayload',
    'VALIDATION_FAILED',
    'FORBIDDEN',
    'UNAUTHORIZED',
    // Domain-level permanent errors that won't change on retry without
    // human intervention.
    'CONFLICT',
    'DUPLICATE_KEY',
    'NOT_FOUND',
    'GONE',

    // -----------------------------------------------------------------------
    // P0.6, SECOND OCCURRENCE — the wire codes ShramSafal actually sends.
    //
    // DO NOT DELETE THESE AS DUPLICATES OF THE UNDERSCORED ENTRIES ABOVE.
    // They are not duplicates. `normalizeCode` keeps only the tail after the
    // last dot and upper-cases it — it does NOT insert word separators. So
    // `ShramSafal.InvalidCommand` normalises to `INVALIDCOMMAND`, which the
    // underscored `INVALID_COMMAND` never matches. The underscored spellings
    // are the abstract ErrorKind vocabulary; these are the strings that come
    // off the wire. Both have to be named. This is the identical mistake the
    // `SyncInvalidPayload` note above was written about, made again in the
    // codes below, which is why they get a block and not a one-liner.
    //
    // WHY `VerificationTransitionNotAllowedForRole` IS HERE — the O-4 chain:
    //   1. Founder decision O-4 (LABOUR_PHASE2 Phase 5) replaced the owner-only
    //      check in `ShramSafalAuthorizationEnforcer` with `LabourManagementGate`
    //      (`ShramSafalAuthorizationEnforcer.cs:151`), so a Mukadam now PASSES
    //      the enforcer instead of being stopped there.
    //   2. `VerifyLogHandler.cs:148` then refuses the transition deeper, in the
    //      state machine, with the accurate code
    //      `ShramSafal.VerificationTransitionNotAllowedForRole`.
    //   3. Before O-4 that same refusal arrived as `ShramSafal.Forbidden`,
    //      which IS listed above and parked correctly. The refusal did not
    //      change; only the code did, and the client never learned the new one.
    // So this entry is load-bearing for a path that a passing test suite would
    // not have caught: without it a permanently-refused approval re-pushes
    // every 15s to the retry cap and parks in `FAILED`, which
    // `ConflictResolutionService.list()` reads for the CAP-EXHAUSTED subset
    // only — the farmer is told late, by a chip with no hint, or not at all.
    // The server is right to be specific. The client is what had to learn it.
    //
    // ADMISSION RULE FOR THIS BLOCK (apply it before adding anything):
    // a code belongs here only when NOTHING can change the server's answer —
    // not waiting, and not another mutation this client may still be holding.
    // In practice that is exactly two families:
    //   (a) ROLE / AUTHORISATION refusals — no queued mutation changes who the
    //       caller is, so the next push gets the same answer as this one.
    //   (b) COMMAND-SHAPE refusals — the bytes are the bytes. Re-sending them
    //       unchanged is re-asking a question already answered.
    // Deliberately NOT admitted: `*NotFound` (a statement about a DIFFERENT
    // row — see `DEPENDENCY_PENDING_CODE` below), `*InvalidState`, and anything
    // whose truth depends on the order rows land in. Those self-heal, and
    // parking them would make the farmer resolve a conflict that was about to
    // resolve itself (`P9`).

    // (a) role / authorisation — the caller's role is not going to change
    //     between two pushes of the same queue.
    'VerificationTransitionNotAllowedForRole',
    'TestRoleNotAllowed',
    'ComplianceSignalRoleNotAllowed',
    'JobCardRoleNotAllowed',

    // (b) command shape — identical bytes, identical verdict, forever.
    'InvalidCommand',
    'InvalidVerificationReason',
    'InvalidVerificationStatus',
    'ComplianceSignalNoteRequired',
];

const PERMANENT_SET = new Set(
    PERMANENT_REJECTION_CODES.map(code => code.toUpperCase())
);

/**
 * Normalize a server-provided error code to the lookup form used by
 * PERMANENT_SET. Strips any "Category." prefix and lowercases.
 */
function normalizeCode(raw: string): string {
    const trimmed = raw.trim();
    if (trimmed.length === 0) {
        return '';
    }
    const lastDot = trimmed.lastIndexOf('.');
    const tail = lastDot >= 0 ? trimmed.slice(lastDot + 1) : trimmed;
    return tail.toUpperCase();
}

export interface RejectionInput {
    /** Server-provided error code, if any. Preferred signal. */
    errorCode?: string | null;
    /** Free-text error message; used only as a last-resort signal. */
    errorMessage?: string | null;
}

/**
 * Categorize a server rejection. Decision tree:
 *   1. errorCode matches a known PERMANENT code → PERMANENT.
 *   2. Empty errorCode AND empty errorMessage → RETRYABLE
 *      (assume transport-level failure; let it retry).
 *   3. errorMessage substring-matches a known PERMANENT code → PERMANENT.
 *      (some servers serialize codes only in the message body.)
 *   4. Otherwise → RETRYABLE.
 */
export function categorizeRejection(input: RejectionInput): RejectionCategory {
    const code = input.errorCode ? normalizeCode(input.errorCode) : '';
    if (code && PERMANENT_SET.has(code)) {
        return 'PERMANENT';
    }

    const message = input.errorMessage ?? '';
    if (!code && message.trim().length === 0) {
        return 'RETRYABLE';
    }

    // Last-ditch: scan the message for any permanent code substring.
    const messageUpper = message.toUpperCase();
    for (const permanent of PERMANENT_SET) {
        if (messageUpper.includes(permanent)) {
            return 'PERMANENT';
        }
    }

    return 'RETRYABLE';
}

/**
 * Test/diagnostic helper. Returns the canonical permanent-code list so
 * callers (e.g. ConflictResolutionService.hintFor) can stay in lock-step
 * with the policy without re-declaring the strings.
 */
export function getPermanentRejectionCodes(): readonly string[] {
    return PERMANENT_REJECTION_CODES;
}

// ---------------------------------------------------------------------------
// §P0.7 box 2a — the THIRD failure class: the parent, not the row.
// ---------------------------------------------------------------------------

/**
 * The one code that means "this row was refused because of something ELSE".
 *
 * `ShramSafalErrors.cs:29` — `Error.NotFound("ShramSafal.DailyLogNotFound", ...)`.
 * `normalizeCode` keeps the tail after the last dot and upper-cases it, so the
 * lookup form is `DAILYLOGNOTFOUND`.
 *
 * NOTE WHY THIS IS NOT SIMPLY ADDED TO `PERMANENT_REJECTION_CODES`, which is
 * the one-line change an executor reaches for first. Doing that would park
 * EVERY child of an in-flight parent in `REJECTED_USER_REVIEW` on the very
 * first cycle — including the ordinary, self-healing case where the parent is
 * merely one batch behind. The farmer would be asked to resolve a conflict that
 * was about to resolve itself. The code is not permanent and it is not
 * transient; it is a statement about a DIFFERENT row, and it needs the parent's
 * actual state to be classified. That resolution lives in `MutationDependency`.
 */
const DEPENDENCY_PENDING_CODE = 'DAILYLOGNOTFOUND';

/**
 * Did the server refuse this row because its parent daily log is missing?
 *
 * Same two signals and the same precedence as `categorizeRejection`: the code
 * first, then the message as a last resort, because some layers serialize the
 * code only into the body.
 */
export function isDependencyPendingRejection(input: RejectionInput): boolean {
    const code = input.errorCode ? normalizeCode(input.errorCode) : '';
    if (code === DEPENDENCY_PENDING_CODE) {
        return true;
    }

    const message = input.errorMessage ?? '';
    if (message.trim().length === 0) {
        return false;
    }

    return message.toUpperCase().includes(DEPENDENCY_PENDING_CODE);
}

// ---------------------------------------------------------------------------
// Labour Phase 2 -> Phase 1 (honesty backstop), Task T3 / finding R1.
// ---------------------------------------------------------------------------

/**
 * The SECOND axis of a failed push, and the one the auto-retry cap counts.
 *
 * `RejectionCategory` above answers "may this row ever succeed unaided?" for a
 * row the server gave a per-row verdict on. This answers a different question,
 * one step earlier: **did anything about THIS ROW get judged at all?**
 *
 * - `REJECTION`  the request completed and produced a verdict — the server (or
 *                the client's own mutation catalog) assessed this row and
 *                refused it. Retrying the identical bytes is unlikely to
 *                change that, so it COUNTS toward the auto-retry cap.
 * - `TRANSPORT`  nothing about this row was ever judged. The request did not
 *                reach a server that could answer, or the server answered
 *                "not now" about itself rather than about the row. The row's
 *                own validity is still unknown, so it must NOT count.
 *
 * WHY THIS EXISTS (`P5`, `P2`)
 * ----------------------------
 * `BackgroundSyncWorker`'s batch-level `catch` marked every in-flight row
 * FAILED with no distinction, and `markFailed` incremented `retryCount` every
 * time. Five 15-second cycles — **75 seconds** — of captive wifi, an API 5xx,
 * or a hibernated backend was enough to push every row past the cap, and
 * `markFailedAsPending` then refused to touch them **forever, including after
 * the network came back**. True airplane mode was safe (`safeRunCycle` returns
 * early when `navigator.onLine` is false); a *bad* connection was not. On rural
 * mobile data a bad connection is the default condition, not the edge case.
 *
 * The cap itself is right: something has to stop the app asking the server the
 * same broken question until the battery dies. What was wrong was charging a
 * row for the network's failure. This type is that distinction, made at the
 * only place where the information still exists — the moment of failure.
 */
export type MutationFailureKind =
    | 'TRANSPORT'
    | 'REJECTION'
    /**
     * §P0.7 box 2a — the row was judged, and the verdict was about a DIFFERENT
     * row: its parent daily log is not on the server yet. Uncharged for the
     * same reason `TRANSPORT` is uncharged — this row's own validity is still
     * unknown — but recorded separately, because "we never reached the server"
     * and "the server told us our parent is missing" are different facts and a
     * log line that conflates them cannot be debugged.
     *
     * Only produced when the parent is demonstrably still in progress. A parent
     * that will never move produces a durable rejection instead, not this.
     */
    | 'DEPENDENCY';

/**
 * HTTP statuses that describe the SERVER's own availability rather than the
 * request's merits. The server answered, but it did not judge the row.
 *
 * 408 request timeout · 429 too many requests · 5xx server error.
 */
function isServerUnavailableStatus(status: number): boolean {
    return status >= 500 || status === 408 || status === 429;
}

/**
 * Reads an HTTP status off a thrown push error without importing axios.
 *
 * `agriSyncClient.pushSyncBatch` is a thin wrapper over `http.post` — see
 * `SyncResource.ts:7-10` — so a raw `AxiosError` is what reaches
 * `BackgroundSyncWorker`'s catch. `AgriSyncClient.ts:208-209` already uses
 * exactly this discriminator (`error.response?.status` / `!error.response`) to
 * split `network_error` from `api_failure` in its telemetry, so this is the
 * codebase's own established test, duck-typed rather than re-imported to keep
 * this module dependency-free and unit-testable.
 */
function readHttpStatus(error: unknown): number | undefined {
    if (typeof error !== 'object' || error === null) {
        return undefined;
    }

    const response = (error as { response?: unknown }).response;
    if (typeof response !== 'object' || response === null) {
        return undefined;
    }

    const status = (response as { status?: unknown }).status;
    return typeof status === 'number' ? status : undefined;
}

/**
 * Classify a push failure that aborted the whole batch.
 *
 * Decision tree — fail-safe toward TRANSPORT, because charging a row for a
 * fault that was never its own is the defect this function exists to remove:
 *   1. no HTTP response at all (DNS, connection refused, TLS, timeout, CORS,
 *      a hibernated backend) -> TRANSPORT.
 *   2. a response whose status is about the server's availability
 *      (5xx / 408 / 429) -> TRANSPORT.
 *   3. any other status — 400, 401, 403, 404, 409, 422 — the server read the
 *      request and refused it on its merits -> REJECTION.
 */
export function categorizePushFailure(error: unknown): MutationFailureKind {
    const status = readHttpStatus(error);

    if (status === undefined) {
        return 'TRANSPORT';
    }

    return isServerUnavailableStatus(status) ? 'TRANSPORT' : 'REJECTION';
}
