// Sub-plan 04 Task 9: AgriSyncClient decomposition.
// This module is now a slim composition entry point. DTOs live in
// `./dtos`, transport-layer helpers in `./transport`, and resource
// methods in `./resources/*`. The class keeps its original public API
// (every previously-exposed method, with the same signature and
// behavior) so callsites importing `agriSyncClient` need no changes.
//
// All previously-exported names — DTOs, request/response types,
// SyncMutationType, etc. — are re-exported below so existing
// `from '../../infrastructure/api/AgriSyncClient'` imports continue
// to compile.

import axios, { AxiosError, AxiosInstance, InternalAxiosRequestConfig } from 'axios';
import { reportClientError } from '../telemetry/ClientErrorReporter';
import {
    clearAuthSession,
    getAuthSession,
    setAuthSession,
    type AuthSession,
} from './AuthTokenStore';
import { SYNC_MUTATION_TYPES } from '../sync/SyncMutationCatalog';
import {
    APP_VERSION,
    type HttpTransport,
    type RetriableRequestConfig,
    resolveApiBaseUrl,
    shouldSkipAuthRetry,
    toAuthSession,
} from './transport';
import type {
    AbandonScheduleRequest,
    AdoptScheduleRequest,
    AiDashboardResponse,
    AiHealthResponse,
    AiJobStatusResponse,
    AiParseResponse,
    AiProviderConfigResponse,
    AdminOpsHealthDto,
    AttachmentDto,
    AuthResponseDto,
    CreateAttachmentRequest,
    CreateAttachmentResponse,
    CreateExtractionSessionResponse,
    CropScheduleTemplateDto,
    GetExtractionSessionResponse,
    LoginRequest,
    MigrateScheduleRequest,
    ScheduleSubscriptionDto,
    SyncPullResponse,
    SyncPushRequest,
    SyncPushResponse,
    UpdateAiProviderConfigRequest,
} from './dtos';
import * as Auth from './resources/AuthResource';
import * as Sync from './resources/SyncResource';
import * as Attachments from './resources/AttachmentsResource';
import * as Ai from './resources/AiResource';
import * as Admin from './resources/AdminResource';
import * as Schedule from './resources/ScheduleResource';
import * as Export from './resources/ExportResource';

// ---------------------------------------------------------------------------
// Re-exports — keep every name the rest of the codebase imports from this
// module compiling without source changes at the callsites.
// ---------------------------------------------------------------------------

// SyncMutationType is the canonical union of mutation names. The single
// source of truth is sync-contract/schemas/mutation-types.json — see
// SyncMutationCatalog.ts (auto-generated). Re-exported here because
// API layer types historically lived in this module; downstream code
// continues to import SyncMutationType from AgriSyncClient.
export type { SyncMutationType } from '../sync/SyncMutationCatalog';
export { SYNC_MUTATION_TYPES };

export type {
    AbandonScheduleRequest,
    AdminOpsHealthDto,
    AdoptScheduleRequest,
    AiDashboardResponse,
    AiHealthResponse,
    AiJobStatusResponse,
    AiParseResponse,
    AiProviderConfigResponse,
    AllowedTransitionsDto,
    AttachmentDto,
    AttentionBoardDto,
    AttentionCardDto,
    AuthResponseDto,
    CostEntryDto,
    CreateAttachmentRequest,
    CreateAttachmentResponse,
    CreateExtractionSessionResponse,
    CropCycleDto,
    CropScheduleTemplateDto,
    DailyLogDto,
    DayLedgerAllocationDto,
    DayLedgerDto,
    ExtractionSessionDraftResponse,
    FarmDto,
    FinanceCorrectionDto,
    GetExtractionSessionResponse,
    LocationDto,
    LoginRequest,
    LogTaskDto,
    MigrateScheduleRequest,
    OpsErrorEventDto,
    OpsFarmErrorDto,
    PlannedTask,
    PlotDto,
    ScheduleSubscriptionDto,
    SyncOperatorDto,
    SyncPullResponse,
    SyncPushMutation,
    SyncPushRequest,
    SyncPushResponse,
    SyncPushResult,
    UpdateAiProviderConfigRequest,
    VerificationEventDto,
    VerificationStatus,
} from './dtos';

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export class AgriSyncClient implements HttpTransport {
    readonly http: AxiosInstance;
    readonly authHttp: AxiosInstance;
    private refreshPromise: Promise<AuthSession | null> | null = null;

    constructor() {
        const baseURL = resolveApiBaseUrl();
        this.http = axios.create({ baseURL });
        this.authHttp = axios.create({ baseURL });

        this.http.interceptors.request.use((config) => this.attachAccessToken(config));
        this.http.interceptors.request.use((config) => {
            config.headers.set('X-App-Version', APP_VERSION);
            return config;
        });
        this.authHttp.interceptors.request.use((config) => {
            config.headers.set('X-App-Version', APP_VERSION);
            return config;
        });
        this.http.interceptors.response.use(
            response => response,
            (error: AxiosError) => {
                // Ops Phase 3 — report critical endpoint failures to /telemetry/client-error
                const url = error.config?.url ?? '';
                const status = error.response?.status;
                const isNetworkError = !error.response;
                if (isNetworkError) {
                    reportClientError({ type: 'network_error', endpoint: url, message: error.message });
                } else if (status && status >= 400) {
                    reportClientError({ type: 'api_failure', endpoint: url, statusCode: status });
                }
                return this.tryRefreshAndRetry(error);
            });
    }

    // --- Auth -------------------------------------------------------------

    login(request: LoginRequest): Promise<AuthResponseDto> {
        return Auth.login(this, request);
    }

    register(request: { phone: string; password: string; displayName: string; appId?: string; role?: string }): Promise<AuthResponseDto> {
        return Auth.register(this, request);
    }

    refreshToken(refreshToken: string): Promise<AuthResponseDto> {
        return Auth.refreshToken(this, refreshToken);
    }

    getCurrentUser(): Promise<unknown> {
        return Auth.getCurrentUser(this);
    }

    generateReferralCode(): Promise<{ code: string }> {
        return Auth.generateReferralCode(this);
    }

    getMeContext(): Promise<import('../../core/session/MeContextService').MeContext> {
        return Auth.getMeContext(this);
    }

    getAffiliationStats(): Promise<{ referralsTotal: number; referralsQualified: number; benefitsEarned: number }> {
        return Auth.getAffiliationStats(this);
    }

    getAffiliationEvents(limit = 20): Promise<Array<{ id: string; eventType: string; occurredAtUtc: string; metadata: string | null }>> {
        return Auth.getAffiliationEvents(this, limit);
    }

    // --- Schedule ---------------------------------------------------------

    getCropScheduleTemplates(cropKey: string): Promise<CropScheduleTemplateDto[]> {
        return Schedule.getCropScheduleTemplates(this, cropKey);
    }

    adoptSchedule(plotId: string, cycleId: string, body: AdoptScheduleRequest): Promise<ScheduleSubscriptionDto> {
        return Schedule.adoptSchedule(this, plotId, cycleId, body);
    }

    migrateSchedule(plotId: string, cycleId: string, body: MigrateScheduleRequest): Promise<ScheduleSubscriptionDto> {
        return Schedule.migrateSchedule(this, plotId, cycleId, body);
    }

    abandonSchedule(plotId: string, cycleId: string, body: AbandonScheduleRequest): Promise<ScheduleSubscriptionDto> {
        return Schedule.abandonSchedule(this, plotId, cycleId, body);
    }

    // --- Sync -------------------------------------------------------------

    pushSyncBatch(request: SyncPushRequest): Promise<SyncPushResponse> {
        return Sync.pushSyncBatch(this, request);
    }

    pullSyncChanges(sinceCursorIso?: string): Promise<SyncPullResponse> {
        return Sync.pullSyncChanges(this, sinceCursorIso);
    }

    // --- Attachments ------------------------------------------------------

    createAttachment(request: CreateAttachmentRequest): Promise<CreateAttachmentResponse> {
        return Attachments.createAttachment(this, request);
    }

    uploadAttachmentFile(attachmentId: string, file: Blob, fileName = 'attachment.bin', mimeType?: string): Promise<void> {
        return Attachments.uploadAttachmentFile(this, attachmentId, file, fileName, mimeType);
    }

    getAttachmentMetadata(attachmentId: string): Promise<AttachmentDto> {
        return Attachments.getAttachmentMetadata(this, attachmentId);
    }

    getAttachmentDownloadUrl(attachmentId: string): string {
        return Attachments.getAttachmentDownloadUrl(this, attachmentId);
    }

    listAttachments(entityId: string, entityType: string): Promise<AttachmentDto[]> {
        return Attachments.listAttachments(this, entityId, entityType);
    }

    // --- AI ---------------------------------------------------------------

    parseVoice(
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
        return Ai.parseVoice(this, textTranscript, options);
    }

    parseVoiceLog(
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
        return Ai.parseVoiceLog(this, audio, mimeType, context, farmId, options);
    }

    parseTextLog(
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
        return Ai.parseTextLog(this, text, context, farmId, options);
    }

    extractReceipt(image: Blob, mimeType: string, farmId: string, idempotencyKey?: string): Promise<Record<string, unknown>> {
        return Ai.extractReceipt(this, image, mimeType, farmId, idempotencyKey);
    }

    extractPatti(image: Blob, mimeType: string, cropName: string, farmId: string, idempotencyKey?: string): Promise<Record<string, unknown>> {
        return Ai.extractPatti(this, image, mimeType, cropName, farmId, idempotencyKey);
    }

    createReceiptSession(farmId: string, image: Blob, mimeType: string, idempotencyKey?: string): Promise<CreateExtractionSessionResponse> {
        return Ai.createReceiptSession(this, farmId, image, mimeType, idempotencyKey);
    }

    createPattiSession(farmId: string, cropName: string, image: Blob, mimeType: string, idempotencyKey?: string): Promise<CreateExtractionSessionResponse> {
        return Ai.createPattiSession(this, farmId, cropName, image, mimeType, idempotencyKey);
    }

    getExtractionSession(sessionId: string): Promise<GetExtractionSessionResponse> {
        return Ai.getExtractionSession(this, sessionId);
    }

    getAiJobStatus(jobId: string): Promise<AiJobStatusResponse> {
        return Ai.getAiJobStatus(this, jobId);
    }

    getAiHealth(): Promise<AiHealthResponse> {
        return Ai.getAiHealth(this);
    }

    getAiProviderConfig(): Promise<AiProviderConfigResponse> {
        return Ai.getAiProviderConfig(this);
    }

    updateAiProviderConfig(request: UpdateAiProviderConfigRequest): Promise<AiProviderConfigResponse> {
        return Ai.updateAiProviderConfig(this, request);
    }

    getAiDashboard(): Promise<AiDashboardResponse> {
        return Ai.getAiDashboard(this);
    }

    // --- Admin ------------------------------------------------------------

    getAdminOpsHealth(): Promise<AdminOpsHealthDto> {
        return Admin.getAdminOpsHealth(this);
    }

    // --- Export -----------------------------------------------------------

    exportDailySummary(farmId: string, date: string): Promise<Blob> {
        return Export.exportDailySummary(this, farmId, date);
    }

    exportMonthlyCost(farmId: string, year: number, month: number): Promise<Blob> {
        return Export.exportMonthlyCost(this, farmId, year, month);
    }

    exportVerificationReport(farmId: string, fromDate: string, toDate: string): Promise<Blob> {
        return Export.exportVerificationReport(this, farmId, fromDate, toDate);
    }

    // --- Internal: auth interceptor + 401 retry ---------------------------

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
