import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  currentPathWithQuery,
  redirectToLogin,
  safeReturnTo,
  setLoginRedirectHandler,
} from '@/lib/returnTo';

/**
 * Task 11, Steps 6 and 7 — the deep link.
 *
 * None of this is visible in a mockup. The v3 prototype's login handler is a
 * redirect to index.html, so a design-led port rebuilds "sign in" as "go
 * home", and every bookmarked, shared or mid-session-expired url quietly
 * becomes page one of the default view.
 */

/**
 * jsdom's `window.location` is replaceable on the window object but its own
 * `assign` is not configurable, so `vi.spyOn(window.location, 'assign')`
 * throws. Swapping the whole property is the only way to observe the fallback
 * redirect. Same technique, and the same reason, as api.contract.test.ts.
 */
let locationDescriptor: PropertyDescriptor | undefined;

function stubLocation(pathname: string, search = '') {
  const calls: string[] = [];
  locationDescriptor = Object.getOwnPropertyDescriptor(window, 'location');
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { pathname, search, href: 'http://localhost' + pathname + search, assign: (to: string) => calls.push(to) },
  });
  return calls;
}

afterEach(() => {
  if (locationDescriptor) {
    Object.defineProperty(window, 'location', locationDescriptor);
    locationDescriptor = undefined;
  }
  window.history.replaceState({}, '', '/');
});

describe('currentPathWithQuery keeps the whole url (Step 6)', () => {
  it('keeps the query string, which is where every piece of url state lives', () => {
    expect(currentPathWithQuery({ pathname: '/farms', search: '?page=7&tier=B' })).toBe(
      '/farms?page=7&tier=B',
    );
  });

  it('returns a bare path when there is no query', () => {
    expect(currentPathWithQuery({ pathname: '/users', search: '' })).toBe('/users');
  });

  it('falls back to the browser url when no router location is given', () => {
    // This is the shape the 401 interceptor uses: it has no hooks and no
    // router location, only the address bar.
    window.history.replaceState({}, '', '/ops/errors?since=2026-08-01');
    expect(currentPathWithQuery()).toBe('/ops/errors?since=2026-08-01');
  });

  it('recovers ?org= even though React Router cannot see it', () => {
    // ActiveOrgProvider writes the org with a raw history.replaceState
    // (ActiveOrgProvider.tsx:102-108), which the router never observes. Read
    // the router alone and the restored deep link points at a DIFFERENT
    // TENANT'S data than the one the user was looking at.
    const org = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    window.history.replaceState({}, '', `/farms?page=3&org=${org}`);

    // What the router believes: the org is missing from its own search.
    const routerBlindToOrg = { pathname: '/farms', search: '?page=3' };

    expect(currentPathWithQuery(routerBlindToOrg)).toBe(`/farms?page=3&org=${org}`);
  });

  it('lets the router win on a parameter both of them have', () => {
    window.history.replaceState({}, '', '/farms?page=1');
    expect(currentPathWithQuery({ pathname: '/farms', search: '?page=9' })).toBe('/farms?page=9');
  });
});

describe('safeReturnTo refuses to leave the console (Step 6)', () => {
  it('passes an in-console path through untouched, query and all', () => {
    expect(safeReturnTo('/farms?page=7&tier=B')).toBe('/farms?page=7&tier=B');
  });

  it.each([
    'https://evil.example/steal', // an absolute url
    '//evil.example/steal', // a protocol-relative url — still leaves the site
    '/\\evil.example', // the backslash variant browsers also accept
    'farms', // a relative path, which resolves against wherever we happen to be
    '', // an empty string
    undefined, // nothing at all
    null,
    { pathname: '/farms' }, // not a string
  ])('sends %o home — it is not a place inside this console', (input) => {
    expect(safeReturnTo(input)).toBe('/');
  });

  it('honours an explicit fallback', () => {
    expect(safeReturnTo(undefined, '/ops/live')).toBe('/ops/live');
  });
});

describe('the login-redirect bridge (Step 7)', () => {
  it('routes through the registered handler and does NOT reload the page', () => {
    const calls = stubLocation('/farms', '?page=3');
    const handler = vi.fn();
    const dispose = setLoginRedirectHandler(handler);

    redirectToLogin('/farms?page=3');

    expect(handler).toHaveBeenCalledWith('/farms?page=3');
    // A hard assign reloads, and a reload cannot carry router state — which is
    // the whole deep link, thrown away by the feature meant to preserve it.
    expect(calls).toEqual([]);
    dispose();
  });

  it('falls back to a hard redirect when no router is mounted', () => {
    // A request issued before the bridge's effect runs, or from outside React.
    // It loses the deep link; that is why it is the fallback and not the path.
    const calls = stubLocation('/farms', '?page=3');
    redirectToLogin('/farms?page=3');
    expect(calls).toEqual(['/login']);
  });

  it('stops routing once the handler is disposed', () => {
    const calls = stubLocation('/farms');
    const handler = vi.fn();
    setLoginRedirectHandler(handler)();

    redirectToLogin('/farms');

    expect(handler).not.toHaveBeenCalled();
    expect(calls).toEqual(['/login']);
  });

  it('a stale disposer cannot unregister the handler that replaced it', () => {
    // React re-runs the effect whenever `logout` changes identity. Cleanup of
    // the OLD registration runs after the new one is installed; a naive
    // `handler = null` there would silently disarm the bridge.
    const calls = stubLocation('/farms');
    const first = vi.fn();
    const second = vi.fn();

    const disposeFirst = setLoginRedirectHandler(first);
    setLoginRedirectHandler(second);
    disposeFirst();

    redirectToLogin('/farms');

    expect(second).toHaveBeenCalledWith('/farms');
    expect(first).not.toHaveBeenCalled();
    expect(calls).toEqual([]);

    setLoginRedirectHandler(second)();
  });
});
