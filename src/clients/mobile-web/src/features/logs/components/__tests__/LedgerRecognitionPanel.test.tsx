// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * LedgerRecognitionPanel — Phase 5, Task 5.9 wiring tests.
 *
 * Task 5.9 swaps the panel's internal MeterDisplay for MeterQuestionHost and
 * adds plotId/crop/todayLocalDate props (derived by mainView.tsx from the
 * saved log's context selection). These tests assert: (1) the single shared
 * useFarmerEngagement fetch still feeds both the meter's arrival gate and
 * MeterQuestionHost's questionInputs.engagement (not a hardcoded zero — this
 * worktree already has Phase 3's engagement wiring ahead of the Phase 5
 * brief's illustrative snippet, see task-43 report Reconciliation Notes);
 * (2) plotId/crop/todayLocalDate reach useDfesQuestion unchanged;
 * (3) a missing todayLocalDate falls back to "today".
 *
 * spec: dfes-companion-2026-07-11
 */
import React from 'react';
import { render, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

const useFarmerEngagementMock = vi.fn();
const useDfesQuestionMock = vi.fn();

vi.mock('../../hooks/useFarmerEngagement', () => ({
    useFarmerEngagement: (...args: unknown[]) => useFarmerEngagementMock(...args),
}));
vi.mock('../../hooks/useDfesQuestion', () => ({
    useDfesQuestion: (...args: unknown[]) => useDfesQuestionMock(...args),
}));

const engagementDto = {
    currentStreak: 3, longestStreak: 5, totalShramPoints: 40,
    lastAccountedDate: '2026-07-10', totalRichDays: 12, unlockStatus: 'unlocked' as const,
};

async function loadComponent() {
    vi.resetModules();
    vi.doMock('../../../../app/featureFlags', () => ({
        FEATURE_FLAGS: {
            understandingMeter: true,
            stageQuestions: true,
            disciplineSystem: false,
            DwcChip: false,
            voiceContinuity: false,
        },
        isFarmGeographyV2Enabled: () => false,
        isWeatherBackendFetchEnabled: () => false,
        isVoiceDoomLoopDetectorEnabled: () => true,
        IS_E2E_HARNESS_ENABLED: false,
        isE2EHarnessEnabled: () => false,
        isEnabled: () => true,
    }));
    return import('../LedgerRecognitionPanel');
}

beforeEach(() => {
    useFarmerEngagementMock.mockReset();
    useDfesQuestionMock.mockReset();
    useFarmerEngagementMock.mockReturnValue({ engagement: engagementDto, isLoading: false, error: null, refresh: vi.fn() });
    useDfesQuestionMock.mockReturnValue({ selected: null, loading: false, recordOutcome: vi.fn() });
});

afterEach(() => {
    cleanup();
    vi.doUnmock('../../../../app/featureFlags');
    vi.resetModules();
});

describe('LedgerRecognitionPanel (Phase 5, Task 5.9)', () => {
    it('threads plotId, crop, todayLocalDate, and the real fetched engagement into useDfesQuestion', async () => {
        const { LedgerRecognitionPanel } = await loadComponent();
        render(
            <LedgerRecognitionPanel
                farmId="farm-1"
                plotId="plot-9"
                crop="grapes"
                todayLocalDate="2026-07-11"
                savedLog={{ understanding: { score: 78, outcome: 'SCORED', dimensions: [] } }}
                allLogs={[]}
            />,
        );

        expect(useFarmerEngagementMock).toHaveBeenCalledWith('farm-1');
        expect(useDfesQuestionMock).toHaveBeenCalledWith(
            'farm-1',
            'plot-9',
            expect.objectContaining({
                crop: 'grapes',
                todayLocalDate: '2026-07-11',
                engagement: { totalRichDays: 12, unlockStatus: 'unlocked' },
            }),
            true,
        );
    });

    it('falls back to today\'s date and empty crop when not provided', async () => {
        const { LedgerRecognitionPanel } = await loadComponent();
        const todayIso = new Date().toISOString().slice(0, 10);
        render(<LedgerRecognitionPanel farmId="farm-1" allLogs={[]} />);

        expect(useDfesQuestionMock).toHaveBeenCalledWith(
            'farm-1',
            null,
            expect.objectContaining({ crop: '', todayLocalDate: todayIso }),
            true,
        );
    });

    it('falls back to a zero-default engagement for the question inputs when useFarmerEngagement has not resolved yet', async () => {
        useFarmerEngagementMock.mockReturnValue({ engagement: null, isLoading: true, error: null, refresh: vi.fn() });
        const { LedgerRecognitionPanel } = await loadComponent();
        render(<LedgerRecognitionPanel farmId="farm-1" allLogs={[]} />);

        expect(useDfesQuestionMock).toHaveBeenCalledWith(
            'farm-1',
            null,
            expect.objectContaining({ engagement: { totalRichDays: 0, unlockStatus: 'locked' } }),
            true,
        );
    });

    it('renders the panel wrapper', async () => {
        const { LedgerRecognitionPanel } = await loadComponent();
        const { getByTestId } = render(<LedgerRecognitionPanel farmId="farm-1" allLogs={[]} />);
        expect(getByTestId('ledger-recognition-panel')).toBeTruthy();
    });
});
