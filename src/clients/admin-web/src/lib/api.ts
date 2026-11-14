import axios, {
  CanceledError,
  isAxiosError,
  isCancel,
  type AxiosError,
  type AxiosInstance,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from 'axios';
import {
  accessTokenExpiresWithin,
  authStore,
  isSessionOverAge,
  msUntilSessionOverAge,
  type AdminSession,
} from './auth';
import { queryClient } from './queryClient';
import {
  API_BASE_URL,
  accessTokenNeedsRenewal,
  renewSession,
  stopRenewal,
} from './sessionRenewal';
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

/** The two routes whose 2xx answer puts a new refresh cookie in this browser. */
function isNewSignInRoute(url: string | undefined): boolean {
  return (url ?? '').includes('/user/auth/login') || (url ?? '').includes('/user/auth/verify-otp');
}

function isSignOutRoute(url: string | undefined): boolean {
  return (url ?? '').includes('/user/auth/logout');
}

/**
 * Why the console signed a person out without their asking: the session reached
 * MAX_SESSION_HOURS ('max-age'), or it could not be renewed ('ended'). The person's own
 * sign-out opens the login page with no reason at all.
 */
export type SessionEndReason = 'max-age' | 'ended';

const SESSION_END_PARAM = 'signedOut';

/** Reads the reason out of the login page's address, where `endSession` put it. */
export function readSessionEndReason(search: string): SessionEndReason | null {
  const value = new URLSearchParams(search).get(SESSION_END_PARAM);
  return value === 'max-age' || value === 'ended' ? value : null;
}

/** How long the console waits for the server to answer a sign-out before going on without it. */
const SIGN_OUT_WAIT_MS = 5_000;

/**
 * Tells the server this browser has signed out, so the refresh cookie stops working. Waits for
 * the answer, SIGN_OUT_WAIT_MS at most.
 *
 * Resolves with true when the server answered that it is done, and with false when it could not
 * be told (no answer in time, or any refusal). Never rejects.
 */
export async function tellServerSignedOut(): Promise<boolean> {
  try {
    await adminApi.post(
      '/user/auth/logout',
      {},
      { withCredentials: true, timeout: SIGN_OUT_WAIT_MS },
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Kept in the browser's store while a sign-out is owed to the server: the person was signed
 * out here, but the server could not be told, so the refresh cookie it gave this browser still
 * works. That cookie outlives a close of the browser, so the debt must outlive this page too.
 * The value is the bare mark "1": no token, nothing about the person, nothing else.
 */
const SIGN_OUT_OWED_KEY = 'admin.signout.owed.v1';

function markSignOutOwed(): void {
  try {
    localStorage.setItem(SIGN_OUT_OWED_KEY, '1');
  } catch {
    // A store that cannot be written cannot remember the debt; there is nowhere else to keep it.
  }
}

function unmarkSignOutOwed(): void {
  try {
    localStorage.removeItem(SIGN_OUT_OWED_KEY);
  } catch {
    // The same: nothing more can be done here.
  }
}

/** True while a sign-out is owed to the server. */
export function isSignOutOwed(): boolean {
  try {
    return localStorage.getItem(SIGN_OUT_OWED_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * What became of an owed sign-out: there was none ('none'), the server still could not be told
 * ('owed'), or it has now been told ('told').
 */
export type OwedSignOut = 'none' | 'owed' | 'told';

/** The one settling in the air, if any; afterwards, kept only when its outcome was 'told'. */
let settlingOwed: Promise<OwedSignOut> | null = null;

/**
 * Pays an owed sign-out, if there is one: tells the server again, and takes the mark away when
 * the server answers that it is done. When it still cannot be told the mark stays for the next
 * time. Called at every start of the app and whenever the login page opens. Never rejects.
 *
 * One call at a time. Once the server has been told, the answer 'told' is kept for the rest of
 * this page load (until a sign-in), so a login page that opens a moment later can still say so.
 */
export function settleOwedSignOut(): Promise<OwedSignOut> {
  settlingOwed ??= settleOwedSignOutOnce().then((outcome) => {
    if (outcome !== 'told') settlingOwed = null;
    return outcome;
  });
  return settlingOwed;
}

async function settleOwedSignOutOnce(): Promise<OwedSignOut> {
  if (!isSignOutOwed()) return 'none';
  // A session is stored, so somebody has signed in since: the cookie now belongs to that
  // sign-in, and a sign-out call would end it. Nothing is owed any more.
  if (authStore.get()) {
    unmarkSignOutOwed();
    return 'none';
  }
  // Not now, when this page is itself telling the server (a session is ending here), and not
  // while a sign-in call is in the air: this call's answer takes the refresh cookie away, and
  // it could arrive after that sign-in's answer has put a new one there. Still owed; next time.
  if (ending || signInsInTheAir > 0) return 'owed';
  if (!(await tellServerSignedOut())) return 'owed';
  unmarkSignOutOwed();
  return 'told';
}

/** While a sign-out is owed and the login page is open, the server is asked again this often. */
const OWED_RETRY_MS = 30_000;

/**
 * For the login page, which tells the person "this page will tell it as soon as the server can
 * be reached": pays an owed sign-out now, and for as long as the page is open and the sign-out
 * is still owed, tries again every OWED_RETRY_MS and at once when the browser reports that it
 * is back online. `onOutcome` hears how each try went. Once nothing is owed any more it stops
 * by itself.
 *
 * Returns the function that stops it when the page is left: no timer and no listener stay.
 */
export function watchOwedSignOut(onOutcome: (outcome: OwedSignOut) => void): () => void {
  let stopped = false;
  let asking = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function stop(): void {
    stopped = true;
    clearTimeout(timer);
    window.removeEventListener('online', ask);
  }

  function ask(): void {
    if (stopped || asking) return;
    asking = true;
    clearTimeout(timer);
    void settleOwedSignOut().then((outcome) => {
      asking = false;
      if (stopped) return;
      onOutcome(outcome);
      if (outcome === 'owed') timer = setTimeout(ask, OWED_RETRY_MS);
      else stop();
    });
  }

  window.addEventListener('online', ask);
  ask();
  return stop;
}

/**
 * Nothing is owed any more: a sign-in has been accepted, and the server replaces this browser's
 * old session when it signs in (the cookie the debt was about is gone as well).
 */
export function clearOwedSignOut(): void {
  unmarkSignOutOwed();
  settlingOwed = null;
}

/** Given by the page (AdminAuthProvider): takes every signed-in screen off the page. */
let takeScreensDown: (() => void) | null = null;

/**
 * The page says how to take every signed-in screen down. It is called at every end of a
 * session, before the console leaves for the login page: a browser may keep the page it leaves
 * and show it again on "Back", and that kept copy must have nobody's names on it.
 *
 * Returns the function that takes the listener away again.
 */
export function onSessionForgotten(listener: () => void): () => void {
  takeScreensDown = listener;
  return () => {
    if (takeScreensDown === listener) takeScreensDown = null;
  };
}

/**
 * Cut off the moment a session is forgotten. Every data request carries its signal, so the
 * ones then in the air are stopped, and none can leave afterwards with the old token.
 */
const whileSignedIn = new AbortController();

/**
 * Forgets the person in this tab, at once and without waiting for anything: the stored session,
 * the requests and the renewal in the air, everything that was loaded for them, and what is on
 * the screen. Every end of a session goes through here, whatever ended it.
 */
function forgetSession(): void {
  try {
    authStore.clear();
  } catch {
    // A store the browser will not let the console touch holds no session to remove.
  }
  whileSignedIn.abort();
  stopRenewal();
  queryClient.clear();
  try {
    takeScreensDown?.();
  } catch {
    // Leaving for the login page matters more than tidying the page being left.
  }
}

/** Loads the login page afresh, so nothing this page held in memory comes along. */
function openLoginPage(reason: SessionEndReason | null): void {
  window.location.assign(reason ? `/login?${SESSION_END_PARAM}=${reason}` : '/login');
}

/**
 * Set from the moment a session begins to end, by the console or by the person, and never
 * unset: the page is on its way to the login page. The first reason given is the one shown.
 */
let ending: Promise<void> | null = null;

/**
 * Signs the person out without their asking and opens the login page with the reason. The
 * session is forgotten at once. After MAX_SESSION_HOURS the server is told as well, in the
 * same order as the person's own sign-out (see `signOut`): owed first, forgotten, then told.
 */
export function endSession(reason: SessionEndReason): Promise<void> {
  ending ??= (async () => {
    const tellServer = reason === 'max-age';
    if (tellServer) markSignOutOwed();
    forgetSession();
    if (tellServer && (await tellServerSignedOut())) unmarkSignOutOwed();
    openLoginPage(reason);
  })();
  return ending;
}

/**
 * The person's own sign-out. It takes effect at the press, before anything is waited for:
 *
 *   1. the sign-out is marked as owed to the server;
 *   2. the session is forgotten in this browser (see `forgetSession`);
 *   3. only then is the server told, and waited for, SIGN_OUT_WAIT_MS at most. That call needs
 *      nothing but the refresh cookie; the access token is already gone;
 *   4. when the server answers that it is done, the mark is taken away.
 *
 * Then the login page opens. Steps 1 and 2 happen in the press itself, so closing the tab at
 * any moment after it leaves this browser signed out, and leaves the mark for the next start
 * of the app to act on if the server had not been reached (see `settleOwedSignOut`).
 *
 * From the press no data request goes out and no renewal starts (see `ending`), so a second
 * press, or a page still asking for data, changes nothing.
 */
export function signOut(): Promise<void> {
  ending ??= (async () => {
    markSignOutOwed();
    forgetSession();
    if (await tellServerSignedOut()) unmarkSignOutOwed();
    openLoginPage(null);
  })();
  return ending;
}

/** An open page looks at the clock at least this often, to see whether the session is over age. */
const AGE_CHECK_MS = 60_000;

/**
 * Ends the session when it reaches MAX_SESSION_HOURS while the page sits open with nobody
 * using it. Without this the limit was only noticed at the next request, so an idle tab kept
 * showing what it had loaded.
 *
 * A timer runs to the moment the limit is reached. It looks at the clock at least once a
 * minute rather than once at the end, because a timer does not count the time a computer
 * spent asleep. The clock is looked at again whenever the tab becomes visible. Both end the
 * session the way a request made after the limit does: the server told, everything forgotten,
 * the login page with the 12-hour message.
 *
 * Returns the function that stops the watch.
 */
export function watchSessionAge(): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const check = () => {
    clearTimeout(timer);
    // The store, not a copy: a renewal keeps the sign-in time, and a new sign-in in another tab
    // of this browser starts the 12 hours again for the session both tabs share.
    const stored = authStore.get();
    if (stored && isSessionOverAge(stored)) {
      void endSession('max-age');
      return;
    }
    const left = stored ? msUntilSessionOverAge(stored) : AGE_CHECK_MS;
    timer = setTimeout(check, left > 0 && left < AGE_CHECK_MS ? left : AGE_CHECK_MS);
  };
  const onVisibilityChange = () => {
    if (document.visibilityState === 'visible') check();
  };

  document.addEventListener('visibilitychange', onVisibilityChange);
  check();
  return () => {
    clearTimeout(timer);
    document.removeEventListener('visibilitychange', onVisibilityChange);
  };
}

/**
 * True when a request got no verdict from the server: no answer at all, too many calls (429),
 * or a server error (5xx). That says nothing about the person or their rights, so it is never
 * shown as a refusal. A request the console itself stopped is not one of these.
 */
export function gotNoVerdict(err: unknown): boolean {
  if (!isAxiosError(err) || isCancel(err)) return false;
  const status = err.response?.status;
  return status === undefined || status === 429 || status >= 500;
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
    // A sign-in waits for an owed sign-out that is still in the air. The answer to that call
    // takes this browser's refresh cookie away, and it must not arrive after the sign-in's
    // answer has put a new one there. (The sign-out call itself never waits: it is the one
    // being waited for.)
    if (settlingOwed && !isSignOutRoute(config.url)) await settlingOwed;

    // Never a renewal here. A token that is still good goes along, as it always has.
    const session = authStore.get();
    if (session && !accessTokenExpiresWithin(session, 0)) {
      config.headers.set('Authorization', `Bearer ${session.accessToken}`);
    }
  } else {
    const session = await sessionForRequest();
    if (session) config.headers.set('Authorization', `Bearer ${session.accessToken}`);
    // Stopped the moment the session is forgotten, in the air or on its way out.
    config.signal ??= whileSignedIn.signal;
  }

  // W0-B — send the currently-selected active org on every admin request.
  // Header name must match the backend CORS allowlist + AdminScopeHelper read.
  const orgId = getActiveOrgIdSnapshot();
  if (orgId) config.headers.set('X-Active-Org-Id', orgId);

  // Last, so that nothing above can fail after the call has been counted.
  if (isAuthRoute(config.url) && !isSignOutRoute(config.url)) {
    (config as SentConfig).countedSignIn = true;
    signInsInTheAir += 1;
  }

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

type SentConfig = InternalAxiosRequestConfig & {
  /** A request already sent again after a renewal carries this and is never sent a third time. */
  retriedAfterRenewal?: boolean;
  /** A call to a sign-in route carries this from the moment it leaves until it is answered. */
  countedSignIn?: boolean;
};

/**
 * How many calls to the sign-in routes are in the air. While there is one, no owed sign-out is
 * sent (see `settleOwedSignOutOnce`).
 */
let signInsInTheAir = 0;

/** The call has its answer, or has failed: it is in the air no longer. Counted down once. */
function signInAnswered(config: SentConfig | undefined): void {
  if (!config?.countedSignIn) return;
  config.countedSignIn = false;
  signInsInTheAir -= 1;
}

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

  // The session is already ending (the person pressed Sign out while this request was in the
  // air, say): nothing is renewed and nothing is sent again.
  if (ending) {
    await ending;
    throw err;
  }

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
  (r) => {
    signInAnswered(r.config as SentConfig);
    // The server accepted a sign-in (held or not) and put a new cookie in this browser: the
    // cookie an owed sign-out was about is gone, and a sign-out call now would end the new one.
    if (isNewSignInRoute(r.config.url)) clearOwedSignOut();
    return r;
  },
  (err) => {
    signInAnswered(err?.config as SentConfig | undefined);
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
