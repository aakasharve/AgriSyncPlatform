import axios, { AxiosError, AxiosInstance, InternalAxiosRequestConfig } from 'axios';
import { clearAuthSession, getAuthSession, setAuthSession, type AuthSession } from './AuthTokenStore';

export type SyncMutationType =
    | 'create_farm'
    | 'create_plot'
    | 'create_crop_cycle'
    | 'create_daily_log'
    | 'add_log_task'
    | 'verify_log'
    | 'verify_log_v2'
    | 'add_cost_entry'
    | 'correct_cost_entry'
    | 'allocate_global_expense'
    | 'set_price_config'
    | 'create_attachment'
    | 'adopt_schedule'
    | 'migrate_schedule'
    | 'abandon_schedule';

export type VerificationStatus =
    | 'draft'
    | 'confirmed'
    | 'verified'
    | 'disputed'
    | 'correction_pending';

export interface LoginRequest {
    phone: string;
    password: string;
}

export interface AuthResponseDto {
    userId: string;
    accessToken: string;
    refreshToken: string;
    expiresAtUtc: string;
}

export interface SyncPushMutation {
    clientRequestId: string;
    clientCommandId?: string;
    mutationType: string;
    payload: unknown;
}

export interface SyncPushRequest {
    deviceId: string;
    mutations: SyncPushMutation[];
}

export interface SyncPushResult {
    clientRequestId: string;
    mutationType: string;
    status: 'applied' | 'duplicate' | 'failed';
    data?: unknown;
    errorCode?: string;
    errorMessage?: string;
}

export interface SyncPushResponse {
    serverTimeUtc: string;
    results: SyncPushResult[];
}

export interface FarmDto {
    id: string;
    name: string;
    ownerUserId: string;
    createdAtUtc: string;
    modifiedAtUtc: string;
}

export interface PlotDto {
    id: string;
    farmId: string;
    name: string;
    areaInAcres: number;
    createdAtUtc: string;
    modifiedAtUtc: string;
}

export interface CropCycleDto {
    id: string;
    farmId: string;
    plotId: string;
    cropName: string;
    stage: string;
    startDate: string;
    endDate?: string;
    createdAtUtc: string;
    modifiedAtUtc: string;
}

export interface LocationDto {
    latitude: number;
    longitude: number;
    accuracyMeters: number;
    altitude?: number;
    capturedAtUtc: string;
    provider: string;
    permissionState: string;
}

export interface LogTaskDto {
    id: string;
    activityType: string;
    notes?: string;
    occurredAtUtc: string;
}

export interface VerificationEventDto {
    id: string;
    status: string;
    reason?: string;
    verifiedByUserId: string;
    occurredAtUtc: string;
}

export interface DailyLogDto {
    id: string;
    farmId: string;
    plotId: string;
    cropCycleId: string;
    operatorUserId: string;
    logDate: string;
    idempotencyKey?: string;
    createdAtUtc: string;
    modifiedAtUtc: string;
    location?: LocationDto;
    lastVerificationStatus?: string;
    tasks: LogTaskDto[];
    verificationEvents: VerificationEventDto[];
}

export interface CostEntryDto {
    id: string;
    farmId: string;
    plotId?: string;
    cropCycleId?: string;
    category: string;
    description: string;
    amount: number;
    currencyCode: string;
    entryDate: string;
    createdByUserId: string;
    createdAtUtc: string;
    modifiedAtUtc: string;
    location?: LocationDto;
    isCorrected: boolean;
}

export interface FinanceCorrectionDto {
    id: string;
    costEntryId: string;
    originalAmount: number;
    correctedAmount: number;
    currencyCode: string;
    reason: string;
    correctedByUserId: string;
    correctedAtUtc: string;
    modifiedAtUtc: string;
}

export interface DayLedgerAllocationDto {
    id: string;
    plotId: string;
    allocatedAmount: number;
    currencyCode: string;
    allocatedAtUtc: string;
}

export interface DayLedgerDto {
    id: string;
    farmId: string;
    sourceCostEntryId: string;
    ledgerDate: string;
    allocationBasis: string;
    createdByUserId: string;
    createdAtUtc: string;
    modifiedAtUtc: string;
    allocations: DayLedgerAllocationDto[];
}

export interface PlannedTask {
    id: string;
    cropCycleId: string;
    plannedDate: string;
    taskType: string;
    description: string;
    status: string;
    createdAtUtc: string;
    modifiedAtUtc: string;
}

export interface SyncOperatorDto {
    userId: string;
    displayName: string;
    role: string;
}

export interface AttachmentDto {
    id: string;
    farmId: string;
    linkedEntityId: string;
    linkedEntityType: string;
    fileName: string;
    mimeType: string;
    status: string;
    localPath?: string | null;
    sizeBytes?: number | null;
    createdByUserId: string;
    createdAtUtc: string;
    modifiedAtUtc: string;
    uploadedAtUtc?: string | null;
    finalizedAtUtc?: string | null;
}

export interface CreateAttachmentRequest {
    farmId: string;
    linkedEntityId: string;
    linkedEntityType: string;
    fileName: string;
    mimeType: string;
    attachmentId?: string;
}

export interface CreateAttachmentResponse {
    attachment: AttachmentDto;
    uploadUrl: string;
}

export interface SyncPullResponse {
    serverTimeUtc: string;
    nextCursorUtc: string;
    farms: FarmDto[];
    plots: PlotDto[];
    cropCycles: CropCycleDto[];
    dailyLogs: DailyLogDto[];
    attachments: AttachmentDto[];
    costEntries: CostEntryDto[];
    financeCorrections: FinanceCorrectionDto[];
    dayLedgers: DayLedgerDto[];
    priceConfigs: unknown[];
    plannedActivities: unknown[];
    auditEvents: unknown[];
    operators?: SyncOperatorDto[];
    scheduleTemplates?: unknown[];
    scheduleSubscriptions?: ScheduleSubscriptionDto[];
    cropTypes?: unknown[];
    activityCategories?: string[];
    costCategories?: string[];
    referenceDataVersionHash?: string;
}

export interface AiParseResponse {
    success?: boolean;
    parsedLog: Record<string, unknown>;
    confidence: number;
    fieldConfidences?: Record<string, { score: number; level: string; reason?: string }>;
    suggestedAction?: string;
    modelUsed?: string;
    latencyMs?: number;
    validationOutcome?: string;
    jobId?: string;
}

export interface AiJobStatusResponse {
    id: string;
    status: string;
    operationType: string;
    createdAtUtc: string;
    completedAtUtc?: string;
    inputSpeechDurationMs?: number;
    inputRawDurationMs?: number;
    inputSessionMetadata?: unknown;
    attempts: Array<{
        attemptNumber: number;
        provider: string;
        isSuccess: boolean;
        failureClass: string;
        errorMessage?: string;
        latencyMs: number;
        confidenceScore?: number;
        estimatedCostUnits?: number;
        requestPayloadHash?: string;
        rawProviderResponse?: string;
        attemptedAtUtc: string;
    }>;
    result?: unknown;
}

export interface AiHealthResponse {
    module: string;
    statuses: Array<{
        provider: string;
        isHealthy: boolean;
    }>;
}

export interface AiProviderConfigResponse {
    id: string;
    defaultProvider: string;
    fallbackEnabled: boolean;
    isAiProcessingDisabled: boolean;
    maxRetries: number;
    circuitBreakerThreshold: number;
    circuitBreakerResetSeconds: number;
    voiceConfidenceThreshold: number;
    receiptConfidenceThreshold: number;
    voiceProvider?: string;
    receiptProvider?: string;
    pattiProvider?: string;
    modifiedAtUtc: string;
    modifiedByUserId: string;
}

export interface AiDashboardResponse {
    config: AiProviderConfigResponse;
    sinceUtc: string;
    providerStats?: Record<string, { successCount: number; failureCount: number }>;
    successes: Record<string, number>;
    failures: Record<string, number>;
    recentJobs: Array<{
        id: string;
        operationType: string;
        status: string;
        createdAtUtc: string;
        completedAtUtc?: string;
        providers: string[];
    }>;
}

// --- Admin Ops Health ---
export interface OpsErrorEventDto {
    eventType: string;
    endpoint: string;
    statusCode?: number;
    latencyMs?: number;
    farmId?: string;
    occurredAtUtc: string;
}

export interface OpsFarmErrorDto {
    farmId: string;
    errorCount: number;
    syncErrors: number;
    logErrors: number;
    voiceErrors: number;
    lastErrorAt: string;
}

export interface AdminOpsHealthDto {
    voiceInvocations24h: number;
    voiceFailures24h: number;
    voiceFailureRatePct: number;
    voiceAvgLatencyMs: number;
    voiceP95LatencyMs: number;
    recentErrors: OpsErrorEventDto[];
    topSufferingFarms: OpsFarmErrorDto[];
    /** null = alert views not yet created (Ops Phase 2 not deployed) */
    apiErrorSpike: boolean | null;
    voiceDegraded: boolean | null;
    computedAtUtc: string;
}

// --- Schedule Surface Definitions ---
export interface CropScheduleTemplateDto {
    id: string;
    templateKey: string;
    cropKey: string;
    name: string;
    versionTag: string;
    isPublished: boolean;
    tasks: Array<{
        id: string;
        taskType: string;
        stage: string;
        dayOffsetFromCycleStart: number;
        toleranceDaysPlusMinus: number;
    }>;
}

export interface ScheduleSubscriptionDto {
    id: string;
    farmId: string;
    plotId: string;
    cropCycleId: string;
    cropKey: string;
    scheduleTemplateId: string;
    scheduleVersionTag: string;
    adoptedAtUtc: string;
    state: 'Active' | 'Migrated' | 'Abandoned' | 'Completed';
    migratedFromSubscriptionId?: string;
    migrationReason?: string;
    stateChangedAtUtc?: string;
}

export interface AdoptScheduleRequest {
    farmId: string;
    scheduleTemplateId: string;
    subscriptionId?: string;
    clientCommandId?: string;
}

export interface MigrateScheduleRequest {
    farmId: string;
    newScheduleTemplateId: string;
    reason: string;
    reasonText?: string;
}

export interface AbandonScheduleRequest {
    farmId: string;
    reasonText?: string;
}

// --- Document Extraction Session ---

export interface ExtractionSessionDraftResponse {
    normalizedJson: unknown;
    overallConfidence: number;
    jobId?: string;
    providerUsed?: string;
    fallbackUsed?: boolean;
    warnings?: string[];
}

/** Response from POST /ai/document-sessions/receipt|patti */
export interface CreateExtractionSessionResponse {
    success: boolean;
    sessionId: string;
    status: string;
    draft: ExtractionSessionDraftResponse;
}

/** Response from GET /ai/document-sessions/{sessionId} */
export interface GetExtractionSessionResponse {
    sessionId: string;
    documentType: string;
    status: string;
    draftResult: unknown | null;
    draftConfidence: number;
    draftProvider: string | null;
    draftJobId: string | null;
    verifiedResult: unknown | null;
    verifiedConfidence: number | null;
    verificationProvider: string | null;
    verificationJobId: string | null;
    createdAtUtc: string;
    modifiedAtUtc: string;
}

export interface UpdateAiProviderConfigRequest {
    defaultProvider?: 'Sarvam' | 'Gemini';
    fallbackEnabled?: boolean;
    isAiProcessingDisabled?: boolean;
    maxRetries?: number;
    circuitBreakerThreshold?: number;
    circuitBreakerResetSeconds?: number;
    voiceConfidenceThreshold?: number;
    receiptConfidenceThreshold?: number;
    voiceProvider?: 'Sarvam' | 'Gemini' | null;
    receiptProvider?: 'Sarvam' | 'Gemini' | null;
    pattiProvider?: 'Sarvam' | 'Gemini' | null;
}

export interface AllowedTransitionsDto {
    currentStatus: string;
    allowedTransitions: Array<{
        targetStatus: string;
        requiredRole: string;
        description: string;
    }>;
}

export interface VerificationEventDto {
    id: string;
    logId: string;
    status: string;
    verifiedByUserId: string;
    reason?: string;
    occurredAtUtc: string;
}

interface RetriableRequestConfig extends InternalAxiosRequestConfig {
    _agriSyncRetry?: boolean;
}

type ViteImportMeta = ImportMeta & {
    env?: {
        VITE_AGRISYNC_API_URL?: unknown;
    };
};

function resolveApiBaseUrl(): string {
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

function normalizeSyncCursorForApi(sinceCursorIso?: string): string | undefined {
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

function toAuthSession(dto: AuthResponseDto): AuthSession {
    return {
        userId: dto.userId,
        accessToken: dto.accessToken,
        refreshToken: dto.refreshToken,
        expiresAtUtc: dto.expiresAtUtc,
    };
}

function shouldSkipAuthRetry(url?: string): boolean {
    if (!url) {
        return false;
    }

    return url.includes('/user/auth/login')
        || url.includes('/user/auth/register')
        || url.includes('/user/auth/refresh');
}

function normalizeVerificationStatus(status: string): VerificationStatus {
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

export class AgriSyncClient {
    private readonly http: AxiosInstance;
    private readonly authHttp: AxiosInstance;
    private refreshPromise: Promise<AuthSession | null> | null = null;

    constructor() {
        const baseURL = resolveApiBaseUrl();
        this.http = axios.create({ baseURL });
        this.authHttp = axios.create({ baseURL });

        this.http.interceptors.request.use((config) => this.attachAccessToken(config));
        this.http.interceptors.response.use(
            response => response,
            error => this.tryRefreshAndRetry(error));
    }

    async login(request: LoginRequest): Promise<AuthResponseDto> {
        clearAuthSession();
        const response = await this.authHttp.post<AuthResponseDto>('/user/auth/login', request);
        const session = toAuthSession(response.data);
        setAuthSession(session);
        return response.data;
    }

    async register(request: { phone: string; password: string; displayName: string; appId?: string; role?: string }): Promise<AuthResponseDto> {
        clearAuthSession();
        const response = await this.authHttp.post<AuthResponseDto>('/user/auth/register', request);
        const session = toAuthSession(response.data);
        setAuthSession(session);
        return response.data;
    }

    async refreshToken(refreshToken: string): Promise<AuthResponseDto> {
        const response = await this.authHttp.post<AuthResponseDto>('/user/auth/refresh', { refreshToken });
        const session = toAuthSession(response.data);
        setAuthSession(session);
        return response.data;
    }

    async getCurrentUser(): Promise<unknown> {
        const response = await this.http.get('/user/auth/me');
        return response.data;
    }

    /** POST /accounts/affiliation/code — idempotent, returns the caller's referral code. */
    async generateReferralCode(): Promise<{ code: string }> {
        const response = await this.http.post<{ code: string }>('/accounts/affiliation/code');
        return response.data;
    }

    /** GET /user/auth/me/context — aggregate: user + ownerAccounts + memberships + affiliation. */
    async getMeContext(): Promise<import('../../core/session/MeContextService').MeContext> {
        const response = await this.http.get('/user/auth/me/context');
        return response.data;
    }

    /** GET /accounts/affiliation/stats — referral counters. */
    async getAffiliationStats(): Promise<{ referralsTotal: number; referralsQualified: number; benefitsEarned: number }> {
        const response = await this.http.get('/accounts/affiliation/stats');
        return response.data;
    }

    /** GET /accounts/affiliation/events — recent growth events. */
    async getAffiliationEvents(limit = 20): Promise<Array<{ id: string; eventType: string; occurredAtUtc: string; metadata: string | null }>> {
        const response = await this.http.get(`/accounts/affiliation/events?limit=${limit}`);
        return response.data;
    }

    async getCropScheduleTemplates(cropKey: string): Promise<CropScheduleTemplateDto[]> {
        const response = await this.http.get<CropScheduleTemplateDto[]>(`/shramsafal/reference-data/crop-schedule-templates`, {
            params: { cropKey }
        });
        return response.data;
    }

    async adoptSchedule(plotId: string, cycleId: string, body: AdoptScheduleRequest): Promise<ScheduleSubscriptionDto> {
        const response = await this.http.post<ScheduleSubscriptionDto>(`/shramsafal/plots/${plotId}/cycles/${cycleId}/schedule/adopt`, body);
        return response.data;
    }

    async migrateSchedule(plotId: string, cycleId: string, body: MigrateScheduleRequest): Promise<ScheduleSubscriptionDto> {
        const response = await this.http.post<ScheduleSubscriptionDto>(`/shramsafal/plots/${plotId}/cycles/${cycleId}/schedule/migrate`, body);
        return response.data;
    }

    async abandonSchedule(plotId: string, cycleId: string, body: AbandonScheduleRequest): Promise<ScheduleSubscriptionDto> {
        const response = await this.http.post<ScheduleSubscriptionDto>(`/shramsafal/plots/${plotId}/cycles/${cycleId}/schedule/abandon`, body);
        return response.data;
    }

    async pushSyncBatch(request: SyncPushRequest): Promise<SyncPushResponse> {
        const response = await this.http.post<SyncPushResponse>('/sync/push', request);
        return response.data;
    }

    async pullSyncChanges(sinceCursorIso?: string): Promise<SyncPullResponse> {
        const normalizedCursor = normalizeSyncCursorForApi(sinceCursorIso);
        const params = normalizedCursor ? { since: normalizedCursor } : undefined;
        const response = await this.http.get<SyncPullResponse>('/sync/pull', { params });
        return response.data;
    }

    async createAttachment(request: CreateAttachmentRequest): Promise<CreateAttachmentResponse> {
        const response = await this.http.post<CreateAttachmentResponse>('/shramsafal/attachments', request);
        return response.data;
    }

    async uploadAttachmentFile(
        attachmentId: string,
        file: Blob,
        fileName = 'attachment.bin',
        mimeType?: string,
    ): Promise<void> {
        const payload = mimeType && file.type !== mimeType
            ? new Blob([file], { type: mimeType })
            : file;

        const formData = new FormData();
        formData.append('file', payload, fileName);
        await this.http.post(`/shramsafal/attachments/${encodeURIComponent(attachmentId)}/upload`, formData);
    }

    async getAttachmentMetadata(attachmentId: string): Promise<AttachmentDto> {
        const response = await this.http.get<AttachmentDto>(`/shramsafal/attachments/${encodeURIComponent(attachmentId)}`);
        return response.data;
    }

    getAttachmentDownloadUrl(attachmentId: string): string {
        const path = `/shramsafal/attachments/${encodeURIComponent(attachmentId)}/download`;
        const baseUrl = this.http.defaults.baseURL?.trim();

        if (!baseUrl) {
            return path;
        }

        return `${baseUrl.replace(/\/+$/, '')}${path}`;
    }

    async listAttachments(entityId: string, entityType: string): Promise<AttachmentDto[]> {
        const response = await this.http.get<AttachmentDto[]>('/shramsafal/attachments', {
            params: { entityId, entityType },
        });
        return response.data;
    }

    async parseVoice(
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

        const response = await this.http.post<AiParseResponse>('/shramsafal/ai/voice-parse', payload);
        return response.data;
    }

    async parseVoiceLog(
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

        const response = await this.http.post<AiParseResponse>('/shramsafal/ai/voice-parse', formData);
        return response.data;
    }

    async parseTextLog(
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
        const response = await this.http.post<AiParseResponse>('/shramsafal/ai/voice-parse', {
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

    async extractReceipt(
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

        const response = await this.http.post<Record<string, unknown>>('/shramsafal/ai/receipt-extract', formData);
        return response.data;
    }

    async extractPatti(
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

        const response = await this.http.post<Record<string, unknown>>('/shramsafal/ai/patti-extract', formData);
        return response.data;
    }

    async createReceiptSession(
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

        const response = await this.http.post<CreateExtractionSessionResponse>(
            '/shramsafal/ai/document-sessions/receipt',
            formData,
        );
        return response.data;
    }

    async createPattiSession(
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

        const response = await this.http.post<CreateExtractionSessionResponse>(
            '/shramsafal/ai/document-sessions/patti',
            formData,
        );
        return response.data;
    }

    async getExtractionSession(sessionId: string): Promise<GetExtractionSessionResponse> {
        const response = await this.http.get<GetExtractionSessionResponse>(
            `/shramsafal/ai/document-sessions/${encodeURIComponent(sessionId)}`,
        );
        return response.data;
    }

    async getAiJobStatus(jobId: string): Promise<AiJobStatusResponse> {
        const response = await this.http.get<AiJobStatusResponse>(`/shramsafal/ai/jobs/${encodeURIComponent(jobId)}`);
        return response.data;
    }

    async getAiHealth(): Promise<AiHealthResponse> {
        const response = await this.http.get<AiHealthResponse>('/shramsafal/ai/health');
        return response.data;
    }

    async getAiProviderConfig(): Promise<AiProviderConfigResponse> {
        const response = await this.http.get<AiProviderConfigResponse>('/shramsafal/ai/config');
        return response.data;
    }

    async updateAiProviderConfig(request: UpdateAiProviderConfigRequest): Promise<AiProviderConfigResponse> {
        const response = await this.http.put<AiProviderConfigResponse>('/shramsafal/ai/config', request);
        return response.data;
    }

    async getAiDashboard(): Promise<AiDashboardResponse> {
        const response = await this.http.get<AiDashboardResponse>('/shramsafal/ai/dashboard');
        return response.data;
    }

    async getAdminOpsHealth(): Promise<AdminOpsHealthDto> {
        const response = await this.http.get<AdminOpsHealthDto>('/shramsafal/admin/ops/health');
        return response.data;
    }

    async exportDailySummary(farmId: string, date: string): Promise<Blob> {
        const response = await this.http.get<Blob>('/shramsafal/export/daily-summary', {
            params: { farmId, date },
            responseType: 'blob'
        });
        return response.data;
    }

    async exportMonthlyCost(farmId: string, year: number, month: number): Promise<Blob> {
        const response = await this.http.get<Blob>('/shramsafal/export/monthly-cost', {
            params: { farmId, year, month },
            responseType: 'blob'
        });
        return response.data;
    }

    async exportVerificationReport(farmId: string, fromDate: string, toDate: string): Promise<Blob> {
        const response = await this.http.get<Blob>('/shramsafal/export/verification', {
            params: { farmId, fromDate, toDate },
            responseType: 'blob'
        });
        return response.data;
    }

    private attachAccessToken(config: InternalAxiosRequestConfig): InternalAxiosRequestConfig {
        const session = getAuthSession();
        if (!session?.accessToken) {
            return config;
        }

        config.headers.set('Authorization', `Bearer ${session.accessToken}`);
        return config;
    }

    private async tryRefreshAndRetry(error: AxiosError): Promise<unknown> {
        const status = error.response?.status;
        const originalConfig = error.config as RetriableRequestConfig | undefined;

        if (status !== 401 || !originalConfig || originalConfig._agriSyncRetry) {
            throw error;
        }

        if (shouldSkipAuthRetry(originalConfig.url)) {
            throw error;
        }

        originalConfig._agriSyncRetry = true;

        const refreshedSession = await this.refreshSession();
        if (!refreshedSession) {
            throw error;
        }

        originalConfig.headers.set('Authorization', `Bearer ${refreshedSession.accessToken}`);
        return this.http.request(originalConfig);
    }

    private async refreshSession(): Promise<AuthSession | null> {
        if (this.refreshPromise) {
            return this.refreshPromise;
        }

        const currentSession = getAuthSession();
        if (!currentSession?.refreshToken) {
            clearAuthSession();
            return null;
        }

        this.refreshPromise = this.authHttp
            .post<AuthResponseDto>('/user/auth/refresh', { refreshToken: currentSession.refreshToken })
            .then(response => {
                const session = toAuthSession(response.data);
                setAuthSession(session);
                return session;
            })
            .catch(() => {
                clearAuthSession();
                return null;
            })
            .finally(() => {
                this.refreshPromise = null;
            });

        return this.refreshPromise;
    }
}

export const agriSyncClient = new AgriSyncClient();
