import axios, {
  CanceledError,
  isAxiosError,
  type AxiosError,
  type AxiosInstance,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from 'axios';
import { accessTokenExpiresWithin, authStore, isSessionOverAge, type AdminSession } from './auth';
import { API_BASE_URL, accessTokenNeedsRenewal, renewSession } from './sessionRenewal';
import { getActiveOrgIdSnapshot } from '@/app/ActiveOrgProvider';

export const adminApi: AxiosInstance = axios.create({
  baseURL: API_BASE_URL,
  timeout: 20_000,
  headers: { 'Content-Type': 'application/json' },
});

/**
 * The sign-in, renewal and sign-out routes. A call to one of them never starts a renewal and is
 * never sent again, so a renewal cannot lead to another renewal.
 */
function isAuthRoute(url: string | undefined): boolean {
  return (url ?? '').includes('/user/auth/');
}

/**
 * Why the console signed a person out without their asking: the session reached
 * MAX_SESSION_HOURS ('max-age'), or it could not be renewed ('ended').
 */
export type SessionEndReason = 'max-age' | 'ended';

const SESSION_END_PARAM = 'signedOut';

/** Reads the reason out of the login page's address, where `endSession` put it. */
export function readSessionEndReason(search: string): SessionEndReason | null {
  const value = new URLSearchParams(search).get(SESSION_END_PARAM);
  return value === 'max-age' || value === 'ended' ? value : null;
}

/**
 * Tells the server this browser has signed out, so the refresh cookie stops working. Best
 * effort: the console has already forgotten the session, whatever the server answers.
 */
export async function tellServerSignedOut(): Promise<void> {
  try {
    await adminApi.post('/user/auth/logout', {}, { withCredentials: true, timeout: 5_000 });
  } catch {
    // Nothing to do: the person is signed out of the console either way.
  }
}

let ending: Promise<void> | null = null;

/**
 * Signs the person out and opens the login page with the reason. After MAX_SESSION_HOURS the
 * server is told as well, and the page waits for that call (a few seconds at most), because
 * leaving the page would cut the call off. The first reason given is the one that is shown.
 */
export function endSession(reason: SessionEndReason): Promise<void> {
  ending ??= (async () => {
    authStore.clear();
    if (reason === 'max-age') await tellServerSignedOut();
    window.location.assign(`/login?${SESSION_END_PARAM}=${reason}`);
  })();
  return ending;
}

/** A data request that found the person signed out is stopped with this, never sent. */
function signedOutStop(): CanceledError<unknown> {
  return new CanceledError('The person has been signed out.');
}

/**
 * The session a request to a data route goes out with. Signed in is decided by the age of the
 * session, never by the age of its access token: a token with a minute or less left is renewed
 * first.
 */
async function sessionForRequest(): Promise<AdminSession | null> {
  // Once the console has begun signing the person out, no data request goes to the server.
  if (ending) {
    await ending;
    throw signedOutStop();
  }

  const session = authStore.get();
  if (!session) return null;

  if (isSessionOverAge(session)) {
    await endSession('max-age');
    throw signedOutStop();
  }

  if (!accessTokenNeedsRenewal(session)) return session;

  let renewed: AdminSession | null;
  try {
    renewed = await renewSession();
  } catch (err) {
    // No verdict on the session (no answer, too many calls, a server error): the person stays
    // signed in. A token that still has time left goes out as it is; otherwise this request
    // fails and the next one tries the renewal again.
    if (!accessTokenExpiresWithin(session, 0)) return session;
    throw err;
  }
  if (!renewed) {
    await endSession('ended');
    throw signedOutStop();
  }
  return renewed;
}

adminApi.interceptors.request.use(async (config: InternalAxiosRequestConfig) => {
  if (isAuthRoute(config.url)) {
    // Never a renewal here. A token that is still good goes along, as it always has.
    const session = authStore.get();
    if (session && !accessTokenExpiresWithin(session, 0)) {
      config.headers.set('Authorization', `Bearer ${session.accessToken}`);
    }
  } else {
    const session = await sessionForRequest();
    if (session) config.headers.set('Authorization', `Bearer ${session.accessToken}`);
  }

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

/** A request already sent again after a renewal carries this mark and is never sent a third time. */
type SentConfig = InternalAxiosRequestConfig & { retriedAfterRenewal?: boolean };

function bearerTokenOf(config: InternalAxiosRequestConfig): string | null {
  const value = config.headers.get('Authorization');
  return typeof value === 'string' && value.startsWith('Bearer ') ? value.slice(7) : null;
}

/**
 * A data route answered 401: the access token was refused. Renew once and send that request
 * once more. If the renewal gets no verdict, its error goes back to the caller and the session
 * is kept.
 */
async function retryAfterRenewal(err: AxiosError): Promise<AxiosResponse> {
  const config = err.config as SentConfig | undefined;
  // A refused sign-in (a wrong code, a wrong password) belongs to the login page as it is.
  if (!config || isAuthRoute(config.url)) throw err;

  if (config.retriedAfterRenewal) {
    // Refused again with a token that had just been renewed: this session opens nothing.
    await endSession('ended');
    throw err;
  }

  const stored = authStore.get();
  // Not signed in and already on the login page: nothing to renew, and nowhere else to go.
  if (!stored && window.location.pathname.startsWith('/login')) throw err;

  // A different token in the store means it was renewed after this request left: no new call.
  const session =
    stored && stored.accessToken !== bearerTokenOf(config) ? stored : await renewSession();
  if (!session) {
    await endSession('ended');
    throw err;
  }

  config.retriedAfterRenewal = true;
  return adminApi.request(config);
}

adminApi.interceptors.response.use(
  (r) => r,
  (err) => {
    const status = err?.response?.status as number | undefined;
    const body = err?.response?.data as
      | { code?: string; memberships?: AdminScopeAmbiguousError['memberships']; moduleKey?: string }
      | undefined;

    // Only a 401 is a renewal case. A 403 `auth.device_unconfirmed` (an account question still
    // waiting for its answer) is not: it goes back to the caller like any other refusal.
    if (status === 401 && isAxiosError(err)) return retryAfterRenewal(err);

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
