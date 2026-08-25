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
//
// spec: secure-remembered-device-sessions-2026-06-24
// - Both axios instances created with withCredentials: true so the
//   HttpOnly agrisync_refresh cookie is sent/received on every request.
// - X-Device-Id header sourced from DeviceIdStore (reuse, no new source).
// - refreshSession() posts no refresh token — the cookie carries it.
// - rememberDevice flag stored in localStorage key agrisync_remember_device_v1.

import axios, { AxiosError, AxiosInstance, InternalAxiosRequestConfig } from 'axios';
import { reportClientError } from '../telemetry/ClientErrorReporter';
import {
    clearAuthSession,
    getAuthSession,
    setAuthSession,
} from '../storage/AuthTokenStore';
import { getOrCreateDeviceId } from '../storage/DeviceIdStore';
import { getRememberDevice } from '../storage/RememberDeviceStore';
import {
    clearNativeRefreshSession,
    getNativeRefreshSession,
    setNativeRefreshSession,
    isNativeSecureRefreshEnabled,
} from '../storage/RefreshSessionStore';
import { SYNC_MUTATION_TYPES } from '../sync/SyncMutationCatalog';
// The TRANSPORT-vs-REJECTION classifier. It already exists, is already unit
// tested, and is already the codebase's answer to "did anything judge this
// request, or did we simply never arrive?" — the auth layer had been answering
// that question differently (and wrongly) one module over.
import { categorizePushFailure } from '../sync/RejectionPolicy';
import {
    APP_VERSION,
    type HttpTransport,
    type RefreshOutcome,
    type RetriableRequestConfig,
    isAuthResponse,
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
    CoVeReverifyRequest,
    CoVeReverifyResponse,
    CreateAttachmentRequest,
    CreateAttachmentResponse,
    CreateExtractionSessionResponse,
    CropScheduleTemplateDto,
    GetExtractionSessionResponse,
    LoginRequest,
    MigrateScheduleRequest,
    ResolveDekResponse,
    ScheduleSubscriptionDto,
    SyncPullResponse,
    SyncPushRequest,
    SyncPushResponse,
    TenantDekResponse,
    UpdateAiProviderConfigRequest,
    ConsentStateDto,
    UpdateConsentRequest,
    IssueConsentTokenResponse,
} from './dtos';
import * as Auth from './resources/AuthResource';
import * as Sync from './resources/SyncResource';
import * as Attachments from './resources/AttachmentsResource';
import * as Ai from './resources/AiResource';
import * as Admin from './resources/AdminResource';
import * as Schedule from './resources/ScheduleResource';
import * as Security from './resources/SecurityResource';
import * as Export from './resources/ExportResource';
// spec: data-principle-spine-2026-05-05/06.4
import * as Consent from './resources/ConsentResource';

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
    AttributedOperatorDto,
    AuthResponseDto,
    CoVeReverifyRequest,
    CoVeReverifyResponse,
    CostEntryDto,
    CreateAttachmentRequest,
    CreateAttachmentResponse,
    CreateExtractionSessionResponse,
    CropCycleDto,
    CropScheduleTemplateDto,
    DailyLogDto,
    DailyLogScope,
    DayLedgerAllocationDto,
    DayLedgerDto,
    ExtractionSessionDraftResponse,
    FarmDto,
    FinanceCorrectionDto,
    GetExtractionSessionResponse,
    LabourEngagementDto,
    LocationDto,
    LoginRequest,
    LogTaskDto,
    MigrateScheduleRequest,
    OpsErrorEventDto,
    OpsFarmErrorDto,
    PlannedTask,
    PlotDto,
    ResolveDekRequest,
    ResolveDekResponse,
    ScheduleSubscriptionDto,
    SyncOperatorDto,
    SyncPullResponse,
    SyncPushMutation,
    SyncPushRequest,
    SyncPushResponse,
    SyncPushResult,
    TenantDekResponse,
    UpdateAiProviderConfigRequest,
    VerificationEventDto,
    VerificationStatus,
} from './dtos';

// spec: data-principle-spine-2026-05-05/06.4 — Consent DTOs re-export.
export type {
    ConsentStateDto,
    UpdateConsentRequest,
    IssueConsentTokenResponse,
} from './dtos';

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export class AgriSyncClient implements HttpTransport {
    readonly http: AxiosInstance;
    readonly authHttp: AxiosInstance;
    private refreshPromise: Promise<RefreshOutcome> | null = null;

    constructor() {
        const baseURL = resolveApiBaseUrl();
        // spec: secure-remembered-device-sessions-2026-06-24
        // Both instances need withCredentials so the HttpOnly agrisync_refresh
        // cookie is sent on refresh and received on login/verify-otp.
        this.http = axios.create({ baseURL, withCredentials: true });
        this.authHttp = axios.create({ baseURL, withCredentials: true });

        this.http.interceptors.request.use((config) => this.attachAccessToken(config));
        this.http.interceptors.request.use((config) => {
            config.headers.set('X-App-Version', APP_VERSION);
            // spec: secure-remembered-device-sessions-2026-06-24
            // Send device-id on every authenticated request so the backend can
            // scope refresh/revoke to the current device. Source is the existing
            // DeviceIdStore — no new device-id source is introduced.
            config.headers.set('X-Device-Id', getOrCreateDeviceId());
            // spec: secure-remembered-device-sessions-2026-06-24 / Task 5.2
            // Tell the backend we are running natively on Android so it returns
            // the raw refreshToken in the JSON body instead of an HttpOnly cookie.
            // Web requests send no such header — the cookie path is unchanged.
            if (isNativeSecureRefreshEnabled()) {
                config.headers.set('X-Client-Platform', 'android');
            }
            return config;
        });
        this.authHttp.interceptors.request.use((config) => {
            config.headers.set('X-App-Version', APP_VERSION);
            config.headers.set('X-Device-Id', getOrCreateDeviceId());
            // spec: secure-remembered-device-sessions-2026-06-24 / Task 5.2
            // Mirror X-Client-Platform on the auth instance (login/register/refresh).
            if (isNativeSecureRefreshEnabled()) {
                config.headers.set('X-Client-Platform', 'android');
            }
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
            // SARVAM_PRIMARY_VOICE_PIPELINE_2026-05-21 founder fix —
            // JSON callers (no multipart) send recordedAt as part of
            // the body so the structurer prompt still sees the
            // recording instant when audio is base64-inlined.
            recordedAtUtc?: string;
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
            // SARVAM_PRIMARY_VOICE_PIPELINE_2026-05-21 founder fix
            // (Option B): ISO-8601 UTC capture moment from
            // MediaRecorder.onstop. Posted as multipart `recorded_at`.
            recordedAtUtc?: string;
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
            // SARVAM_PRIMARY_VOICE_PIPELINE_2026-05-21 founder fix —
            // text inputs don't have a true "recording" moment, but
            // we still allow the field for callers that synthesize
            // one (e.g. typed-after-voice fallback) so the contract
            // is uniform with parseVoice/parseVoiceLog.
            recordedAtUtc?: string;
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

    // spec: data-principle-spine-2026-05-05/05.1
    // Server-side CoVe re-query — see AiResource.coveReverify for the
    // rationale (kills the browser-direct Gemini path).
    coveReverify(request: CoVeReverifyRequest): Promise<CoVeReverifyResponse> {
        return Ai.coveReverify(this, request);
    }

    // --- Security ---------------------------------------------------------
    //
    // spec: data-principle-spine-2026-05-05/05.3
    //
    // NOTE: Endpoint paths assume Phase 05 sub-phase 05.2 ships
    // `GET /shramsafal/security/tenant-dek` and
    // `POST /shramsafal/security/tenant-dek/resolve`. 05.2 is being
    // implemented in parallel; if its paths or response shapes differ,
    // fix `SecurityResource.ts` + `dtos.ts` in a follow-up.

    getTenantDek(): Promise<TenantDekResponse> {
        return Security.getTenantDek(this);
    }

    resolveDek(dekId: string): Promise<ResolveDekResponse | null> {
        return Security.resolveDek(this, dekId);
    }

    // --- Consent ----------------------------------------------------------
    //
    // spec: data-principle-spine-2026-05-05/06.4
    //
    // NOTE: assumes 06.2 backend lands GET/PUT /shramsafal/consent/me and
    // 06.3 backend lands POST /shramsafal/consent/token/issue. If wire
    // shapes diverge, fix ConsentResource.ts + dtos.ts in a follow-up.

    getConsent(): Promise<ConsentStateDto> {
        return Consent.getConsent(this);
    }

    updateConsent(request: UpdateConsentRequest): Promise<ConsentStateDto> {
        return Consent.updateConsent(this, request);
    }

    issueConsentToken(): Promise<IssueConsentTokenResponse> {
        return Consent.issueConsentToken(this);
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

        // Either non-'refreshed' outcome means we have no new token to retry
        // with, so the original 401 stands. The difference between them —
        // whether the credential was destroyed — has already been applied
        // inside refreshSession(); nothing further is owed here.
        const outcome = await this.refreshSession();
        if (outcome.kind !== 'refreshed') {
            throw error;
        }

        originalConfig.headers.set('Authorization', `Bearer ${outcome.session.accessToken}`);
        return this.http.request(originalConfig);
    }

    // spec: secure-remembered-device-sessions-2026-06-24
    // Dual-path refresh:
    //
    //   WEB: POST /user/auth/refresh with NO token body — the HttpOnly cookie
    //   agrisync_refresh carries the token (withCredentials handles this).
    //   Sends rememberDevice + deviceId + platform:'web'. Never reads a
    //   refreshToken field.
    //
    //   ANDROID NATIVE: reads the NativeRefreshSession from the Android
    //   Keystore. If absent → fail-closed (clear + anonymous). If present →
    //   POST /user/auth/refresh with body { refreshToken, rememberDevice,
    //   deviceId, platform:'android' }. On success the server returns a
    //   NEW refreshToken (rotation); persist it via setNativeRefreshSession.
    //
    // AMENDED 2026-08-23 — fail-closed now applies to REJECTION only.
    //
    //   Both branches used to `catch` everything and run the fail-closed path,
    //   which on Android destroys the Keystore refresh token. That token is the
    //   only durable credential on the device, so a single dropped packet at
    //   app launch — bad rural signal, a captive portal, or the backend's own
    //   nightly hibernation window — logged the farmer out PERMANENTLY and left
    //   him staring at an empty database where his records had been. An APK
    //   cannot be patched after it is handed out, so this had to be right
    //   before the pilot build.
    //
    //   The rule now: destroy the credential only when a server judged it
    //   (4xx). When we never reached a server that could judge it — no response
    //   at all, 5xx/408/429, or a 200 that is not a session — the credential's
    //   validity is still unknown, so it is left untouched and the next attempt
    //   on a working connection recovers. This is not a weakening of
    //   fail-closed: an unverified access token still authorizes nothing,
    //   because every real request is validated server-side and a genuine 401
    //   routes straight back here and clears.
    //
    //   `categorizePushFailure` is the same classifier the sync queue uses for
    //   exactly this distinction (`RejectionPolicy.ts`).
    //   evidence: docs/LAUNCH-READINESS-AND-AGRISTACK-2026-08-23.md, Decision 2 item 1
    async refreshSession(): Promise<RefreshOutcome> {
        if (this.refreshPromise) {
            return this.refreshPromise;
        }

        const deviceId = getOrCreateDeviceId();
        const rememberDevice = getRememberDevice();

        // Fail-closed teardown. Called ONLY on a judged rejection.
        const reject = async (): Promise<RefreshOutcome> => {
            clearAuthSession();
            await clearNativeRefreshSession();
            return { kind: 'rejected' };
        };

        if (isNativeSecureRefreshEnabled()) {
            // --- NATIVE (Android Keystore) branch ---
            this.refreshPromise = (async (): Promise<RefreshOutcome> => {
                const stored = await getNativeRefreshSession();
                if (!stored) {
                    // Nothing to send and nothing to preserve → force re-login.
                    return reject();
                }
                try {
                    const response = await this.authHttp.post<AuthResponseDto>(
                        '/user/auth/refresh',
                        {
                            refreshToken: stored.refreshToken,
                            rememberDevice,
                            deviceId,
                            platform: 'android',
                        },
                    );
                    const data = response.data;
                    if (!isAuthResponse(data)) {
                        // Something answered 200 that was not our server.
                        // Keep the Keystore token; do not write a junk session.
                        return { kind: 'unreachable' };
                    }
                    // Persist the rotated token (server always issues a new one).
                    if (data.refreshToken) {
                        await setNativeRefreshSession({
                            refreshToken: data.refreshToken,
                            deviceId,
                            expiresAtUtc: data.expiresAtUtc,
                        });
                    }
                    const session = toAuthSession(data);
                    setAuthSession(session);
                    return { kind: 'refreshed', session };
                } catch (error) {
                    if (categorizePushFailure(error) === 'TRANSPORT') {
                        // The Keystore token survives a bad signal.
                        return { kind: 'unreachable' };
                    }
                    return reject();
                }
            })().finally(() => {
                this.refreshPromise = null;
            });
        } else {
            // --- WEB (HttpOnly cookie) branch ---
            this.refreshPromise = this.authHttp
                .post<AuthResponseDto>('/user/auth/refresh', {
                    rememberDevice,
                    deviceId,
                    platform: 'web',
                })
                .then((response): RefreshOutcome => {
                    if (!isAuthResponse(response.data)) {
                        return { kind: 'unreachable' };
                    }
                    const session = toAuthSession(response.data);
                    setAuthSession(session);
                    return { kind: 'refreshed', session };
                })
                .catch((error: unknown): Promise<RefreshOutcome> | RefreshOutcome => {
                    if (categorizePushFailure(error) === 'TRANSPORT') {
                        return { kind: 'unreachable' };
                    }
                    return reject();
                })
                .finally(() => {
                    this.refreshPromise = null;
                });
        }

        return this.refreshPromise;
    }

    // spec: secure-remembered-device-sessions-2026-06-24 / Task 6.1
    // Sends POST /user/auth/logout so the backend revokes the current device
    // session (and clears the HttpOnly cookie server-side). The cookie is
    // sent automatically via withCredentials on authHttp; X-Device-Id is
    // attached by the authHttp interceptor. If the backend is unreachable the
    // caller (AuthProvider.logout) still completes local cleanup.
    async logoutCurrentDevice(): Promise<void> {
        await Auth.logout(this);
    }
}

export const agriSyncClient = new AgriSyncClient();
