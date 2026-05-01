// Sub-plan 04 Task 9: AgriSyncClient decomposition — AI surface.
// Voice/text parse, receipt/patti extraction, document sessions, jobs,
// health, and provider-config CRUD. Behavior identical to original.

import type {
    AiDashboardResponse,
    AiHealthResponse,
    AiJobStatusResponse,
    AiParseResponse,
    AiProviderConfigResponse,
    CreateExtractionSessionResponse,
    GetExtractionSessionResponse,
    UpdateAiProviderConfigRequest,
} from '../dtos';
import type { HttpTransport } from '../transport';

export async function parseVoice(
    t: HttpTransport,
    textTranscript: string,
    options: {
        farmId: string;
        plotId?: string;
        cropCycleId?: string;
        audioBase64?: string;
        audioMimeType?: string;
        idempotencyKey?: string;
        contextJson?: string;
        inputSpeechDurationMs?: number;
        inputRawDurationMs?: number;
        segmentMetadataJson?: string;
        requestPayloadHash?: string;
    },
): Promise<AiParseResponse> {
    const payload = {
        farmId: options.farmId,
        plotId: options.plotId,
        cropCycleId: options.cropCycleId,
        textTranscript,
        audioBase64: options.audioBase64,
        audioMimeType: options.audioMimeType,
        idempotencyKey: options.idempotencyKey,
        contextJson: options.contextJson,
        inputSpeechDurationMs: options.inputSpeechDurationMs,
        inputRawDurationMs: options.inputRawDurationMs,
        segmentMetadataJson: options.segmentMetadataJson,
        requestPayloadHash: options.requestPayloadHash,
    };

    const response = await t.http.post<AiParseResponse>('/shramsafal/ai/voice-parse', payload);
    return response.data;
}

export async function parseVoiceLog(
    t: HttpTransport,
    audio: Blob,
    mimeType: string,
    context: object,
    farmId: string,
    options?: {
        plotId?: string;
        cropCycleId?: string;
        idempotencyKey?: string;
        inputSpeechDurationMs?: number;
        inputRawDurationMs?: number;
        segmentMetadataJson?: string;
        requestPayloadHash?: string;
    },
): Promise<AiParseResponse> {
    const payload = mimeType && audio.type !== mimeType
        ? new Blob([audio], { type: mimeType })
        : audio;

    const formData = new FormData();
    formData.append('audio', payload, 'voice-input.webm');
    formData.append('farmId', farmId);
    formData.append('context', JSON.stringify(context));

    if (options?.plotId) formData.append('plotId', options.plotId);
    if (options?.cropCycleId) formData.append('cropCycleId', options.cropCycleId);
    if (options?.idempotencyKey) formData.append('idempotencyKey', options.idempotencyKey);
    if (options?.inputSpeechDurationMs !== undefined) formData.append('inputSpeechDurationMs', `${options.inputSpeechDurationMs}`);
    if (options?.inputRawDurationMs !== undefined) formData.append('inputRawDurationMs', `${options.inputRawDurationMs}`);
    if (options?.segmentMetadataJson) formData.append('segmentMetadata', options.segmentMetadataJson);
    if (options?.requestPayloadHash) formData.append('requestPayloadHash', options.requestPayloadHash);

    const response = await t.http.post<AiParseResponse>('/shramsafal/ai/voice-parse', formData);
    return response.data;
}

export async function parseTextLog(
    t: HttpTransport,
    text: string,
    context: object,
    farmId: string,
    options?: {
        plotId?: string;
        cropCycleId?: string;
        idempotencyKey?: string;
        inputSpeechDurationMs?: number;
        inputRawDurationMs?: number;
        segmentMetadataJson?: string;
        requestPayloadHash?: string;
    },
): Promise<AiParseResponse> {
    const response = await t.http.post<AiParseResponse>('/shramsafal/ai/voice-parse', {
        farmId,
        plotId: options?.plotId,
        cropCycleId: options?.cropCycleId,
        textTranscript: text,
        idempotencyKey: options?.idempotencyKey,
        contextJson: JSON.stringify(context),
        inputSpeechDurationMs: options?.inputSpeechDurationMs,
        inputRawDurationMs: options?.inputRawDurationMs,
        segmentMetadataJson: options?.segmentMetadataJson,
        requestPayloadHash: options?.requestPayloadHash,
    });
    return response.data;
}

export async function extractReceipt(
    t: HttpTransport,
    image: Blob,
    mimeType: string,
    farmId: string,
    idempotencyKey?: string,
): Promise<Record<string, unknown>> {
    const payload = mimeType && image.type !== mimeType
        ? new Blob([image], { type: mimeType })
        : image;

    const formData = new FormData();
    formData.append('image', payload, 'receipt-image.jpg');
    formData.append('farmId', farmId);
    if (idempotencyKey) formData.append('idempotencyKey', idempotencyKey);

    const response = await t.http.post<Record<string, unknown>>('/shramsafal/ai/receipt-extract', formData);
    return response.data;
}

export async function extractPatti(
    t: HttpTransport,
    image: Blob,
    mimeType: string,
    cropName: string,
    farmId: string,
    idempotencyKey?: string,
): Promise<Record<string, unknown>> {
    const payload = mimeType && image.type !== mimeType
        ? new Blob([image], { type: mimeType })
        : image;

    const formData = new FormData();
    formData.append('image', payload, 'patti-image.jpg');
    formData.append('farmId', farmId);
    formData.append('cropName', cropName);
    if (idempotencyKey) formData.append('idempotencyKey', idempotencyKey);

    const response = await t.http.post<Record<string, unknown>>('/shramsafal/ai/patti-extract', formData);
    return response.data;
}

export async function createReceiptSession(
    t: HttpTransport,
    farmId: string,
    image: Blob,
    mimeType: string,
    idempotencyKey?: string,
): Promise<CreateExtractionSessionResponse> {
    const payload = mimeType && image.type !== mimeType
        ? new Blob([image], { type: mimeType })
        : image;
    const formData = new FormData();
    formData.append('image', payload, 'receipt-image.jpg');
    formData.append('farmId', farmId);
    if (idempotencyKey) formData.append('idempotencyKey', idempotencyKey);

    const response = await t.http.post<CreateExtractionSessionResponse>(
        '/shramsafal/ai/document-sessions/receipt',
        formData,
    );
    return response.data;
}

export async function createPattiSession(
    t: HttpTransport,
    farmId: string,
    cropName: string,
    image: Blob,
    mimeType: string,
    idempotencyKey?: string,
): Promise<CreateExtractionSessionResponse> {
    const payload = mimeType && image.type !== mimeType
        ? new Blob([image], { type: mimeType })
        : image;
    const formData = new FormData();
    formData.append('image', payload, 'patti-image.jpg');
    formData.append('farmId', farmId);
    formData.append('cropName', cropName);
    if (idempotencyKey) formData.append('idempotencyKey', idempotencyKey);

    const response = await t.http.post<CreateExtractionSessionResponse>(
        '/shramsafal/ai/document-sessions/patti',
        formData,
    );
    return response.data;
}

export async function getExtractionSession(
    t: HttpTransport,
    sessionId: string,
): Promise<GetExtractionSessionResponse> {
    const response = await t.http.get<GetExtractionSessionResponse>(
        `/shramsafal/ai/document-sessions/${encodeURIComponent(sessionId)}`,
    );
    return response.data;
}

export async function getAiJobStatus(t: HttpTransport, jobId: string): Promise<AiJobStatusResponse> {
    const response = await t.http.get<AiJobStatusResponse>(`/shramsafal/ai/jobs/${encodeURIComponent(jobId)}`);
    return response.data;
}

export async function getAiHealth(t: HttpTransport): Promise<AiHealthResponse> {
    const response = await t.http.get<AiHealthResponse>('/shramsafal/ai/health');
    return response.data;
}

export async function getAiProviderConfig(t: HttpTransport): Promise<AiProviderConfigResponse> {
    const response = await t.http.get<AiProviderConfigResponse>('/shramsafal/ai/config');
    return response.data;
}

export async function updateAiProviderConfig(
    t: HttpTransport,
    request: UpdateAiProviderConfigRequest,
): Promise<AiProviderConfigResponse> {
    const response = await t.http.put<AiProviderConfigResponse>('/shramsafal/ai/config', request);
    return response.data;
}

export async function getAiDashboard(t: HttpTransport): Promise<AiDashboardResponse> {
    const response = await t.http.get<AiDashboardResponse>('/shramsafal/ai/dashboard');
    return response.data;
}
