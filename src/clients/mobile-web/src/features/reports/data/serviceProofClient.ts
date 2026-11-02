import { getAuthSession } from '../../../infrastructure/storage/AuthTokenStore';

interface ViteImportMeta {
    env?: { VITE_AGRISYNC_API_URL?: unknown };
}

const resolveBaseUrl = (): string => {
    const raw = (import.meta as ViteImportMeta).env?.VITE_AGRISYNC_API_URL;
    if (typeof raw === 'string' && raw.trim()) {
        return raw.trim().replace(/\/+$/, '');
    }
    return 'http://localhost:5048';
};

const authHeaders = (): Record<string, string> => {
    const session = getAuthSession();
    const headers: Record<string, string> = {};
    if (session?.accessToken) {
        headers['Authorization'] = `Bearer ${session.accessToken}`;
    }
    return headers;
};

/**
 * spec: plr-d10 lane F99 fix pass 1 (F100, row 15) — the screen called `/exports/verification-report`, a route the server
 * never had (404 for everyone). The server's report is `GET /shramsafal/export/verification?farmId&fromDate&toDate`: a
 * PDF of one farm's period, sent only to a seat that sees the farm's money and reads its records (MU-3,
 * `ExportEndpoints.MayExportAsync`). It has no CSV and no template or resolved-warning filter, so those are gone from the
 * screen rather than left as controls that do nothing (P5).
 */
export interface ServiceProofParams {
    farmId: string;
    fromDate: string;  // ISO date (YYYY-MM-DD)
    toDate: string;    // ISO date (YYYY-MM-DD)
}

/** `refused`: the server answered 403 (this seat may not take the farm's report); `failed`: anything else went wrong. */
export type ServiceProofResult =
    | { kind: 'ok'; url: string; blob: Blob }
    | { kind: 'refused' }
    | { kind: 'failed' };

export async function generateServiceProof(params: ServiceProofParams): Promise<ServiceProofResult> {
    const qs = new URLSearchParams();
    qs.set('farmId', params.farmId);
    qs.set('fromDate', params.fromDate);
    qs.set('toDate', params.toDate);

    const url = `${resolveBaseUrl()}/shramsafal/export/verification?${qs.toString()}`;

    try {
        const res = await fetch(url, { headers: authHeaders() });
        if (res.status === 403) return { kind: 'refused' };
        if (!res.ok) return { kind: 'failed' };
        const blob = await res.blob();
        const objectUrl = URL.createObjectURL(blob);
        return { kind: 'ok', url: objectUrl, blob };
    } catch {
        return { kind: 'failed' };
    }
}
