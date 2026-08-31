import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

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
