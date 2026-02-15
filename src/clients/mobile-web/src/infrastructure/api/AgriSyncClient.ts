import axios, { AxiosError, AxiosInstance, InternalAxiosRequestConfig } from 'axios';
import { clearAuthSession, getAuthSession, setAuthSession, type AuthSession } from './AuthTokenStore';

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
}

export interface PlotDto {
    id: string;
    farmId: string;
    name: string;
    areaInAcres: number;
    createdAtUtc: string;
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
    lastVerificationStatus?: string;
    tasks: LogTaskDto[];
    verificationEvents: VerificationEventDto[];
}

export interface SyncPullResponse {
    serverTimeUtc: string;
    nextCursorUtc: string;
    farms: FarmDto[];
    plots: PlotDto[];
    cropCycles: CropCycleDto[];
    dailyLogs: DailyLogDto[];
    costEntries: unknown[];
    financeCorrections: unknown[];
    priceConfigs: unknown[];
    plannedActivities: unknown[];
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
