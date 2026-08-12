// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Labour Phase 2 -> Phase 1 (honesty backstop), Task T1 — finding F1, second half.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * `deriveSyncHonestyState` returns `null` for "we can prove nothing about this
 * device's records" — nothing outstanding, and no mutation ever acknowledged.
 * That is the honest resting state of a fresh install, and of a device whose
 * every log was dropped before it reached a queue. The derivation has been
 * returning it since `4928ba3f`; until now NOTHING RENDERED IT. The hook
 * projected `null -> 'ON_PHONE'` so the header kept compiling.
 *
 * A projection is a claim. `ON_PHONE` is the weakest of the three and could
 * never fabricate a receipt, so it was wrong in the safe direction — but it was
 * still the app telling a farmer something it had no evidence for. `P5` asks for
 * the absence of a claim, not the mildest available one, and the only way to
 * render an absent claim is to render nothing.
 *
 * This asserts that hop, on the real `AppHeader`, with the real `SyncIndicator`
 * inside it. Everything else is stubbed: this is about one boolean reaching one
 * conditional, not about the header's layout.
 *
 * It lives here rather than under `features/context/**` for the same reason as
 * `SyncIndicator.pairing.test.tsx` — that directory is outside the nine
 * WEB-LABOUR roots this phase gates commits on, and the invariant belongs to the
 * sync-honesty model anyway.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, cleanup } from '@testing-library/react';
import React from 'react';

import { t as translate, type Language } from '../../../../i18n/translations';
import { SYNC_HONESTY_I18N_KEYS, type SyncHonestyClaim } from '../syncHonestyState';

const claimRef: { current: SyncHonestyClaim } = { current: null };
const queueRef = {
    current: {
        pendingCount: 0,
        failedCount: 0,
        stuckMutations: [],
        syncedCount: 0,
        pendingUploads: 0,
        failedUploads: 0,
        pendingAiJobs: 0,
        isOnline: true,
        lastSyncAt: null,
    },
};

vi.mock('../../../../i18n/LanguageContext', () => ({
    useLanguage: () => ({
        language: 'mr' as Language,
        setLanguage: () => { },
        t: (key: string) => translate(key, 'mr'),
    }),
}));

vi.mock('../../../../app/hooks/useSyncStatus', () => ({
    useSyncStatus: () => ({ claim: claimRef.current, lastSyncedAt: undefined }),
}));

// The barrel, so `lucide-react` and the module-scope `backgroundSyncWorker`
// singleton stay out of this test's graph — the same reason T1 kept the sync
// status model OUT of that barrel in the first place.
vi.mock('../../../sync', () => ({
    useSyncQueueStatus: () => queueRef.current,
    SyncStatusDrawer: () => null,
}));

vi.mock('../../../context/components/FarmContextSwitcher', () => ({
    default: () => <div data-testid="farm-switcher" />,
}));

vi.mock('../../../../shared/components/ui/PageToggle', () => ({
    default: () => <div data-testid="page-toggle" />,
}));

import AppHeader from '../../../context/components/AppHeader';

const farmContext = {
    farms: [],
    currentFarmId: null,
    onSwitchFarm: () => { },
    onCreateFarm: () => { },
    onJoinViaQr: () => { },
};

function renderHeader() {
    return render(
        <AppHeader
            currentRoute="main"
            currentView="log"
            onNavigate={vi.fn()}
            onViewChange={vi.fn()}
            farmContext={farmContext}
        />,
    );
}

afterEach(() => {
    cleanup();
    claimRef.current = null;
    queueRef.current = { ...queueRef.current, pendingCount: 0, failedCount: 0, pendingUploads: 0, failedUploads: 0, pendingAiJobs: 0 };
});

describe('AppHeader — an absent claim is rendered as nothing, not as the mildest claim', () => {
    it('renders NO chip when the app can prove nothing', () => {
        claimRef.current = null;

        renderHeader();

        expect(screen.queryByTestId('sync-status-indicator')).toBeNull();
        // And none of the three labels leaks in by another route.
        for (const state of ['ON_PHONE', 'ON_SERVER', 'NEEDS_FIX'] as const) {
            expect(screen.queryByText(translate(SYNC_HONESTY_I18N_KEYS[state], 'mr'))).toBeNull();
        }
        // The strip itself survives — hiding the chip must not hide the farm.
        expect(screen.getByTestId('farm-switcher')).toBeInTheDocument();
    });

    it('a null claim takes its badge down with it', () => {
        // The badge is a separate arithmetic from the label. If it could outlive
        // the chip, a device with nothing to report would render a bare red
        // number attached to no statement at all.
        claimRef.current = null;
        queueRef.current = { ...queueRef.current, pendingCount: 3, failedCount: 2 };

        renderHeader();

        expect(screen.queryByTestId('sync-status-indicator')).toBeNull();
        expect(screen.queryByText('3')).toBeNull();
        expect(screen.queryByText('2')).toBeNull();
    });

    it.each(['ON_PHONE', 'ON_SERVER', 'NEEDS_FIX'] as const)(
        'renders the chip, with %s own label, whenever there IS a claim',
        (state) => {
            claimRef.current = state;

            renderHeader();

            const chip = screen.getByTestId('sync-status-indicator');
            expect(chip).toHaveTextContent(translate(SYNC_HONESTY_I18N_KEYS[state], 'mr'));
        },
    );

    it('the chip carries the number it is standing beside', () => {
        claimRef.current = 'NEEDS_FIX';
        queueRef.current = { ...queueRef.current, failedCount: 2, failedUploads: 1 };

        renderHeader();

        // AppHeader.tsx sums queue + uploads for the red half; a chip that says
        // "stuck" beside a "0" would be the original defect in miniature.
        expect(screen.getByTestId('sync-status-indicator')).toHaveTextContent('3');
    });
});
