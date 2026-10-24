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
    // TASK 8 (spec: 2026-08-28-labour-v2-release-1, P4/P5, Ruling R8) — this
    // was `return []`. It turned every non-OK response into a resolved empty
    // list, so `useComplianceSignals`'s `try/catch` never fired and the
    // warnings screen answered an HTTP error with "कोणत्याही चेतावण्या नाहीत"
    // — and, underneath, "your farms are on track". A reassurance a farmer
    // acts on must not be manufactured out of a failed request. A genuine
    // "none" still arrives as a 200 with an empty body, and still reads as
    // empty.
    if (!res.ok) throw new Error(`getSignals failed: ${res.status}`);
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
