/**
 * testsClient — CEI Phase 2 §4.5 API surface for the test stack.
 *
 * Backend endpoints (all authed, all under `/shramsafal/`):
 *   POST /test-protocols                           → create protocol
 *   POST /test-instances/schedule-from-plan        → schedule due dates
 *   POST /test-instances/{id}/collect              → mark collected
 *   POST /test-instances/{id}/report               → record results + recs
 *   POST /test-instances/{id}/waive                → waive with reason
 *   GET  /test-instances?cropCycleId=...           → queue for cycle
 *   GET  /test-instances/{id}                      → single instance
 *   GET  /farms/{farmId}/missing-tests             → per-farm missing board
 *
 * Responses use string enums ("Due", "Reported"...); we map them to the
 * numeric form that `DexieTestInstance.status` stores.
 */

import { getAuthSession } from '../../../infrastructure/storage/AuthTokenStore';
import type {
    DexieTestInstance,
    DexieTestResult,
} from '../../../infrastructure/storage/DexieDatabase';
import { parseTestInstanceStatus } from '../../../domain/tests/TestInstance';

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

// --------------------------------------------------------------------- DTOs

/** Raw shape returned by the server (`TestInstanceDto.cs`). */
interface ApiTestInstance {
    testInstanceId: string;
    testProtocolId: string;
    testProtocolName: string | null;
    protocolKind: string;
    cropCycleId: string;
    farmId: string;
    plotId: string;
    stageName: string;
    plannedDueDate: string; // "YYYY-MM-DD"
    status: string; // "Due" | "Collected" | ...
    collectedByUserId: string | null;
    collectedAtUtc: string | null;
    reportedByUserId: string | null;
    reportedAtUtc: string | null;
    attachmentCount: number;
    resultCount: number;
    modifiedAtUtc: string;
}

export interface MissingTestSummary {
    testInstanceId: string;
    plotId: string;
    cropCycleId: string;
    stageName: string;
    testProtocolName: string;
    plannedDueDate: string;
    daysOverdue: number;
}

export interface ResultInput {
    parameterCode: string;
    parameterValue: string;
    unit: string;
    referenceRangeLow?: number;
    referenceRangeHigh?: number;
}

export interface RecordTestResultResponse {
    testInstanceId: string;
    status: string;
    recommendations: Array<{
        id: string;
        testInstanceId: string;
        ruleCode: string;
        titleEn: string;
        titleMr: string;
        suggestedActivityName: string;
        suggestedOffsetDays: number;
    }>;
}

const mapKindString = (k: string): number => {
    switch (k) {
        case 'Soil': return 0;
        case 'Water': return 1;
        case 'Tissue': return 2;
        case 'Residue': return 3;
        default: return 4;
    }
};

/** Convert the server DTO shape into the Dexie cache shape. */
export function mapApiInstanceToDexie(dto: ApiTestInstance): DexieTestInstance {
    return {
        id: dto.testInstanceId,
        testProtocolId: dto.testProtocolId,
        testProtocolName: dto.testProtocolName ?? undefined,
        protocolKind: mapKindString(dto.protocolKind),
        cropCycleId: dto.cropCycleId,
        farmId: dto.farmId,
        plotId: dto.plotId,
        stageName: dto.stageName,
        plannedDueDate: dto.plannedDueDate,
        status: parseTestInstanceStatus(dto.status),
        collectedByUserId: dto.collectedByUserId ?? undefined,
        collectedAtUtc: dto.collectedAtUtc ?? undefined,
        reportedByUserId: dto.reportedByUserId ?? undefined,
        reportedAtUtc: dto.reportedAtUtc ?? undefined,
        // results/attachments are summary counts on the list DTO; detail endpoint
        // doesn't return the full arrays either. Store empty placeholders so the
        // card can show "N params" based on protocol.parameterCodes.length.
        attachmentIds: [],
        results: [] as DexieTestResult[],
        modifiedAtUtc: dto.modifiedAtUtc,
        createdAtUtc: dto.modifiedAtUtc,
    };
}

// ---------------------------------------------------------------- client ops

export const getTestQueue = async (
    cropCycleId: string,
    _includeReported: boolean = true,
): Promise<DexieTestInstance[]> => {
    void _includeReported; // server always includes reported today; flag reserved
    const url = `${resolveBaseUrl()}/shramsafal/test-instances?cropCycleId=${encodeURIComponent(cropCycleId)}`;
    const response = await fetch(url, { method: 'GET', headers: authHeaders() });
    if (!response.ok) throw new Error(`getTestQueue failed (${response.status})`);
    const payload = (await response.json()) as ApiTestInstance[];
    return payload.map(mapApiInstanceToDexie);
};

export const getMissingTests = async (farmId: string): Promise<MissingTestSummary[]> => {
    const url = `${resolveBaseUrl()}/shramsafal/farms/${encodeURIComponent(farmId)}/missing-tests`;
    const response = await fetch(url, { method: 'GET', headers: authHeaders() });
    if (!response.ok) throw new Error(`getMissingTests failed (${response.status})`);
    return (await response.json()) as MissingTestSummary[];
};

export const getTestInstanceById = async (id: string): Promise<DexieTestInstance> => {
    const url = `${resolveBaseUrl()}/shramsafal/test-instances/${encodeURIComponent(id)}`;
    const response = await fetch(url, { method: 'GET', headers: authHeaders() });
    if (!response.ok) throw new Error(`getTestInstanceById failed (${response.status})`);
    const dto = (await response.json()) as ApiTestInstance;
    return mapApiInstanceToDexie(dto);
};

export const markCollected = async (testInstanceId: string): Promise<DexieTestInstance> => {
    const url = `${resolveBaseUrl()}/shramsafal/test-instances/${encodeURIComponent(testInstanceId)}/collect`;
    const response = await fetch(url, { method: 'POST', headers: authHeaders() });
    if (!response.ok) throw new Error(`markCollected failed (${response.status})`);
    const dto = (await response.json()) as ApiTestInstance;
    return mapApiInstanceToDexie(dto);
};

export const recordResult = async (
    testInstanceId: string,
    results: ResultInput[],
    attachmentIds: string[],
    clientCommandId?: string,
): Promise<RecordTestResultResponse> => {
    const url = `${resolveBaseUrl()}/shramsafal/test-instances/${encodeURIComponent(testInstanceId)}/report`;
    const body = JSON.stringify({
        results,
        attachmentIds,
        clientCommandId: clientCommandId ?? null,
    });
    const response = await fetch(url, { method: 'POST', headers: authHeaders(), body });
    if (!response.ok) throw new Error(`recordResult failed (${response.status})`);
    return (await response.json()) as RecordTestResultResponse;
};

export const waiveTest = async (testInstanceId: string, reason: string): Promise<void> => {
    const url = `${resolveBaseUrl()}/shramsafal/test-instances/${encodeURIComponent(testInstanceId)}/waive`;
    const body = JSON.stringify({ reason });
    const response = await fetch(url, { method: 'POST', headers: authHeaders(), body });
    if (!response.ok) throw new Error(`waiveTest failed (${response.status})`);
};

/** Add a recommendation to the farmer's plan (reuses the existing endpoint). */
export const addRecommendationToPlan = async (params: {
    cropCycleId: string;
    farmId: string;
    activityName: string;
    stage: string;
    plannedDate: string; // ISO "YYYY-MM-DD"
    reason: string;
    clientCommandId?: string;
}): Promise<void> => {
    const url = `${resolveBaseUrl()}/shramsafal/planned-activities`;
    const body = JSON.stringify({
        cropCycleId: params.cropCycleId,
        farmId: params.farmId,
        activityName: params.activityName,
        stage: params.stage,
        plannedDate: params.plannedDate,
        reason: params.reason,
        clientCommandId: params.clientCommandId ?? null,
    });
    const response = await fetch(url, { method: 'POST', headers: authHeaders(), body });
    if (!response.ok) throw new Error(`addRecommendationToPlan failed (${response.status})`);
};
