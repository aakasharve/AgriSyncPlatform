import axios, { type AxiosInstance, type InternalAxiosRequestConfig } from 'axios';
import { authStore } from './auth';
import { getActiveOrgIdSnapshot } from '@/app/ActiveOrgProvider';

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:5001';

export const adminApi: AxiosInstance = axios.create({
  baseURL: BASE_URL,
  timeout: 20_000,
  headers: { 'Content-Type': 'application/json' },
});

adminApi.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = authStore.getAccessToken();
  if (token) config.headers.set('Authorization', `Bearer ${token}`);

  // W0-B — send the currently-selected active org on every admin request.
  // Header name must match the backend CORS allowlist + AdminScopeHelper read.
  const orgId = getActiveOrgIdSnapshot();
  if (orgId) config.headers.set('X-Active-Org-Id', orgId);

  return config;
});

/**
 * Response-envelope shapes the backend returns for the W0-B admin error paths.
 * Callers can `instanceof AdminScopeAmbiguousError` / `AdminModuleForbiddenError`
 * to branch UI.
 */
export class AdminScopeAmbiguousError extends Error {
  readonly memberships: Array<{
    orgId: string;
    orgName: string;
    orgType: string;
    orgRole: string;
  }>;
  constructor(memberships: AdminScopeAmbiguousError['memberships']) {
    super('admin_active_org_required');
    this.name = 'AdminScopeAmbiguousError';
    this.memberships = memberships;
  }
}

export class AdminModuleForbiddenError extends Error {
  readonly moduleKey: string | null;
  readonly code: string;
  constructor(code: string, moduleKey: string | null) {
    super(code);
    this.name = 'AdminModuleForbiddenError';
    this.code = code;
    this.moduleKey = moduleKey;
  }
}

adminApi.interceptors.response.use(
  (r) => r,
  (err) => {
    const status = err?.response?.status as number | undefined;
    const body = err?.response?.data as
      | { code?: string; memberships?: AdminScopeAmbiguousError['memberships']; moduleKey?: string }
      | undefined;

    if (status === 401) {
      authStore.clear();
      if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
        window.location.assign('/login');
      }
      return Promise.reject(err);
    }

    if (status === 428 && body?.code === 'admin_active_org_required') {
      return Promise.reject(new AdminScopeAmbiguousError(body.memberships ?? []));
    }

    if (
      status === 403 &&
      (body?.code === 'admin_module_forbidden'
        || body?.code === 'admin_platform_only'
        || body?.code === 'admin_not_in_org'
        || body?.code === 'admin_no_membership')
    ) {
      return Promise.reject(new AdminModuleForbiddenError(body.code, body.moduleKey ?? null));
    }

    return Promise.reject(err);
  }
);

export interface AdminResponse<T> {
  data: T;
  meta: {
    source: 'live' | 'live-aggregated' | 'materialized';
    window: string;
    /** ISO-8601. Backend sends lastRefreshedUtc; older health endpoint has no meta. */
    lastRefreshed: string;
    lastRefreshedUtc?: string;
    ttlSeconds: number;
  };
}
