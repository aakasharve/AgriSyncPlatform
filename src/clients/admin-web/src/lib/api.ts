import axios, { type AxiosInstance, type InternalAxiosRequestConfig } from 'axios';
import { authStore } from './auth';
import { AdminModuleForbiddenError, AdminScopeAmbiguousError } from './adminErrors';
import { currentPathWithQuery, redirectToLogin } from './returnTo';
import { getActiveOrgIdSnapshot } from '@/app/ActiveOrgProvider';

/**
 * The typed denials live in `./adminErrors` so that the honest-state
 * vocabulary can name a 403 without importing axios. They are re-exported here
 * because that is where every existing caller imports them from, and because
 * `instanceof` only works if there is exactly one of each class.
 */
export { AdminModuleForbiddenError, AdminScopeAmbiguousError } from './adminErrors';

/**
 * The port the API actually listens on in local development —
 * `AgriSync.Bootstrapper/Properties/launchSettings.json:8`, and the same
 * value mobile-web falls back to.
 */
const DEV_API_FALLBACK = 'http://localhost:5048';

interface ApiEnv {
  VITE_API_BASE_URL?: string;
  PROD?: boolean;
}

/**
 * Resolve the API origin, and NEVER fail quietly about it.
 *
 * This used to be `import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:5001'`.
 * Nothing has ever listened on 5001. `.env.local` is gitignored, so a fresh
 * clone or a git worktree has no copy of it, and the console then pointed every
 * request at a dead port. Each request failed, each screen showed its denied or
 * empty state, and the failure read as *"my admin account lost its
 * permissions"* — a configuration mistake wearing a security bug's clothes.
 * That cost a whole task's debugging on this branch (Task 10).
 *
 * Two changes, and the second matters more than the first:
 *   1. the fallback names the port the API is actually on;
 *   2. falling back at all is now audible.
 *
 * A missing variable in a PRODUCTION bundle is not a dev convenience — there
 * is no localhost to reach — so it is reported at `error` level. It does not
 * throw: `lighthouse.yml` builds this app with no env at all and scores the
 * static output, so a module-level throw would blank the page and take a
 * required budget down with it. The real guard for that case is a build-time
 * refusal in `vite.config.ts`, the way mobile-web already does it — that needs
 * a matching workflow change and belongs to Task 28.
 */
export function resolveApiBaseUrl(env: ApiEnv = import.meta.env): string {
  const configured = env.VITE_API_BASE_URL?.trim();
  if (configured) return configured;

  const where = env.PROD
    ? 'This is a production bundle; there is no local API to fall back to.'
    : 'Create src/clients/admin-web/.env.local with VITE_API_BASE_URL=' + DEV_API_FALLBACK;

  const say = env.PROD ? console.error : console.warn;
  say(
    `[admin-web] VITE_API_BASE_URL is not set — falling back to ${DEV_API_FALLBACK}. ` +
      `${where} Until it is set, every admin request fails and every screen will look ` +
      `like a permissions problem rather than a configuration one.`,
  );

  return DEV_API_FALLBACK;
}

const BASE_URL = resolveApiBaseUrl();

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

adminApi.interceptors.response.use(
  (r) => r,
  (err) => {
    const status = err?.response?.status as number | undefined;
    const body = err?.response?.data as
      | { code?: string; memberships?: AdminScopeAmbiguousError['memberships']; moduleKey?: string }
      | undefined;

    if (status === 401) {
      /**
       * KEEP THE REDIRECT-LOOP GUARD. Without the "already on /login" check, a
       * 401 raised BY the login request navigates to /login, which re-issues
       * the request, which 401s again — a reload the operator cannot escape.
       *
       * WHAT CHANGED: the destination. `window.location.assign('/login')`
       * reloads the whole application, and a reload cannot carry router state,
       * so the url the user was on died before LoginPage rendered — the exact
       * deep link RequireAuth exists to preserve, thrown away by the other
       * half of the same feature. `redirectToLogin` goes through the router
       * and hands `returnTo` along; it still falls back to the hard assign
       * when no router is mounted (see lib/returnTo.ts).
       *
       * The session is cleared BEFORE the loop guard, so an expired token is
       * gone even on the login page. That was true before and stays true.
       */
      authStore.clear();
      if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
        redirectToLogin(currentPathWithQuery());
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
