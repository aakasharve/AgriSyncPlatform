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
        refreshToken: dto.refreshToken,
        expiresAtUtc: dto.expiresAtUtc,
    };
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
