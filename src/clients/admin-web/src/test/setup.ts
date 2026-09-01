import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import type { AxiosAdapter, InternalAxiosRequestConfig } from 'axios';
import { adminApi } from '@/lib/api';

/**
 * Per-test isolation.
 *
 * Three things in this console persist OUTSIDE React and therefore leak from
 * one test into the next unless they are reset here:
 *
 *  1. localStorage — `admin.active-org.v1` (ActiveOrgProvider.tsx:12,57) and
 *     `admin.session.v1` (lib/auth.ts:1,39). A test that logs in would
 *     otherwise leave the next test authenticated. `admin.theme.v1` was the
 *     third until Task 3 deleted ThemeProvider with dark mode (D1); the
 *     clear() below is blanket, so nothing needed changing but this list.
 *
 *  2. The document URL. Task 12 moved `?org=` onto the ROUTER's search params,
 *     so the provider no longer reads or writes the jsdom url directly — but a
 *     BrowserRouter still starts from it, and `deepLink.contract.test.tsx` and
 *     `tenancyRouting.contract.test.tsx` both drive whole-console tests by
 *     setting it. Leaving one test's url in place would start the next one on
 *     a different screen, and possibly a different organisation, so it is reset
 *     the same way localStorage is.
 *
 *  3. The DOM itself — RTL's `cleanup()`.
 */
afterEach(() => {
  cleanup();
  localStorage.clear();
  window.history.replaceState({}, '', '/');
});

/**
 * ══ THE SUITE MAY NOT TALK TO A REAL SERVER — TASK 29 ═══════════════════
 *
 * 🛑 THIS IS THE `deepLink` FLAKE. It was blamed on file parallelism by five
 * consecutive tasks and it is not a tuning problem; it is a real defect with
 * a real-world shape, and the mechanism was MEASURED, not reasoned about.
 *
 * `installAdapter` (src/test/stubAdapter.ts) swaps the axios ADAPTER and puts
 * back whatever was there before. Before this block, "whatever was there
 * before" was **axios's own XHR adapter**, so between the moment one test
 * restores and the moment the next one installs, `adminApi` is wired to the
 * live network at `VITE_API_BASE_URL` — `http://localhost:5048`, the port the
 * .NET API listens on in local development.
 *
 * React Query does not cancel a fetch when its last observer unmounts, and it
 * schedules a retry a second after a failure. So a whole-console test that
 * finishes the instant its heading appears leaves `GET /admin/me/scope` (and
 * sometimes its screen's own query) in flight or queued. That request is then
 * dispatched during the NEXT test — measured: seven distinct leaks across
 * three runs, named by test.
 *
 * On a machine where the API is running, it answers **401** to the fixture
 * token. `lib/api.ts:63-69` is a module singleton shared by every test in the
 * file, so the 401 runs for real:
 *
 *   authStore.clear()   wipes `admin.session.v1` — which the current test has
 *                       ALREADY written in its first line;
 *   redirectToLogin()   hard-assigns `/login` when no router is mounted,
 *                       which is the "Not implemented: navigation to another
 *                       Document" line that appears in the run output.
 *
 * `AdminAuthProvider` reads the store ONCE, in its mount effect. If the 401
 * lands between `authStore.set(SESSION)` and `render(<App />)`, the console
 * mounts ANONYMOUS and renders the sign-in screen where the test expected a
 * page. That is exactly the DOM the failures dumped: "Unable to find Ops Now"
 * over a login form.
 *
 * ── Why this is the fix, and not a longer timeout ────────────────────────
 * The suite's result depended on whether a developer happened to have the API
 * running — an input no test declares and no reviewer can see. A transport
 * that fails every UNSTUBBED request removes that input. Nothing is weakened:
 * a leaked request now fails with an error carrying **no HTTP response**, so
 * no interceptor branch can fire, no session can be cleared, and the leak
 * cannot decide another test's outcome.
 *
 * `src/test/transport.contract.test.ts` pins it. Delete this and that test
 * goes red naming the reason.
 */
const UNSTUBBED: AxiosAdapter = (async (config: InternalAxiosRequestConfig) => {
  /* Deliberately NOT an axios error shape: no `response`, so `err.response.status`
     is undefined and the 401 / 428 / 403 branches of the response interceptor
     cannot be reached by an escaped request. */
  throw new Error(
    `[admin-web tests] ${(config.method ?? 'get').toUpperCase()} ${config.url} reached the ` +
      'transport with no stub installed. Tests never talk to a real server; ' +
      'install one with installAdapter() (src/test/stubAdapter.ts).',
  );
}) as AxiosAdapter;

adminApi.defaults.adapter = UNSTUBBED;

/* Re-armed per test, so a `restore()` inside a test body cannot hand the wire
   back to the network for the remainder of the file. */
beforeEach(() => {
  adminApi.defaults.adapter = UNSTUBBED;
});
