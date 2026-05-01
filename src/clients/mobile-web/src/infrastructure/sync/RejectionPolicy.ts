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
    'VALIDATION_FAILED',
    'FORBIDDEN',
    'UNAUTHORIZED',
    // Domain-level permanent errors that won't change on retry without
    // human intervention.
    'CONFLICT',
    'DUPLICATE_KEY',
    'NOT_FOUND',
    'GONE',
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
