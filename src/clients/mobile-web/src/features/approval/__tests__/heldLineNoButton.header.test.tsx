// @vitest-environment jsdom
/**
 * spec: plr-d10 (I28, lane L4b fix round 2; re-review 2 N-2, orchestrator ruling) — the strip's trial line
 * "मंजुरीसाठी सदस्यता सुरू असावी लागते" is a plain line with NO button, even for the primary account holder, until the
 * billing / trial lane gives it a real action. The billing page it used to open is English-only and its "Renew" only
 * pops an alert, so a button there would be a button that cannot work (doctrine P5).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { t as translate, type Language } from '../../../i18n/translations';
import type { SyncQueueStatus } from '../../sync/hooks/useSyncQueueStatus';

const queue: SyncQueueStatus = {
    pendingCount: 0, failedCount: 0, stuckMutations: [], syncedCount: 0, pendingUploads: 0, failedUploads: 0,
    pendingAiJobs: 0, isOnline: true, lastSyncAt: null, hasLoaded: true,
};

vi.mock('../../../i18n/LanguageContext', () => ({
    useLanguage: () => ({ language: 'mr' as Language, setLanguage: () => { }, t: (key: string) => translate(key, 'mr') }),
    useOptionalLanguage: () => ({ language: 'mr' as Language, setLanguage: () => { }, t: (key: string) => translate(key, 'mr') }),
}));
vi.mock('../../../shared/components/ui/PageToggle', () => ({ default: () => <div data-testid="page-toggle" /> }));
vi.mock('../../sync', () => ({
    useSyncQueueStatus: () => queue,
    useUnqueueableLogCount: () => 0,
    SyncStatusDrawer: () => null,
}));
vi.mock('../unsentRecords', async (orig) => ({
    ...(await orig<typeof import('../unsentRecords')>()),
    useUnsentRecordCount: () => 0,
    useHeldApprovalCount: () => 1,
}));

import AppHeader from '../../context/components/AppHeader';
import { publishApprovalQueue, resetApprovalQueueForTests } from '../approvalQueue';
import { EMPTY_LABOUR_DATA } from '../../labour/labourMock';

afterEach(() => { cleanup(); resetApprovalQueueForTests(); localStorage.clear(); });

describe('the trial line on the header strip', () => {
    it('is a plain line for the primary account holder too: no button, no way to a screen that cannot act yet', async () => {
        publishApprovalQueue('farm-1', { ...EMPTY_LABOUR_DATA, review: [], canConfirm: true });
        const onNavigate = vi.fn();
        await act(async () => {
            render(
                <AppHeader
                    currentRoute="main"
                    currentView="log"
                    onNavigate={onNavigate}
                    onViewChange={vi.fn()}
                    farmContext={{
                        farms: [{ farmId: 'farm-1', name: 'Arve Farm', role: 'PrimaryOwner', farmCode: 'ABC123', subscription: null }],
                        currentFarmId: 'farm-1',
                        onSwitchFarm: vi.fn(),
                        onCreateFarm: vi.fn(),
                        onJoinViaQr: vi.fn(),
                    } as never}
                />,
            );
        });
        const line = screen.getByTestId('strip-held-approvals');
        expect(line).toHaveTextContent('मंजुरीसाठी सदस्यता सुरू असावी लागते');
        expect(line.tagName).not.toBe('BUTTON');
        expect(line.closest('button')).toBeNull();
        expect(onNavigate).not.toHaveBeenCalled();
    });
});
