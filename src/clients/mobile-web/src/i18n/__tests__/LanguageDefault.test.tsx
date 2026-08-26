// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The app must open in Marathi.
 *
 * AgriSync is a Marathi voice-first app for Marathi smallholders, and the
 * language fallback was 'en'. That fallback governs the FIRST paint — before
 * Dexie resolves the stored preference and long before
 * `LanguageSyncFromServer` can fetch `/me/context` — so every fresh install and
 * every first launch greeted the farmer in English. That is the single moment
 * he decides whether this app is for him.
 *
 * `LanguageSyncFromServer`'s own header already states the rule: "Marathi
 * should load first — not whatever localStorage remembers." Only the fallback
 * disagreed.
 *
 * evidence: docs/LAUNCH-READINESS-AND-AGRISTACK-2026-08-23.md — Decision 2 item 4
 */

import '@testing-library/jest-dom/vitest';
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

// Nothing stored yet — exactly the first-launch case. useUiPref hands back the
// caller's fallback, which is the value under test.
vi.mock('../../shared/hooks/useUiPref', () => ({
    useUiPref: <T,>(_key: string, fallback: T) => [fallback, vi.fn()] as const,
}));

// The server-preference sync is a separate mechanism with its own timing; this
// test is about what renders before anything arrives.
vi.mock('../LanguageSyncFromServer', () => ({
    LanguageSyncFromServer: () => null,
}));

import { LanguageProvider, useLanguage } from '../LanguageContext';

function LanguageProbe(): React.ReactElement {
    const { language } = useLanguage();
    return <span data-testid="lang">{language}</span>;
}

describe('LanguageProvider — first paint', () => {
    it('opens in Marathi when no preference has been stored yet', async () => {
        render(
            <LanguageProvider>
                <LanguageProbe />
            </LanguageProvider>,
        );

        await waitFor(() => {
            expect(screen.getByTestId('lang').textContent).toBe('mr');
        });
    });
});
