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
 * is what App.tsx did before this task, silently downgrades
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
 * `routerLocation` (from `useLocation()`) is preferred for the path because it
 * is what re-renders a component when navigation happens. The query string is
 * then RECONCILED against `window.location`, and that is not belt-and-braces:
 * `ActiveOrgProvider` writes `?org=<uuid>` with a raw
 * `window.history.replaceState` (ActiveOrgProvider.tsx:102-108) that React
 * Router never observes, so the router's own `search` can be missing the one
 * parameter that decides which tenant's rows the restored link will show.
 * Task 12 moves that write onto the router; until it lands, reading the
 * router alone would drop the org out of every deep link this module exists
 * to protect. Reading the browser as well costs one loop and is correct
 * either way — after Task 12 the two agree and the loop adds nothing.
 */
export function currentPathWithQuery(routerLocation?: PathAndQuery): string {
  const browser: PathAndQuery | null =
    typeof window === 'undefined' || !window.location
      ? null
      : { pathname: window.location.pathname, search: window.location.search };

  const source = routerLocation ?? browser;
  if (!source) return '/';

  const params = new URLSearchParams(source.search);
  if (routerLocation && browser) {
    for (const [key, value] of new URLSearchParams(browser.search)) {
      if (!params.has(key)) params.append(key, value);
    }
  }

  const search = params.toString();
  return search ? `${source.pathname}?${search}` : source.pathname;
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
