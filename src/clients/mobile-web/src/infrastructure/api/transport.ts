// Sub-plan 04 Task 9: AgriSyncClient decomposition.
// Transport-layer helpers and the shared HttpTransport interface that
// resource modules depend on. Behavior is byte-for-byte equivalent to
// the original AgriSyncClient.ts — only the structural layout changed.

import type { AxiosInstance, InternalAxiosRequestConfig } from 'axios';
import packageJson from '../../../package.json';
import type { AuthSession } from '../storage/AuthTokenStore';
import type { AuthResponseDto, VerificationStatus } from './dtos';

// Sub-plan 02 Task 11: client min-version gate.
// Stamped on every outgoing request as `X-App-Version`. The backend
// PushSyncBatchHandler compares this against the catalog's
// descriptor.SinceVersion and rejects mutations with `CLIENT_TOO_OLD`
// if the client is below the threshold for that mutation. Sub-plan 04
// will replace this with a build-time inject (vite define) that also
// embeds the git SHA suffix.
export const APP_VERSION: string = packageJson.version;

export interface RetriableRequestConfig extends InternalAxiosRequestConfig {
    _agriSyncRetry?: boolean;
}

type ViteImportMeta = ImportMeta & {
    env?: {
        VITE_AGRISYNC_API_URL?: unknown;
    };
};

export function resolveApiBaseUrl(): string {
    const apiUrl = (import.meta as ViteImportMeta).env?.VITE_AGRISYNC_API_URL;
    if (typeof apiUrl === 'string' && apiUrl.trim().length > 0) {
        try {
            const validated = new URL(apiUrl);
            return validated.toString().replace(/\/+$/, '');
        } catch {
            throw new Error(`VITE_AGRISYNC_API_URL is not a valid URL: "${apiUrl}"`);
        }
    }

    return '';
}

export function normalizeSyncCursorForApi(sinceCursorIso?: string): string | undefined {
    if (!sinceCursorIso) {
        return undefined;
    }

    const trimmed = sinceCursorIso.trim();
    if (!trimmed) {
        return undefined;
    }

    if (trimmed === '0') {
        return '0';
    }

    const parsed = new Date(trimmed);
    if (Number.isNaN(parsed.getTime())) {
        return '0';
    }

    // Backend accepts `yyyy-MM-ddTHH:mm:ssZ` reliably for pull cursors.
    return parsed.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export function toAuthSession(dto: AuthResponseDto): AuthSession {
    return {
        userId: dto.userId,
        accessToken: dto.accessToken,
        expiresAtUtc: dto.expiresAtUtc,
    };
}

/**
 * A refresh attempt has THREE outcomes, not two.
 *
 * The original signature was `Promise<AuthSession | null>`, and `null` was
 * made to carry two facts that require opposite responses:
 *
 *   - the server judged the credential and refused it  → destroy it
 *   - we never reached a server that could judge it    → keep it
 *
 * Collapsing those meant one dropped packet at app launch wiped the Android
 * Keystore refresh token — the only durable credential on the phone — and the
 * farmer was locked out for the life of the APK. This type is the fix: the
 * caller can no longer fail to distinguish the two, because the compiler will
 * not let it.
 *
 * It is the same TRANSPORT-vs-REJECTION axis the sync layer already draws in
 * `RejectionPolicy.categorizePushFailure`, which is the classifier this reuses.
 *
 * spec: secure-remembered-device-sessions-2026-06-24 (Task 6.2, amended)
 */
export type RefreshOutcome =
    /** The server issued a new session. Stored; the caller is authenticated. */
    | { kind: 'refreshed'; session: AuthSession }
    /**
     * The server read the request and refused it (401/403, or no stored
     * credential to send at all). Fail-closed: all local and Keystore auth
     * state has already been cleared by the time this is returned.
     */
    | { kind: 'rejected' }
    /**
     * Nothing judged the credential — no response at all, a 5xx/408/429, or a
     * 200 that was not a session (captive portal). Every credential is left
     * EXACTLY as it was, so the next attempt on a working connection succeeds.
     */
    | { kind: 'unreachable' };

/**
 * Does this response body actually contain a session?
 *
 * A captive portal (hotel, railway, village wifi) intercepts the POST and
 * answers 200 with its own HTML. Axios resolves, and the old code happily
 * built an `AuthSession` whose accessToken was `undefined` and wrote it to
 * storage — replacing a good token with a broken one. A 200 that is not a
 * session means we did not reach our server, which is `unreachable`.
 */
export function isAuthResponse(data: unknown): data is AuthResponseDto {
    if (typeof data !== 'object' || data === null) {
        return false;
    }
    const token = (data as { accessToken?: unknown }).accessToken;
    return typeof token === 'string' && token.length > 0;
}

export function shouldSkipAuthRetry(url?: string): boolean {
    if (!url) {
        return false;
    }

    return url.includes('/user/auth/login')
        || url.includes('/user/auth/register')
        || url.includes('/user/auth/refresh');
}

export function normalizeVerificationStatus(status: string): VerificationStatus {
    const normalized = status
        .trim()
        .replace(/([a-z])([A-Z])/g, '$1_$2')
        .replace(/[\s-]+/g, '_')
        .toLowerCase();

    switch (normalized) {
        case 'draft':
        case 'pending':
            return 'draft';
        case 'confirmed':
        case 'auto_approved':
            return 'confirmed';
        case 'verified':
        case 'approved':
            return 'verified';
        case 'disputed':
        case 'rejected':
            return 'disputed';
        case 'correction_pending':
            return 'correction_pending';
        default:
            return 'draft';
    }
}

/**
 * Shared transport surface that all resource modules depend on.
 * `http` is the auth-attached axios instance; `authHttp` is the bare
 * instance used for login/register/refresh (where attaching the
 * existing token would be wrong or absent).
 */
export interface HttpTransport {
    readonly http: AxiosInstance;
    readonly authHttp: AxiosInstance;
}
