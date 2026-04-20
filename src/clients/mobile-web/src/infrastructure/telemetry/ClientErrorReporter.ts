/**
 * ClientErrorReporter — Ops Observability Phase 3
 *
 * Silently reports failed API calls and JS exceptions to
 * POST /telemetry/client-error so they appear in:
 *   - mis.farmer_suffering_watchlist (nightly Metabase)
 *   - AdminOpsPage.tsx "Recent Errors" feed (live)
 *
 * RULES:
 *   1. Never throws. Never blocks the caller. Fire-and-forget only.
 *   2. Only reports CRITICAL_ENDPOINTS — non-critical failures are noise.
 *   3. No auth header needed — the endpoint is public (rate-limited 10/IP/min).
 *   4. Session deduplication: same endpoint+status pair is only reported
 *      once per 60 seconds to prevent flooding on repeated retries.
 */

/** Endpoints that directly block a farmer's core action if they fail. */
const CRITICAL_ENDPOINTS = [
    '/sync/push',
    '/logs',
    '/ai/parse-voice',
    '/ai/extract',
    '/schedule/adopt',
    '/schedule/migrate',
    '/verif',
] as const;

type ErrorType = 'api_failure' | 'network_error' | 'js_exception';

interface ClientErrorPayload {
    type: ErrorType;
    endpoint?: string;
    statusCode?: number;
    latencyMs?: number;
    message?: string;
}

/** In-memory dedup: "endpoint:status" → timestamp of last report */
const recentReports = new Map<string, number>();
const DEDUP_WINDOW_MS = 60_000;

function isCritical(endpoint: string): boolean {
    return CRITICAL_ENDPOINTS.some(fragment =>
        endpoint.toLowerCase().includes(fragment));
}

function shouldReport(payload: ClientErrorPayload): boolean {
    if (payload.type === 'js_exception') return true; // always report JS crashes
    if (!payload.endpoint) return false;
    if (!isCritical(payload.endpoint)) return false;

    const key = `${payload.endpoint}:${payload.statusCode ?? 0}`;
    const last = recentReports.get(key);
    if (last && Date.now() - last < DEDUP_WINDOW_MS) return false;
    recentReports.set(key, Date.now());
    return true;
}

/**
 * Call this when a fetch fails or a critical endpoint returns an error.
 * Fire-and-forget — never await this from user-facing code.
 */
export function reportClientError(payload: ClientErrorPayload): void {
    if (!shouldReport(payload)) return;

    // Use queueMicrotask so this doesn't block the current call stack
    queueMicrotask(() => {
        void fetch('/telemetry/client-error', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            // keepalive: true allows this to survive page unload
            keepalive: true,
        }).catch(() => {
            // Swallow — telemetry must never surface errors to the user
        });
    });
}

/**
 * Call once at app startup to catch unhandled JS exceptions.
 * These are "white screen of death" events the farmer cannot report themselves.
 */
export function installGlobalErrorHandlers(): void {
    window.addEventListener('unhandledrejection', (event) => {
        const message = event.reason instanceof Error
            ? event.reason.message
            : String(event.reason ?? 'unhandled rejection');
        reportClientError({ type: 'js_exception', message });
    });
}
