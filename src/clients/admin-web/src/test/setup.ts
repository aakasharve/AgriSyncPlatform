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
 *  2. The document URL — `ActiveOrgProvider.setActiveOrgId` calls
 *     `window.history.replaceState` to write `?org=<id>` (ActiveOrgProvider.tsx:102-108),
 *     and the provider reads that param back on mount (line 41). That is the
 *     same leak as localStorage wearing different clothes, so it is reset the
 *     same way. Note this is the REAL jsdom URL, not the MemoryRouter's —
 *     see the comment in renderWithProviders.tsx.
 *
 *  3. The DOM itself — RTL's `cleanup()`.
 */
afterEach(() => {
  cleanup();
  localStorage.clear();
  window.history.replaceState({}, '', '/');
});
