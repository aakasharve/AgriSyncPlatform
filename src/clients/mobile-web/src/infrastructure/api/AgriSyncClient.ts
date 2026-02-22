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
    | 'set_price_config';

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
}

interface RetriableRequestConfig extends InternalAxiosRequestConfig {
    _agriSyncRetry?: boolean;
}

function resolveApiBaseUrl(): string {
    const configured = (import.meta as any).env?.VITE_AGRISYNC_API_URL as string | undefined;
    return configured?.trim()?.replace(/\/+$/, '') ?? '';
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
        const response = await this.http.post<AuthResponseDto>('/user/auth/login', request);
        const session = toAuthSession(response.data);
        setAuthSession(session);
        return response.data;
    }

    async register(request: { phone: string; password: string; displayName: string; appId?: string; role?: string }): Promise<AuthResponseDto> {
        const response = await this.http.post<AuthResponseDto>('/user/auth/register', request);
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

    async pushSyncBatch(request: SyncPushRequest): Promise<SyncPushResponse> {
        const response = await this.http.post<SyncPushResponse>('/sync/push', request);
        return response.data;
    }

    async pullSyncChanges(sinceCursorIso?: string): Promise<SyncPullResponse> {
        const params = sinceCursorIso ? { since: sinceCursorIso } : undefined;
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
