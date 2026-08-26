// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: 2026-08-14-founder-decisions-launch-cohort-and-scope, D4 — Task 6.
 *
 * `SettingsPage` (Profile → Settings) is the SECOND reachable entry point
 * into the broken harvest feature, separate from route 'income'. Its
 * "Harvest Configuration" section used to expand into a per-plot editor that
 * opened `HarvestConfigSheet` directly — that save genuinely persisted, but
 * it set a farmer up to configure a feature whose sale/session tracking
 * cannot complete (D4: the backend has no harvest type at all). This suite
 * proves that section now shows the same honest coming-soon message and
 * offers no per-plot setup/edit control.
 *
 * `VoiceRetainedConsentToggle` and `NotificationTestComponent` are stubbed —
 * both have their own test coverage and are unrelated to Task 6; stubbing
 * them isolates this suite to the Harvest section this task actually
 * changed.
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import type { LedgerDefaults, CropProfile } from '../../types';

vi.mock('../../app/context/AppFeatureContexts', () => ({
    useAppNavigationState: () => ({ setCurrentRoute: vi.fn() }),
}));

vi.mock('../../i18n/LanguageContext', () => ({
    useLanguage: () => ({ language: 'en', setLanguage: () => undefined, t: (k: string) => k }),
}));

vi.mock('../../features/consent/VoiceRetainedConsentToggle', () => ({
    default: () => <div data-testid="voice-consent-toggle-stub" />,
}));

vi.mock('../../shared/components/NotificationTestComponent', () => ({
    default: () => <div data-testid="notification-test-stub" />,
}));

import SettingsPage from '../SettingsPage';

const DEFAULTS: LedgerDefaults = {
    irrigation: { method: 'drip', source: 'well', defaultDuration: 60 },
    labour: { defaultWage: 300, defaultHours: 8, shifts: [] },
    machinery: { defaultRentalCost: 0, defaultFuelCost: 0 },
};

const CROPS: CropProfile[] = [{
    id: 'crop-1',
    name: 'Grapes',
    plots: [{ id: 'plot-1', name: 'Plot A' }],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any];

afterEach(() => {
    cleanup();
});

describe('SettingsPage — "Harvest Configuration" (Task 6, spec D4)', () => {
    it('shows the honest harvest coming-soon message', () => {
        render(<SettingsPage defaults={DEFAULTS} onUpdateDefaults={() => undefined} crops={CROPS} />);
        expect(screen.getByTestId('harvest-coming-soon')).toBeInTheDocument();
        expect(screen.getByText(/harvest tracking is coming soon/i)).toBeInTheDocument();
    });

    it('keeps the section heading but drops the per-plot setup/edit control', () => {
        render(<SettingsPage defaults={DEFAULTS} onUpdateDefaults={() => undefined} crops={CROPS} />);
        // The heading key is still present (settings.harvestConfig, mocked to
        // its own key text) — only the interactive body underneath changed.
        expect(screen.getByText('settings.harvestConfig')).toBeInTheDocument();
        expect(screen.queryByText('settings.setup')).not.toBeInTheDocument();
        expect(screen.queryByText(CROPS[0].name)).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /edit/i })).not.toBeInTheDocument();
    });
});
