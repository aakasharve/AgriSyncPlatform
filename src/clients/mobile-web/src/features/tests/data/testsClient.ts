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
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (WP-5 places), review B001 / B003:
 *   - The report response's recommendations are typed EXACTLY as the server's
 *     `TestRecommendationDto` (camelCase JSON) — `recommendationId`, not `id` —
 *     and mapped to the phone's shape (`DexieTestRecommendation`, keyed `id`)
 *     in ONE place, `mapApiRecommendationToDexie`. The old type claimed `id`,
 *     so every row written to `testRecommendations` had no key and IndexedDB
 *     rejected it. The server's `createdAtUtc` is kept as sent.
 *   - A failed call throws `TestsApiError`, carrying the HTTP status and the
 *     server's error code (`{ error: "ShramSafal.TestInvalidState" }` on a 400;
 *     a 403 `Forbid()` has no body). The message keeps its old
 *     "<op> failed (<status>)" form for logs.
 */

import { getAuthSession } from '../../../infrastructure/storage/AuthTokenStore';
import type {
    DexieTestInstance,
    DexieTestRecommendation,
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

/**
 * Raw shape of one recommendation (`TestRecommendationDto.cs`), field for field.
 * Guids arrive as strings and `DateTime` as an ISO string.
 */
export interface ApiTestRecommendation {
    recommendationId: string;
    testInstanceId: string;
    ruleCode: string;
    titleEn: string;
    titleMr: string;
    suggestedActivityName: string;
    suggestedOffsetDays: number;
    createdAtUtc: string;
}

/** Raw shape of `POST /test-instances/{id}/report` (`TestEndpoints.cs` → `{ testInstanceId, status, recommendations }`). */
export interface ApiRecordTestResultResponse {
    testInstanceId: string;
    status: string;
    recommendations: ApiTestRecommendation[];
}

/** What `recordResult` returns: the same, with each recommendation already in the phone's shape. */
export interface RecordTestResultResponse {
    testInstanceId: string;
    status: string;
    recommendations: DexieTestRecommendation[];
}

/** A failed tests-API call: the HTTP status and, when the server sent one, its error code. */
export class TestsApiError extends Error {
    readonly status: number;
    readonly code?: string;

    constructor(operation: string, status: number, code?: string) {
        super(`${operation} failed (${status})${code ? ` ${code}` : ''}`);
        this.name = 'TestsApiError';
        this.status = status;
        this.code = code;
    }
}

/** Build the error for a non-OK response, reading `{ error }` from the body when there is one. */
const failure = async (operation: string, response: Response): Promise<TestsApiError> => {
    let code: string | undefined;
    try {
        const body = (await response.json()) as { error?: unknown } | null;
        if (body && typeof body.error === 'string') code = body.error;
    } catch {
        /* no JSON body (a 403 Forbid sends none) */
    }
    return new TestsApiError(operation, response.status, code);
};

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

/** The ONE place a server recommendation becomes the phone's row: `recommendationId` → `id`, the rest as sent. */
export function mapApiRecommendationToDexie(dto: ApiTestRecommendation): DexieTestRecommendation {
    return {
        id: dto.recommendationId,
        testInstanceId: dto.testInstanceId,
        ruleCode: dto.ruleCode,
        titleEn: dto.titleEn,
        titleMr: dto.titleMr,
        suggestedActivityName: dto.suggestedActivityName,
        suggestedOffsetDays: dto.suggestedOffsetDays,
        createdAtUtc: dto.createdAtUtc,
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
    if (!response.ok) throw await failure('getTestQueue', response);
    const payload = (await response.json()) as ApiTestInstance[];
    return payload.map(mapApiInstanceToDexie);
};

export const getMissingTests = async (farmId: string): Promise<MissingTestSummary[]> => {
    const url = `${resolveBaseUrl()}/shramsafal/farms/${encodeURIComponent(farmId)}/missing-tests`;
    const response = await fetch(url, { method: 'GET', headers: authHeaders() });
    if (!response.ok) throw await failure('getMissingTests', response);
    return (await response.json()) as MissingTestSummary[];
};

export const getTestInstanceById = async (id: string): Promise<DexieTestInstance> => {
    const url = `${resolveBaseUrl()}/shramsafal/test-instances/${encodeURIComponent(id)}`;
    const response = await fetch(url, { method: 'GET', headers: authHeaders() });
    if (!response.ok) throw await failure('getTestInstanceById', response);
    const dto = (await response.json()) as ApiTestInstance;
    return mapApiInstanceToDexie(dto);
};

export const markCollected = async (testInstanceId: string): Promise<DexieTestInstance> => {
    const url = `${resolveBaseUrl()}/shramsafal/test-instances/${encodeURIComponent(testInstanceId)}/collect`;
    const response = await fetch(url, { method: 'POST', headers: authHeaders() });
    if (!response.ok) throw await failure('markCollected', response);
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
    if (!response.ok) throw await failure('recordResult', response);
    const payload = (await response.json()) as ApiRecordTestResultResponse;
    return {
        testInstanceId: payload.testInstanceId,
        status: payload.status,
        recommendations: (payload.recommendations ?? []).map(mapApiRecommendationToDexie),
    };
};

export const waiveTest = async (testInstanceId: string, reason: string): Promise<void> => {
    const url = `${resolveBaseUrl()}/shramsafal/test-instances/${encodeURIComponent(testInstanceId)}/waive`;
    const body = JSON.stringify({ reason });
    const response = await fetch(url, { method: 'POST', headers: authHeaders(), body });
    if (!response.ok) throw await failure('waiveTest', response);
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
    if (!response.ok) throw await failure('addRecommendationToPlan', response);
};
