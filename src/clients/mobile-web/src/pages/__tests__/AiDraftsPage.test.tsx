// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: 2026-08-14-founder-decisions-launch-cohort-and-scope — fix rounds 1-2.
 *
 * Independent review found that the reader-level tests proved
 * `PendingAiResultsReader` is called correctly, but nothing proved
 * `AiDraftsPage` — the CALLER — uses it correctly. This file is that missing
 * layer. It stubs the heavy `ManualEntry` component (already covered
 * elsewhere) and the app-feature-context hooks, and drives the page's own
 * wiring:
 *
 *   - CRITICAL 1/2 — tapping "Review" must set the app-level `logScope` to
 *     the DRAFT's crop/plot before `ManualEntry` mounts.
 *   - CRITICAL 3 — the embedded `ManualEntry` must receive a real
 *     `todayCountsMap`, not the all-zero default.
 *   - IMPORTANT 4 — the job's recorded date reaches `ManualEntry`.
 *   - NEW 1 (round 2) — the app-level `logScope` this page overwrites for
 *     review MUST be restored — backing out of review, or the page
 *     unmounting, must not leave the rest of the app pointed at the draft's
 *     plot for the remainder of the session.
 *   - NEW 2 (round 2) — `handleManualSubmit`'s outcome is a 3-way signal, not
 *     a boolean: `'saved'` marks reviewed, `'not_saved'` alerts and does NOT
 *     mark reviewed, `'already_saving'` (the losing tap of a double-tap) is
 *     SILENT — no alert, no mark — because the winning call is the one
 *     actually saving.
 *   - NEW 4 (round 2) — a successful save must reset the app-level `status`
 *     back to `'idle'`, so the farmer's next visit to the live capture
 *     screen does not land on a stale "Saved to Ledger" panel for a save
 *     made on this page.
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest';
import type { CropProfile } from '../../types';
import type { UnreviewedAiResult, AiDraftForReview } from '../../infrastructure/sync/PendingAiResultsReader';

// The scope active BEFORE this page ever touches it — distinct from the
// draft's own plot ('plot-a') so a restore is verifiably distinguishable
// from "never changed" and from "left on the draft's plot".
const ORIGINAL_SCOPE = {
    selectedCropIds: ['crop-existing'],
    selectedPlotIds: ['plot-existing'],
    mode: 'single' as const,
    applyPolicy: 'broadcast' as const,
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let currentLogScope: any = ORIGINAL_SCOPE;
const mockSetLogScope = vi.fn((scope: unknown) => { currentLogScope = scope; });
const mockGetTodayCounts = vi.fn((plotId: string) => ({
    cropActivities: 1, irrigation: 0, labour: 3, inputs: 0, machinery: 0,
    disturbance: 0, observations: 0, activityExpenses: 0, reminders: 0, harvest: 0,
    _plotId: plotId,
}));
const mockHandleManualSubmit = vi.fn();
const mockSetStatus = vi.fn();

vi.mock('../../app/context/AppFeatureContexts', () => ({
    useAppDataState: () => ({ crops: MOCK_CROPS, farmerProfile: { motors: [], waterResources: [], machineries: [] }, ledgerDefaults: undefined }),
    useAppCommandsState: () => ({ handleManualSubmit: mockHandleManualSubmit }),
    useAppLogState: () => ({ logScope: currentLogScope, setLogScope: mockSetLogScope }),
    useAppViewHelpers: () => ({ getTodayCounts: mockGetTodayCounts }),
    useAppVoiceState: () => ({ setStatus: mockSetStatus }),
}));

const mockListUnreviewedAiResults = vi.fn();
const mockMarkAiResultReviewed = vi.fn();
const mockBuildAiDraftForReview = vi.fn();

vi.mock('../../infrastructure/sync/PendingAiResultsReader', () => ({
    listUnreviewedAiResults: (...args: unknown[]) => mockListUnreviewedAiResults(...args),
    markAiResultReviewed: (...args: unknown[]) => mockMarkAiResultReviewed(...args),
    buildAiDraftForReview: (...args: unknown[]) => mockBuildAiDraftForReview(...args),
}));

// Heavy component, already covered by its own tests elsewhere. Stubbed to a
// thin control surface: a Save button that calls the real onSubmit prop, and
// a data dump of the props this task's fix rounds care about.
vi.mock('../../features/logs/components/ManualEntry', () => ({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    default: (props: any) => (
        <div data-testid="manual-entry-stub">
            <div data-testid="today-counts-map">{JSON.stringify(props.todayCountsMap)}</div>
            <div data-testid="recorded-date-key">{props.recordedDateKey}</div>
            <button type="button" onClick={() => props.onSubmit({ cropActivities: [] })}>Save</button>
        </div>
    ),
}));

import AiDraftsPage from '../AiDraftsPage';

const MOCK_CROPS: CropProfile[] = [{
    id: 'crop-grapes',
    name: 'Grapes',
    plots: [{ id: 'plot-a', name: 'Plot A' }],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any];

const DRAFT_JOB = {
    id: 7,
    operationType: 'voice_parse',
    context: { farmId: 'farm-1', userId: 'user-1', operation: 'voice', plotId: 'plot-a' },
    status: 'completed',
    createdAt: '2026-08-14T18:30:00.000Z',
    updatedAt: '2026-08-14T18:31:00.000Z',
    retryCount: 0,
    result: { operationType: 'voice_parse', receivedAtUtc: '2026-08-14T19:00:00.000Z', payload: {} },
} as unknown as UnreviewedAiResult;

const BUILT_DRAFT: AiDraftForReview = {
    context: { selection: [{ cropId: 'crop-grapes', cropName: 'Grapes', selectedPlotIds: ['plot-a'], selectedPlotNames: ['Plot A'] }] },
    agriLog: {
        summary: '', dayOutcome: 'WORK_RECORDED', cropActivities: [], irrigation: [], labour: [],
        inputs: [], machinery: [], activityExpenses: [], questionsForUser: [], missingSegments: [],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
    provenance: { source: 'ai', timestamp: '2026-08-14T19:00:00.000Z' },
    recordedDateKey: '2026-08-13',
};

async function openReview() {
    const rendered = render(<AiDraftsPage onBack={vi.fn()} />);
    await waitFor(() => {
        expect(screen.getByRole('button', { name: /review/i })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: /review/i }));
    await waitFor(() => {
        expect(screen.getByTestId('manual-entry-stub')).toBeInTheDocument();
    });
    return rendered;
}

beforeEach(() => {
    vi.clearAllMocks();
    currentLogScope = ORIGINAL_SCOPE;
    mockListUnreviewedAiResults.mockResolvedValue([DRAFT_JOB]);
    mockMarkAiResultReviewed.mockResolvedValue(undefined);
    mockBuildAiDraftForReview.mockReturnValue(BUILT_DRAFT);
});

afterEach(() => {
    cleanup();
});

describe('AiDraftsPage — Review opens the draft with a correct app-level scope (CRITICAL 1/2)', () => {
    it('sets logScope to the draft\'s crop/plot BEFORE ManualEntry mounts', async () => {
        await openReview();

        expect(mockSetLogScope).toHaveBeenCalledWith({
            selectedCropIds: ['crop-grapes'],
            selectedPlotIds: ['plot-a'],
            mode: 'single',
            applyPolicy: 'broadcast',
        });
    });
});

describe('AiDraftsPage — today\'s counts are real, not a fabricated zero (CRITICAL 3)', () => {
    it('passes a non-empty todayCountsMap keyed by the draft\'s plot', async () => {
        await openReview();

        expect(mockGetTodayCounts).toHaveBeenCalledWith('plot-a', expect.any(String));
        const rendered = screen.getByTestId('today-counts-map').textContent ?? '';
        expect(rendered).toContain('plot-a');
        expect(rendered).not.toBe('{}');
    });
});

describe('AiDraftsPage — the recorded date reaches ManualEntry (IMPORTANT 4)', () => {
    it('passes the draft\'s recordedDateKey through, not left undefined', async () => {
        await openReview();

        expect(screen.getByTestId('recorded-date-key').textContent).toBe('2026-08-13');
    });
});

describe('AiDraftsPage — the app-level scope this page overwrites is always restored (NEW 1)', () => {
    it('restores the original logScope when the farmer backs out of review without saving', async () => {
        await openReview();
        expect(currentLogScope).toEqual({
            selectedCropIds: ['crop-grapes'], selectedPlotIds: ['plot-a'], mode: 'single', applyPolicy: 'broadcast',
        });

        fireEvent.click(screen.getByText('Back to Drafts'));

        await waitFor(() => {
            expect(screen.queryByTestId('manual-entry-stub')).not.toBeInTheDocument();
        });
        expect(currentLogScope).toEqual(ORIGINAL_SCOPE);
    });

    it('restores the original logScope when the page unmounts while still reviewing', async () => {
        const { unmount } = await openReview();
        expect(currentLogScope).not.toEqual(ORIGINAL_SCOPE);

        unmount();

        expect(currentLogScope).toEqual(ORIGINAL_SCOPE);
    });

    it('restores the original logScope after a successful save', async () => {
        mockHandleManualSubmit.mockResolvedValue('saved');
        await openReview();

        fireEvent.click(screen.getByText('Save'));

        await waitFor(() => {
            expect(mockMarkAiResultReviewed).toHaveBeenCalled();
        });
        expect(currentLogScope).toEqual(ORIGINAL_SCOPE);
    });
});

describe('AiDraftsPage — handleManualSubmit\'s 3-way outcome is read correctly (NEW 2, was IMPORTANT 3)', () => {
    it('does NOT call markAiResultReviewed and DOES alert when the outcome is not_saved', async () => {
        mockHandleManualSubmit.mockResolvedValue('not_saved');
        const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
        await openReview();

        fireEvent.click(screen.getByText('Save'));

        await waitFor(() => {
            expect(mockHandleManualSubmit).toHaveBeenCalledTimes(1);
        });
        expect(alertSpy).toHaveBeenCalledTimes(1);
        expect(mockMarkAiResultReviewed).not.toHaveBeenCalled();
        // The review screen must still be showing — the note is not lost.
        expect(screen.getByTestId('manual-entry-stub')).toBeInTheDocument();
        alertSpy.mockRestore();
    });

    it('stays completely silent (no alert, no mark) when the outcome is already_saving — the losing tap of a double-tap', async () => {
        mockHandleManualSubmit.mockResolvedValue('already_saving');
        const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
        await openReview();

        fireEvent.click(screen.getByText('Save'));

        await waitFor(() => {
            expect(mockHandleManualSubmit).toHaveBeenCalledTimes(1);
        });
        expect(alertSpy).not.toHaveBeenCalled();
        expect(mockMarkAiResultReviewed).not.toHaveBeenCalled();
        alertSpy.mockRestore();
    });

    it('DOES call markAiResultReviewed(jobId) once handleManualSubmit resolves saved', async () => {
        mockHandleManualSubmit.mockResolvedValue('saved');
        await openReview();

        fireEvent.click(screen.getByText('Save'));

        await waitFor(() => {
            expect(mockMarkAiResultReviewed).toHaveBeenCalledWith(7);
        });
    });
});

describe('AiDraftsPage — a stale "Saved to Ledger" panel is never left behind (NEW 4)', () => {
    it('resets the app-level status to idle after a successful save', async () => {
        mockHandleManualSubmit.mockResolvedValue('saved');
        await openReview();

        fireEvent.click(screen.getByText('Save'));

        await waitFor(() => {
            expect(mockSetStatus).toHaveBeenCalledWith('idle');
        });
    });

    it('does NOT touch status when the outcome is not_saved or already_saving', async () => {
        mockHandleManualSubmit.mockResolvedValue('not_saved');
        vi.spyOn(window, 'alert').mockImplementation(() => {});
        await openReview();

        fireEvent.click(screen.getByText('Save'));

        await waitFor(() => {
            expect(mockHandleManualSubmit).toHaveBeenCalledTimes(1);
        });
        expect(mockSetStatus).not.toHaveBeenCalled();
    });
});

describe('AiDraftsPage — non-reviewable rows (IMPORTANT 2)', () => {
    it('shows the explainer line and no Review button for a receipt_extract row', async () => {
        const receiptJob = {
            ...DRAFT_JOB,
            id: 9,
            operationType: 'receipt_extract',
            result: { operationType: 'receipt_extract', receivedAtUtc: '2026-08-14T19:00:00.000Z', payload: {} },
        } as unknown as UnreviewedAiResult;
        mockListUnreviewedAiResults.mockResolvedValue([receiptJob]);

        render(<AiDraftsPage onBack={vi.fn()} />);

        await waitFor(() => {
            expect(screen.getByText(/review isn't available/i)).toBeInTheDocument();
        });
        expect(screen.queryByRole('button', { name: /^review$/i })).not.toBeInTheDocument();
    });

    it('uses operation-correct discard copy for a receipt scan, not "voice note"', async () => {
        const receiptJob = {
            ...DRAFT_JOB,
            id: 9,
            operationType: 'receipt_extract',
            result: { operationType: 'receipt_extract', receivedAtUtc: '2026-08-14T19:00:00.000Z', payload: {} },
        } as unknown as UnreviewedAiResult;
        mockListUnreviewedAiResults.mockResolvedValue([receiptJob]);
        const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);

        render(<AiDraftsPage onBack={vi.fn()} />);
        await waitFor(() => {
            expect(screen.getByTitle('Discard')).toBeInTheDocument();
        });
        fireEvent.click(screen.getByTitle('Discard'));

        expect(confirmSpy).toHaveBeenCalledTimes(1);
        const [confirmMessage] = confirmSpy.mock.calls[0];
        expect(confirmMessage).toContain('receipt scan');
        expect(confirmMessage).not.toContain('voice note');
        confirmSpy.mockRestore();
    });
});
