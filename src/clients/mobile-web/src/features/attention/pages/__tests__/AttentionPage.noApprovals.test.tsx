// @vitest-environment jsdom
/**
 * spec: plr-d10 (I28, lane L4b fix round 0) — founder D-1 (verbatim): "Approvals stay in मंजुरी (no shortcut here)."
 * The लक्ष द्या page carries no approval door and no approval item, even while records wait for his मंजूर on the farm.
 * (D-40's three signals live on the strip, whose third signal is this page's preview.)
 */
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';

const board = vi.hoisted(() => ({
    cards: [{
        cardId: 'dispute', farmId: 'farm-1', farmName: 'आर्वे शेत', plotId: 'p1', plotName: 'सोनाका', cropCycleId: 'cc1',
        stageName: 'फुलोरा', rank: 'Critical', computedAtUtc: '2026-10-26T03:30:00.000Z', titleEn: 'EN', titleMr: 'वाद',
        descriptionEn: 'EN', descriptionMr: 'वाद', suggestedAction: 'ResolveDispute', suggestedActionLabelEn: 'EN',
        suggestedActionLabelMr: 'वाद सोडवा', overdueTaskCount: null, latestHealthScore: null, unresolvedDisputeCount: 2,
    }] as unknown[],
}));

vi.mock('../../../../infrastructure/storage/DexieDatabase', () => ({
    getDatabase: () => ({
        attentionCards: { orderBy: () => ({ toArray: async () => board.cards }) },
        syncCursors: { get: async () => ({ tableName: 'shramsafal', lastSyncAt: '2026-10-26T03:30:00.000Z', version: 1 }) },
        appMeta: { get: async () => undefined },
    }),
}));
vi.mock('../../../../infrastructure/sync/BackgroundSyncWorker', () => ({ backgroundSyncWorker: { triggerNow: vi.fn().mockResolvedValue(undefined) } }));
vi.mock('../../../../infrastructure/api/apiFetch', () => ({ apiFetch: vi.fn() }));

import AttentionPage from '../AttentionPage';
import { publishApprovalQueue, resetApprovalQueueForTests } from '../../../approval/approvalQueue';
import { EMPTY_LABOUR_DATA } from '../../../labour/labourMock';

afterEach(() => { cleanup(); resetApprovalQueueForTests(); });

describe('लक्ष द्या — no approval shortcut (D-1)', () => {
    it('shows no approval chip and no approval item while records wait for his मंजूर', async () => {
        publishApprovalQueue('farm-1', {
            ...EMPTY_LABOUR_DATA,
            canConfirm: true,
            review: ['a', 'b', 'c'].map((id) => ({ id, who: 'w', initial: 'w', tone: 'or' as const, detail: '2026-10-30', status: 'Draft' as const, points: {} })),
        });
        render(<AttentionPage onGo={vi.fn()} />);
        await waitFor(() => expect(screen.getByTestId('attention-page')).toBeInTheDocument());
        expect(screen.queryByTestId(/approval/)).toBeNull();
        expect(document.body.textContent).not.toMatch(/मंजुरीसाठी|मंजूर करा|मंजुरी बाकी/);
        expect(screen.queryByText('वाद सोडवा')).toBeNull(); // disputes stay in मंजुरी too (D-1)
    });
});
