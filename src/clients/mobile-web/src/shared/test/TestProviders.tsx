/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';

/**
 * Sub-plan 04 Task 1 test scaffold.
 *
 * Minimal pass-through wrapper that gives tests a stable composition seat
 * which Sub-plan 04 Tasks 4+ will fill with the XState `RootStore` actor +
 * the unified `MemoryRouter`. At Task 1, ProfilePage's required contexts
 * (`LanguageContext`, `AuthProvider`, `FarmContext`, etc.) are stubbed
 * per-file via `vi.mock` declarations in each importing test file.
 *
 * This component intentionally does NOT pre-mock those modules — `vi.mock`
 * must be hoisted to the top of the importing test file by Vitest, and
 * embedding mocks here would either be silently ignored or leak across
 * tests that don't want them.
 *
 * Recipe (in a *.test.tsx file):
 *
 *   import { describe, it, expect, vi } from 'vitest';
 *
 *   vi.mock('../../i18n/LanguageContext', () => ({
 *     useLanguage: () => ({ language: 'en', setLanguage: vi.fn(), t: (k: string) => k }),
 *     LanguageProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
 *   }));
 *   vi.mock('../../app/providers/AuthProvider', () => ({
 *     useAuth: () => ({
 *       session: { userId: 'test-user', accessToken: 't', refreshToken: 'r', expiresAtUtc: '2099-01-01T00:00:00Z' },
 *       isAuthenticated: true,
 *       isLoading: false,
 *       authError: null,
 *       login: vi.fn(),
 *       register: vi.fn(),
 *       logout: vi.fn(),
 *       refresh: vi.fn(),
 *       clearAuthError: vi.fn(),
 *     }),
 *     AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
 *   }));
 *
 *   import { TestProviders } from '../../shared/test/TestProviders';
 *   // ... render(<TestProviders><Subject /></TestProviders>)
 *
 * Task 6 removes the `initialTab` prop seam on ProfilePage. Until then,
 * snapshot tests pass `initialTab` directly via props.
 */
export const TestProviders: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <>{children}</>
);
