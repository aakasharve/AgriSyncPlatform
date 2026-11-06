// @vitest-environment jsdom
/**
 * spec: plr-d10 (I28, lane L4b — carried from the L6 review; founder rule "names follow the language STRICTLY") — in
 * Marathi mode the sync sheet is Marathi: a refused row is explained by its error CODE, never by the server's English
 * `lastError`; an unknown code gets a plain Marathi sentence; the wire name (`verify_log_v2`) never shows.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, cleanup } from '@testing-library/react';
import type { SyncQueueStatus } from '../../hooks/useSyncQueueStatus';
import type { StuckMutationView } from '../../status/stuckMutations';

const lang = vi.hoisted(() => ({ current: 'mr' as 'mr' | 'en' }));
const queueStatus = vi.hoisted(() => ({ current: null as unknown as SyncQueueStatus }));

vi.mock('../../../../i18n/LanguageContext', () => ({
    useOptionalLanguage: () => ({ language: lang.current, setLanguage: () => undefined, t: (k: string) => k }),
}));
vi.mock('../../hooks/useSyncQueueStatus', () => ({
    useSyncQueueStatus: () => queueStatus.current,
    useUnqueueableLogCount: () => 0,
}));
vi.mock('../../../approval/unsentRecords', () => ({ useUnsentRecordCount: () => 2 }));
vi.mock('../../../../infrastructure/sync/BackgroundSyncWorker', () => ({
    backgroundSyncWorker: { retryFailed: vi.fn(), retryAllFailed: vi.fn(), triggerNow: vi.fn() },
}));
vi.mock('../../../../infrastructure/storage/DexieDatabase', () => ({
    getDatabase: () => ({ pendingAiJobs: { where: () => ({ equals: () => ({ count: async () => 0 }) }) } }),
}));

import SyncStatusDrawer from '../SyncStatusDrawer';
import { SyncMutationName } from '../../../../infrastructure/sync/SyncMutationCatalog';

const refused = (over: Partial<StuckMutationView>): StuckMutationView => ({
    id: 1, clientRequestId: 'req-1', mutationType: SyncMutationName.VerifyLogV2, status: 'REJECTED_USER_REVIEW', retryCount: 0,
    lastError: 'This record changed after it was opened for review. Look at the new version before confirming it.',
    errorCode: 'ShramSafal.LogVersion.Conflict', remedy: 'NEEDS_REVIEW', ...over,
});

const setQueue = (stuck: StuckMutationView[]) => {
    queueStatus.current = {
        pendingCount: 3, failedCount: stuck.length, stuckMutations: stuck, syncedCount: 4, pendingUploads: 0,
        failedUploads: 0, pendingAiJobs: 0, isOnline: false, lastSyncAt: null, hasLoaded: true,
    };
};

describe('the sync sheet in Marathi mode shows Marathi', () => {
    beforeEach(() => { lang.current = 'mr'; });
    afterEach(cleanup);

    it('a stale-version refusal says what happened in Marathi, never the server English', () => {
        setQueue([refused({}), refused({ clientRequestId: 'req-2', mutationType: SyncMutationName.CreateDailyLog, errorCode: 'Some.Unknown.Code', lastError: 'Internal server error' })]);
        render(<SyncStatusDrawer isOpen onClose={vi.fn()} onOpenConflicts={vi.fn()} />);
        expect(screen.getByTestId('sync-reason-req-1')).toHaveTextContent('ही नोंद बदलली आहे — नवीन नोंद पाहून मंजूर करा');
        expect(screen.getByTestId('sync-reason-req-2')).toHaveTextContent('श्रमसफलने हे स्वीकारलं नाही');
        expect(screen.getByTestId('sync-unsent')).toHaveTextContent('पाठवणे बाकी २');
        const text = document.body.textContent ?? '';
        expect(text).not.toMatch(/This record changed|Internal server error|verify_log_v2|create_daily_log/);
        expect(text).not.toMatch(/Sync Status|Retry|need you|Offline|Never|Sync Now/);
        expect(text).not.toMatch(/अडकल/);
    });

    it('lane L4b fix round 1 (L-5) — a row that only failed to send (no code) is a send failure, never "refused"', () => {
        setQueue([refused({ clientRequestId: 'req-3', status: 'FAILED', remedy: 'RETRY', errorCode: undefined, lastError: 'Network Error' })]);
        render(<SyncStatusDrawer isOpen onClose={vi.fn()} onOpenConflicts={vi.fn()} />);
        const reason = screen.getByTestId('sync-reason-req-3');
        expect(reason).toHaveTextContent('पाठवता आलं नाही — नेट आल्यावर पुन्हा पाठवा');
        expect(reason).not.toHaveTextContent('स्वीकारलं नाही');
        expect(document.body.textContent).not.toMatch(/Network Error/);
    });

    it('in English mode the same row is explained in English (one language at a time)', () => {
        lang.current = 'en';
        setQueue([refused({})]);
        render(<SyncStatusDrawer isOpen onClose={vi.fn()} onOpenConflicts={vi.fn()} />);
        expect(screen.getByTestId('sync-reason-req-1')).toHaveTextContent('This record changed — look at the new version and approve it');
        expect(document.body.textContent).not.toMatch(/[ऀ-ॿ]/);
    });
});
