import { getAuthSession } from '../../../infrastructure/storage/AuthTokenStore';

export interface ComplianceSignalDto {
    id: string;
    farmId: string;
    plotId: string;
    cropCycleId?: string | null;
    ruleCode: string;
    severity: 'Info' | 'Watch' | 'NeedsAttention' | 'Critical';
    suggestedAction: string;
    titleEn: string;
    titleMr: string;
    descriptionEn: string;
    descriptionMr: string;
    payloadJson: string;
    firstSeenAtUtc: string;
    lastSeenAtUtc: string;
    acknowledgedAtUtc?: string | null;
    resolvedAtUtc?: string | null;
    resolutionNote?: string | null;
    isOpen: boolean;
}

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
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (session?.accessToken) {
        headers['Authorization'] = `Bearer ${session.accessToken}`;
    }
    return headers;
};

export async function getSignals(farmId: string, options?: {
    includeResolved?: boolean;
    includeAcknowledged?: boolean;
}): Promise<ComplianceSignalDto[]> {
    const params = new URLSearchParams();
    if (options?.includeResolved) params.set('includeResolved', 'true');
    if (options?.includeAcknowledged) params.set('includeAcknowledged', 'true');

    const qs = params.toString();
    const url = `${resolveBaseUrl()}/farms/${farmId}/compliance${qs ? `?${qs}` : ''}`;

    const res = await fetch(url, { headers: authHeaders() });
    if (!res.ok) return [];
    return res.json() as Promise<ComplianceSignalDto[]>;
}

export async function acknowledgeSignal(signalId: string): Promise<boolean> {
    const url = `${resolveBaseUrl()}/compliance/${signalId}/acknowledge`;
    const res = await fetch(url, { method: 'POST', headers: authHeaders() });
    return res.ok;
}

export async function resolveSignal(signalId: string, note: string): Promise<boolean> {
    const url = `${resolveBaseUrl()}/compliance/${signalId}/resolve`;
    const res = await fetch(url, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ note }),
    });
    return res.ok;
}

export async function triggerEvaluate(farmId: string): Promise<void> {
    const url = `${resolveBaseUrl()}/compliance/evaluate/${farmId}`;
    await fetch(url, { method: 'POST', headers: authHeaders() });
}
