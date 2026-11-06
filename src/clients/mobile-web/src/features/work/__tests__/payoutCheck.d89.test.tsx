// @vitest-environment jsdom
/**
 * spec: plr-d10 (I28, lane L4b fix round 1; CTO call D-89, founder D-33) — the job card's own money step. After D-33 a
 * मंजूर no longer makes a card ready to pay, so the card must say the truth ("काम मंजूर · पेआउट तपासा बाकी") and offer
 * "पेआउट तपासा" — wired to the server's verify-for-payout — only to a seat the server lets pass (the primary account
 * holder, or a seat holding ReviewMoney), only on a Completed card whose linked record is approved. A refusal is said
 * in his language by its code. A withdrawn payout check (a शंका or a correction) is said on the card (M-2).
 */
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const h = vi.hoisted(() => ({
    // The seat as /me/context sends it: its role label and the authorities it HOLDS (the phone reads doors from these).
    farm: { farmId: 'farm-1', role: 'PrimaryOwner', authorities: null as { name: string; expiresAtUtc: string | null }[] | null },
    cards: [] as unknown[],
    verify: vi.fn(),
    refresh: vi.fn(),
}));
vi.mock('../../../core/session/FarmContext', () => ({
    useFarmContext: () => ({ currentFarmId: 'farm-1', currentFarm: h.farm }),
}));
vi.mock('../hooks/useJobCards', () => ({
    useJobCards: () => ({
        jobCards: h.cards, isLoading: false, loadFailed: false,
        assignJobCard: vi.fn(), startJobCard: vi.fn(), settleJobCard: vi.fn(),
        verifyJobCardForPayout: (...a: unknown[]) => h.verify(...a),
        refresh: h.refresh,
    }),
}));

import JobCardsPage from '../pages/JobCardsPage';
import PayoutEligibilityStrip from '../components/PayoutEligibilityStrip';
import { JobCardRefusal } from '../data/jobCardsClient';
import type { JobCard } from '../../../domain/work/JobCard';

const completed = (over: Partial<JobCard> = {}): JobCard => ({
    id: 'card-0001', farmId: 'farm-1', plotId: 'p1', createdByUserId: 'u1', plannedDate: '2026-10-30', status: 'Completed',
    lineItems: [], estimatedTotalAmount: 500, estimatedTotalCurrency: 'INR', linkedDailyLogId: 'log-1',
    createdAtUtc: '2026-10-30T05:00:00Z', modifiedAtUtc: '2026-10-30T05:00:00Z', ...over,
} as JobCard);

afterEach(() => { cleanup(); h.verify.mockReset(); h.refresh.mockReset(); h.farm = { farmId: 'farm-1', role: 'PrimaryOwner', authorities: null }; });

describe('the strip on a Completed card tells the truth (D-33)', () => {
    it('says the work is approved and the payout check is pending once the record is approved', () => {
        render(<PayoutEligibilityStrip card={completed({ linkedDailyLogStatus: 'Verified' })} language="mr" />);
        expect(screen.getByTestId('payout-strip')).toHaveTextContent('काम मंजूर · पेआउट तपासा बाकी');
        expect(screen.getByTestId('payout-strip')).not.toHaveTextContent('नोंद तपासणीची प्रतीक्षा');
    });

    it('keeps "नोंद तपासणीची प्रतीक्षा" only while the record is not approved, and says a withdrawn check', () => {
        render(<PayoutEligibilityStrip card={completed({ linkedDailyLogStatus: 'Draft' })} language="mr" />);
        expect(screen.getByTestId('payout-strip')).toHaveTextContent('नोंद तपासणीची प्रतीक्षा');
        cleanup();
        render(<PayoutEligibilityStrip card={completed({ linkedDailyLogStatus: 'Disputed', payoutCheckWithdrawn: true })} language="mr" />);
        expect(screen.getByTestId('payout-strip')).toHaveTextContent('नोंदीवर शंका / दुरुस्ती — पेआउटची खात्री परत घेतली');
        cleanup();
        render(<PayoutEligibilityStrip card={completed({ linkedDailyLogStatus: 'Verified' })} language="en" />);
        expect(screen.getByTestId('payout-strip')).toHaveTextContent('Work approved · payout check pending');
        expect(screen.getByTestId('payout-strip').textContent).not.toMatch(/[ऀ-ॿ]/);
    });
});

describe('"पेआउट तपासा" is the real payout step, for the seats the server lets pass', () => {
    it('the primary account holder on an approved, Completed card: the tap verifies for payout and reads the list again', async () => {
        h.cards = [completed({ linkedDailyLogStatus: 'Verified' })];
        h.verify.mockResolvedValue('card-0001');
        render(<JobCardsPage />);
        fireEvent.click(screen.getByTestId('jobcard-action-verify-card-0001'));
        await waitFor(() => expect(h.verify).toHaveBeenCalledWith('card-0001'));
        await waitFor(() => expect(h.refresh).toHaveBeenCalled());
    });

    it('no button while the record is not approved, nor for a seat without ReviewMoney', () => {
        h.cards = [completed({ linkedDailyLogStatus: 'Draft' })];
        render(<JobCardsPage />);
        expect(screen.queryByTestId('jobcard-action-verify-card-0001')).toBeNull();
        cleanup();
        h.farm = { farmId: 'farm-1', role: 'Mukadam', authorities: [{ name: 'TakeAttendance', expiresAtUtc: null }] };
        h.cards = [completed({ linkedDailyLogStatus: 'Verified' })];
        render(<JobCardsPage />);
        expect(screen.queryByTestId('jobcard-action-verify-card-0001')).toBeNull();
        cleanup();
        h.farm = { farmId: 'farm-1', role: 'Mukadam', authorities: [{ name: 'TakeAttendance', expiresAtUtc: null }, { name: 'ReviewMoney', expiresAtUtc: null }] };
        render(<JobCardsPage />);
        expect(screen.getByTestId('jobcard-action-verify-card-0001')).toBeInTheDocument();
    });

    // lane L4b fix round 2 (L-e) — the server now sends the code in the 403's body, so the record-closed words can show.
    it.each([
        ['ShramSafal.RecordAudience.Forbidden', 'ही नोंद तुमच्यासाठी उघडी नाही'],
        ['ShramSafal.JobCardRoleNotAllowed', 'पेआउट तपासण्याची परवानगी तुम्हाला नाही'],
    ])('a 403 carrying %s reaches the card as its own words', async (code, words) => {
        h.cards = [completed({ linkedDailyLogStatus: 'Verified' })];
        h.verify.mockImplementation(async () => {
            const { verifyForPayout } = await vi.importActual<typeof import('../data/jobCardsClient')>('../data/jobCardsClient');
            const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: code, message: 'Forbidden.' }), { status: 403 }));
            vi.stubGlobal('fetch', fetchMock);
            try {
                return await verifyForPayout('card-0001');
            } finally {
                vi.unstubAllGlobals();
            }
        });
        render(<JobCardsPage />);
        fireEvent.click(screen.getByTestId('jobcard-action-verify-card-0001'));
        const said = await screen.findByTestId('jobcard-refusal');
        expect(said).toHaveTextContent(words);
        expect(said.textContent).not.toMatch(/Forbidden|403/);
    });

    it('a refusal is said in Marathi by its code, never the server English', async () => {
        h.cards = [completed({ linkedDailyLogStatus: 'Verified' })];
        h.verify.mockRejectedValue(new JobCardRefusal('ShramSafal.JobCardRoleNotAllowed', 403));
        render(<JobCardsPage />);
        fireEvent.click(screen.getByTestId('jobcard-action-verify-card-0001'));
        const said = await screen.findByTestId('jobcard-refusal');
        expect(said).toHaveTextContent('पेआउट तपासण्याची परवानगी तुम्हाला नाही');
        expect(said.textContent).not.toMatch(/JobCardRoleNotAllowed|refused|403/);
    });
});
