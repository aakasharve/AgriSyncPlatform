import axios, { isAxiosError, isCancel } from 'axios';
import { accessTokenExpiresWithin, authStore, type AdminSession } from './auth';
import { deviceIdentity } from './deviceIdentity';

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
 * Resolve the API origin, and NEVER fail quietly about it. (September console, moved here from
 * api.ts by the CR-2d join so that `API_BASE_URL` below uses it; api.ts re-exports it.)
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

/**
 * The server's address. It lives here, not in api.ts, because this file must not import api.ts:
 * the renewal call goes out on a plain client that has none of api.ts's interceptors, so a
 * renewal can never start another renewal. One address for both clients.
 */
export const API_BASE_URL: string = resolveApiBaseUrl();

/** An access token is renewed ahead of time when it has this long, or less, left. */
const RENEW_AHEAD_MS = 60_000;

/** The browser lets one tab at a time hold this name, so one tab at a time renews. */
const RENEWAL_LOCK = 'admin.session.renewal';

// 200 answer of POST /user/auth/refresh on the web (User.Api AuthResponseBody). The new refresh
// token travels in the HttpOnly cookie, never in the body. The last field comes only from an API
// that holds a sign-in until the account question is answered.
interface RefreshAnswer {
  userId?: unknown;
  accessToken?: unknown;
  expiresAtUtc?: unknown;
  deviceCheckRequired?: unknown;
}

/** The one renewal in the air in this tab, if any. Every caller waits on it. */
let inFlight: Promise<AdminSession | null> | null = null;

/** When this tab last got a session from a renewal: its own, or one another tab had just made. */
let lastRenewedAtMs = 0;

/** The renewal call that is in the air, if any, so that a sign-out can cut it off. */
let callInTheAir: AbortController | null = null;

/**
 * Cuts off the renewal call in the air, if there is one. For the moment a session is forgotten:
 * the call's answer would be for nobody, and it would put a new refresh cookie in the browser
 * just as the server is being told that this browser has signed out.
 */
export function stopRenewal(): void {
  callInTheAir?.abort();
}

/**
 * True when the access token should be renewed before it is used: it has a minute or less left.
 *
 * A token obtained less than a minute ago is never renewed ahead of time. If such a token
 * already looks about to expire, this computer's clock cannot judge it, and renewing ahead
 * would mean a renewal before every request. It is renewed when the server refuses it instead.
 */
export function accessTokenNeedsRenewal(
  session: AdminSession,
  nowMs: number = Date.now(),
): boolean {
  if (!accessTokenExpiresWithin(session, RENEW_AHEAD_MS, nowMs)) return false;
  const obtainedAtMs = Math.max(lastRenewedAtMs, Date.parse(session.signedInAtUtc));
  return nowMs - obtainedAtMs >= RENEW_AHEAD_MS;
}

/**
 * Renews the access token from the refresh cookie the browser holds.
 *
 * Resolves with the renewed session, or with null when there is no session left to renew (the
 * server refused, the answer is a held sign-in, or the person has signed out). Rejects when the
 * call got no verdict (no answer, too many calls, a server error): that says nothing about the
 * session, so it is kept.
 *
 * Only one renewal call is ever in the air. Within this tab every caller waits on the same
 * call, and across tabs the browser lets one tab renew at a time. This matters: the server
 * replaces the refresh cookie on every renewal, and treats a second use of the old one as a
 * stolen cookie and ends the person's sessions.
 */
export function renewSession(): Promise<AdminSession | null> {
  inFlight ??= renewInTurn().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function renewInTurn(): Promise<AdminSession | null> {
  const tokenAtStart = authStore.get()?.accessToken ?? null;
  // Web Locks are missing only in old browsers and on plain http; the call then goes straight out.
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  const session = await (locks
    ? locks.request(RENEWAL_LOCK, () => renewOnce(tokenAtStart))
    : renewOnce(tokenAtStart));
  if (session) lastRenewedAtMs = Date.now();
  return session;
}

async function renewOnce(tokenAtStart: string | null): Promise<AdminSession | null> {
  // Read the store again: this tab may have waited its turn behind another tab's renewal.
  const stored = authStore.get();
  if (!stored) return null; // signed out: a renewal never brings a session back
  if (stored.accessToken !== tokenAtStart) return stored; // another tab has already renewed

  let data: RefreshAnswer | null | undefined;
  const call = new AbortController();
  callInTheAir = call;
  try {
    // The body names this browser and asks, every time, for a cookie that outlives a restart of
    // the browser (`rememberDevice`): the server sets the cookie again with each renewal.
    ({ data } = await axios.post<RefreshAnswer>(
      `${API_BASE_URL}/user/auth/refresh`,
      deviceIdentity(),
      { withCredentials: true, timeout: 20_000, signal: call.signal },
    ));
  } catch (err) {
    // Cut off by a sign-out (`stopRenewal`): there is no session left to renew.
    if (isCancel(err)) return null;
    // 401 is the server's one refusal: the cookie is missing, unknown, expired or already used,
    // or the account is switched off. The session is over.
    if (isAxiosError(err) && err.response?.status === 401) return null;
    // No answer, 429 (the sign-in routes share a limit of calls per minute) or a server error.
    throw err;
  } finally {
    if (callInTheAir === call) callInTheAir = null;
  }

  // Held: the cookie now names a sign-in whose account question was never answered (a second
  // sign-in was started in this browser and left there). Its token opens nothing, so it is
  // never stored, and the session is over like one the server refused. Anything but a plain
  // "not held" counts as held.
  if ((data?.deviceCheckRequired ?? false) !== false) return null;

  const accessToken = typeof data?.accessToken === 'string' ? data.accessToken : '';
  const expiresAtUtc = typeof data?.expiresAtUtc === 'string' ? data.expiresAtUtc : '';
  const userId = typeof data?.userId === 'string' ? data.userId : '';
  // An answer that carries no session, or one for a different person than the one signed in
  // here, is not a renewal of this session.
  if (!accessToken || !expiresAtUtc) return null;
  if (userId.toLowerCase() !== stored.userId.toLowerCase()) return null;

  // Signed out while the call was in the air: the answer is dropped.
  if (!authStore.get()) return null;

  const renewed: AdminSession = {
    accessToken,
    refreshToken: null,
    userId: stored.userId,
    expiresAtUtc,
    signedInAtUtc: stored.signedInAtUtc,
  };
  authStore.set(renewed);
  return renewed;
}
