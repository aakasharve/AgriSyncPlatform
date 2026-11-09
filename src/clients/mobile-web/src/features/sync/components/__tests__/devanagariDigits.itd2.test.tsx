// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: dfes-input-truth-and-mix-check-2026-11-06 (lane IT-D2; founder D-123b, 2026-11-09) - the sync sheet (IT4 / IT5 rows): a waiting
 * or refused product answer (`assert_input_identity`) and a waiting wrong-mix "पाहिलं" (`compliance.acknowledge`) are named in his
 * words, and every count and age on the sheet is in Devanagari digits in Marathi mode (0-9 in English mode).
 *
 * The WHOLE sheet is scanned, rows past the fifth ("आणखी N") and the waiting counts included. What it lets through, named: nothing.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import type { SyncQueueStatus } from '../../hooks/useSyncQueueStatus';
import type { StuckMutationView } from '../../status/stuckMutations';
import { latinDigitFindings } from '../../../../shared/test/latinDigits';

const lang = vi.hoisted(() => ({ current: 'mr' as 'mr' | 'en' | undefined }));
const queueStatus = vi.hoisted(() => ({ current: null as unknown as SyncQueueStatus }));

vi.mock('../../../../i18n/LanguageContext', () => ({
    // `undefined` = no language provider at all (a bare mount): the hook answers null
    useOptionalLanguage: () => (lang.current === undefined ? null : { language: lang.current, setLanguage: () => undefined, t: (k: string) => k }),
}));
vi.mock('../../hooks/useSyncQueueStatus', () => ({
    useSyncQueueStatus: () => queueStatus.current,
    useUnqueueableLogCount: () => 4,
}));
vi.mock('../../../approval/unsentRecords', () => ({ useUnsentRecordCount: () => 12 }));
vi.mock('../../../../infrastructure/sync/BackgroundSyncWorker', () => ({
    backgroundSyncWorker: { retryFailed: vi.fn(), retryAllFailed: vi.fn(), triggerNow: vi.fn() },
}));
vi.mock('../../../../infrastructure/storage/DexieDatabase', () => ({
    getDatabase: () => ({ pendingAiJobs: { where: () => ({ equals: () => ({ count: async () => 0 }) }) } }),
}));

import SyncStatusDrawer from '../SyncStatusDrawer';
import { SyncMutationName } from '../../../../infrastructure/sync/SyncMutationCatalog';

const row = (n: number, mutationType: string, over: Partial<StuckMutationView> = {}): StuckMutationView => ({
    id: n, clientRequestId: `req-${n}`, mutationType, status: 'REJECTED_USER_REVIEW', retryCount: 0,
    lastError: 'refused', errorCode: 'Some.Unknown.Code', remedy: 'NEEDS_REVIEW', ...over,
});

const setQueue = (stuck: StuckMutationView[]) => {
    queueStatus.current = {
        pendingCount: 23, failedCount: stuck.length, stuckMutations: stuck, syncedCount: 140, pendingUploads: 6,
        failedUploads: 2, pendingAiJobs: 3, isOnline: true, lastSyncAt: new Date(Date.now() - 5 * 60_000), hasLoaded: true,
    } as unknown as SyncQueueStatus;
};

/** Seven refused rows, so the "आणखी २" line shows; the two rows of this lane among them. */
const stuckRows = (): StuckMutationView[] => [
    row(1, SyncMutationName.AssertInputIdentity),
    row(2, SyncMutationName.ComplianceAcknowledge),
    row(3, SyncMutationName.AssertInputIdentity, { status: 'FAILED', remedy: 'RETRY', errorCode: undefined, lastError: 'Network Error' }),
    row(4, SyncMutationName.ComplianceAcknowledge, { status: 'FAILED', remedy: 'RETRY', errorCode: undefined, lastError: 'Network Error' }),
    row(5, SyncMutationName.CreateDailyLog),
    row(6, SyncMutationName.VerifyLog),
    row(7, SyncMutationName.CreateDailyLog),
];

describe('IT-D2 - the sync sheet in Marathi mode shows no Latin digit', () => {
    beforeEach(() => { lang.current = 'mr'; setQueue(stuckRows()); });
    afterEach(cleanup);

    it('the whole sheet, with the product answer and the wrong-mix acknowledgement rows named, every row shown', () => {
        render(<SyncStatusDrawer isOpen onClose={vi.fn()} onOpenConflicts={vi.fn()} />);
        fireEvent.click(screen.getByText(/आणखी/));
        // The two rows of this lane are named in his words, and the numbers really are on the sheet.
        expect(screen.getByTestId('sync-unsent')).toHaveTextContent('पाठवणे बाकी १२');
        expect(screen.getByTestId('sync-unsent')).toHaveTextContent('२३ बदल');
        expect(document.body.textContent).toContain('औषधाबद्दलचं उत्तर');
        expect(document.body.textContent).toContain('चुकीच्या मिश्रणाचं पाहिलं');
        expect(document.body.textContent).toContain('१४० पोहोचले');
        expect(latinDigitFindings(document.body)).toEqual([]);
    });

    it('a bare mount (no language provider): the words fall back to English and so do the digits - never English words with Devanagari digits', () => {
        lang.current = undefined;
        render(<SyncStatusDrawer isOpen onClose={vi.fn()} onOpenConflicts={vi.fn()} />);
        expect(screen.getByTestId('sync-unsent')).toHaveTextContent('12 records not sent yet');
        expect(screen.getByTestId('sync-pending-count')).toHaveTextContent('32');
        expect(screen.getByTestId('sync-pending-count').getAttribute('aria-label')).toBe('32 pending');
        expect(screen.getByTestId('sync-waiting-recordings')).toHaveTextContent(/^3 /);
        expect(document.body.textContent).not.toMatch(/[०-९]/);
    });

    it('English mode keeps 0-9 on the same sheet', () => {
        lang.current = 'en';
        render(<SyncStatusDrawer isOpen onClose={vi.fn()} onOpenConflicts={vi.fn()} />);
        expect(screen.getByTestId('sync-unsent')).toHaveTextContent('12 records not sent yet');
        expect(screen.getByTestId('sync-unsent')).toHaveTextContent('23 changes');
        expect(document.body.textContent).not.toMatch(/[०-९]/);
    });
});
