/**
 * WHERE THE USER WAS GOING — preserved across a sign-in.
 *
 * Three call sites, one rule: when this console throws someone back to /login,
 * it must remember the WHOLE url, not just its path.
 *
 *   RequireAuth (App.tsx)  — no session at all, capture and redirect.
 *   The 401 interceptor    — a token that expired mid-session.
 *   LoginPage              — spends the captured value on success.
 *
 * ── Why the query string is not optional ──────────────────────────────────
 * Every piece of state this console keeps in a url lives in the query string:
 * `page`, `search`, `tier`, `endpoint`, `weeks`, `days` — and `org`, which
 * decides WHOSE DATA the page shows. Storing `location.pathname` alone, which
 * is what App.tsx did before Task 11, silently downgrades
 * `/farms?page=7&tier=B&org=<uuid>` to `/farms` and lands the user on page 1
 * of a different organisation. Nothing goes red; the link just quietly means
 * something else. A mockup cannot show this, because the v3 prototype's login
 * handler is a redirect to index.html.
 */

/** The location shape both react-router and `window.location` satisfy. */
export interface PathAndQuery {
  pathname: string;
  search: string;
}

/**
 * The full url the user is on, as a router-navigable string.
 *
 * ── SIMPLIFIED IN TASK 12, BECAUSE THE REASON FOR THE COMPLEXITY IS GONE ──
 * This used to take the path from the router and then RECONCILE the query
 * string against `window.location`, merging in any parameter the router could
 * not see. That loop existed for exactly one parameter: `ActiveOrgProvider`
 * wrote `?org=<uuid>` with a raw `window.history.replaceState`, which React
 * Router never observed, so the router's own `search` could be missing the
 * value that decides WHICH TENANT'S ROWS the restored link would show. The
 * comment here said Task 12 would make the loop redundant.
 *
 * It did. `ActiveOrgProvider` now writes through `useSearchParams`
 * (Task 12 Step 2), and a grep of `src/` outside tests finds no remaining
 * `history.replaceState` or `pushState` anywhere: every url write in this
 * console goes through the router. The router's `search` and the address bar
 * cannot disagree, so merging them was reconciling a value with itself.
 *
 * Keeping it would have been the defect this repo keeps catching — a
 * defensive line whose stated reason has stopped being true, which the next
 * reader then preserves BECAUSE it looks deliberate. The `window.location`
 * fallback stays: the 401 interceptor has no hooks and no router location,
 * only the address bar.
 */
export function currentPathWithQuery(routerLocation?: PathAndQuery): string {
  const browser: PathAndQuery | null =
    typeof window === 'undefined' || !window.location
      ? null
      : { pathname: window.location.pathname, search: window.location.search };

  const source = routerLocation ?? browser;
  if (!source) return '/';

  // Both react-router and `window.location` include the leading '?'. A lone
  // '?' is an empty query string, not a query string.
  const search = source.search && source.search !== '?' ? source.search : '';
  return `${source.pathname}${search}`;
}

/**
 * Only ever hand back a path INSIDE this console.
 *
 * `from` arrives through router state rather than through the url, so it is
 * not attacker-controllable today. That is a property of the current call
 * sites, not of the function, and it is exactly the kind of property that
 * stops being true the first time someone reads a `?returnTo=` parameter.
 * `//evil.example` and `https://evil.example` are both valid inputs to
 * `navigate()` and both leave the console.
 */
export function safeReturnTo(value: unknown, fallback = '/'): string {
  if (typeof value !== 'string' || value.length === 0) return fallback;
  // A protocol-relative `//host` or a backslash variant is an off-site jump.
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return fallback;
  return value;
}

/* ─────────────────────────── the router bridge ─────────────────────────── */

type LoginRedirect = (returnTo: string) => void;

let handler: LoginRedirect | null = null;

/**
 * Lets the axios response interceptor reach the router.
 *
 * Same shape and same reason as `getActiveOrgIdSnapshot()`: the interceptor is
 * module-scoped and cannot call hooks. Returns its own disposer so a component
 * can register it from an effect, and so a re-registration cannot be undone by
 * a stale cleanup.
 */
export function setLoginRedirectHandler(fn: LoginRedirect): () => void {
  handler = fn;
  return () => {
    if (handler === fn) handler = null;
  };
}

/**
 * Send an expired session to /login WITHOUT throwing away where it was.
 *
 * `window.location.assign('/login')` — what the interceptor did before this
 * task — reloads the whole application, and a reload cannot carry router
 * state, so the url the user was on is gone before LoginPage renders. Going
 * through the router keeps it.
 *
 * The hard assign survives as the fallback for the window before the bridge
 * mounts (a request issued during the first render) and for any caller outside
 * React. It loses the deep link, which is why it is the fallback and not the
 * path.
 */
export function redirectToLogin(returnTo: string): void {
  if (handler) {
    handler(returnTo);
    return;
  }
  if (typeof window !== 'undefined') window.location.assign('/login');
}
