import { QueryCache, QueryClient } from '@tanstack/react-query';
import { describeAdminDenial } from './adminErrors';

/**
 * THE ONLY CATCH SITE THAT SEES EVERY QUERY.
 *
 * Moved here from App.tsx by the CR-2d join, unchanged in behaviour: the SMS
 * sign-in keeps the console's one QueryClient in this file (see below), and a
 * QueryCache can only be given to a client when the client is made.
 *
 * `AdminScopeAmbiguousError` and `AdminModuleForbiddenError` had zero catch
 * sites in this console. They still have to be *acted* on somewhere, and the
 * action is the same for both, for one reason: each of them is the server
 * contradicting the scope this client is currently gating on.
 *
 * The client caches `/admin/me/scope` for 60s and decides what to show from
 * that cache. If a data request comes back `admin_module_forbidden` for a
 * module the cached scope says is readable, the cache is wrong — the grant was
 * revoked, or the active org moved underneath it. Re-asking makes the console
 * gate on the truth within one request instead of within a minute. Doing
 * nothing leaves a revoked admin looking at a nav item they may no longer open.
 *
 * It cannot recurse: `/admin/me/scope` never returns 428 or 403. It answers
 * 200 with an `outcome` precisely so the client does not have to read error
 * codes to decide what to render (AdminEndpoints.cs:36-40, verified). So there
 * is no loop guard here, and that absence is deliberate rather than forgotten.
 *
 * It does NOT navigate. A background refetch failing is not a reason to yank a
 * working screen out from under someone; the scope gate's outcomes, and the
 * panel's own honest-state, are where a denial becomes visible.
 *
 * `./adminErrors` is a pure module (no axios, no React), so api.ts, which
 * imports this file, gains no new dependency through it.
 */
const queryCache = new QueryCache({
  onError: (error) => {
    if (!describeAdminDenial(error)) return;
    void queryClient.invalidateQueries({ queryKey: ['admin', 'me', 'scope'] });
  },
});

/**
 * Everything the console has loaded from the server is kept here, in memory, for the pages to
 * show again without asking. All of it belongs to the person who is signed in, so it is emptied
 * at every end of a session and at every sign-in (see `forgetSession` in api.ts and `login` in
 * AdminAuthProvider.tsx).
 *
 * It lives in its own file so that api.ts, which is not a React component, can empty it.
 */
export const queryClient = new QueryClient({
  queryCache,
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});
