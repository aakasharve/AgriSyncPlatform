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

export interface ServiceProofParams {
    format: 'ServiceProof' | 'Csv';
    byTemplateLineageRootId?: string;
    fromDate: string;  // ISO date string
    toDate: string;
    includeResolvedSignals?: boolean;
}

export async function generateServiceProof(params: ServiceProofParams): Promise<{ url: string; blob: Blob } | null> {
    const qs = new URLSearchParams();
    qs.set('format', params.format);
    if (params.byTemplateLineageRootId) qs.set('byTemplateLineageRootId', params.byTemplateLineageRootId);
    qs.set('fromDate', params.fromDate);
    qs.set('toDate', params.toDate);
    if (params.includeResolvedSignals) qs.set('includeResolvedSignals', 'true');

    const url = `${resolveBaseUrl()}/exports/verification-report?${qs.toString()}`;

    try {
        const res = await fetch(url, { headers: authHeaders() });
        if (!res.ok) return null;
        const blob = await res.blob();
        const objectUrl = URL.createObjectURL(blob);
        return { url: objectUrl, blob };
    } catch {
        return null;
    }
}
