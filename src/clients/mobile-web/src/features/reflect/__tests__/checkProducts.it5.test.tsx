// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: dfes-input-truth-and-mix-check-2026-11-06 (lane IT5, Task 2b; founder D-95; preview DFES-owner-check-scenario, phone 2) -
 * "औषधं तपासा (N)" on a recording inside an आढावा plot card: only for a person who holds the confirm-records authority (by the
 * server's list, never the label), only on a record someone else made that still waits for review, and it opens the one review sheet
 * on THAT record. It blocks nothing and adds no second place to approve.
 *
 * The whole page is rendered on real-shaped records; only the infrastructure edges are mocked (farm context, the ledger read, the
 * clip player, attachment counts, telemetry).
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const farm = vi.hoisted(() => ({ current: null as unknown }));
vi.mock('../../../core/session/FarmContext', () => ({ useFarmContext: () => ({ currentFarmId: 'farm-1', currentFarm: farm.current }) }));
vi.mock('../../../shared/hooks/useUiPref', async () => {
    const { useState } = await import('react');
    return { useUiPref: <T,>(_key: string, fallback: T) => { const [v, set] = useState<T>(fallback); return [v, set, true] as const; } };
});
vi.mock('../../../services/harvestService', () => ({ getHarvestSessions: () => [], getOtherIncomeEntries: () => [] }));
vi.mock('../../attachments', () => ({ AttachmentList: () => null, useAttachmentRetry: () => ({ retryUpload: vi.fn() }) }));
vi.mock('../overview/useLogAttachmentCount', () => ({ useLogAttachmentCount: () => 0 }));
vi.mock('../../../core/telemetry/eventEmitters', () => ({ emitClosureSummaryViewed: vi.fn(), emitNextActionCreated: vi.fn() }));
vi.mock('../../logs/components/FarmWideTodayPanel', () => ({ default: () => null }));
vi.mock('../../finance/components/MoneyLensDrawer', () => ({ MoneyLensDrawer: () => null }));
vi.mock('../overview/useMoneyLedger', () => ({ useMoneyLedger: () => ({ entries: [], gaps: [], complete: true }) }));
vi.mock('../day/useDayListen', () => ({
    useDayListen: () => ({ kindOf: () => 'none', clipOf: () => undefined, playing: () => false, progress: 0, lengthOf: () => null, toggle: () => undefined, stop: () => undefined, farmOf: () => null }),
}));
vi.mock('../../../infrastructure/voice/logOriginalVoice', () => ({ fetchLogOriginalVoice: vi.fn() }));
vi.mock('../../../infrastructure/sync/PayloadValidator', () => ({ validatePayload: () => ({ ok: true }) }));

import ReflectPage from '../ReflectPage';
import { productsToCheckOf } from '../day/CheckProducts';
import { takeApprovalFocus } from '../../approval/approvalQueue';
import { OPEN_REVIEW_INBOX_EVENT } from '../../oversight/oversightNavigationEvents';
import { clearAuthSession, setAuthSession } from '../../../infrastructure/storage/AuthTokenStore';
import { LogVerificationStatus, type DailyLog } from '../../../types';
import { CROPS, TODAY_KEY, log } from './reflectFixtures';

const ME = 'a1a1a1a1-0000-4000-8000-000000000001';
const SUNIL = 'b2b2b2b2-0000-4000-8000-000000000002';

const SPRAY = {
    id: 'ev-spray', method: 'Spray',
    mix: [{ id: 'm-conf', productName: 'कॉन्फिडॉर', dose: 1, unit: 'ml' }, { id: 'm-prem', productName: 'प्रेम गोल्ड' }],
};
const sunilsSpray = (over: Partial<DailyLog> = {}): DailyLog => log({
    id: 'g1-sunil', plotIds: ['g1'], inputs: [SPRAY] as never,
    verification: { status: LogVerificationStatus.DRAFT, required: true },
    meta: { createdAtISO: '2026-10-25T04:00:00.000Z', createdByOperatorId: SUNIL },
    ...over,
});
const checked = (): DailyLog['inputIdentities'] => [0, 1].map(i => ({
    assertionId: `a${i}`, inputEventId: 'ev-spray', mixIndex: i, verdict: 'confirmed' as const, catalogVersion: 'v', assertedByUserId: ME, assertedAtUtc: '2026-10-25T05:00:00.000Z', isCheck: true,
}));

const owner = { role: 'PrimaryOwner', authorities: [{ name: 'ConfirmRecords' }, { name: 'SeeMoney' }] };
const trusted = { role: 'CoOwner', authorities: [{ name: 'ConfirmRecords' }] };

beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 25, 10, 0, 0));
    farm.current = owner;
    setAuthSession({ userId: ME, accessToken: 't', expiresAtUtc: new Date(Date.now() + 3_600_000).toISOString() });
    takeApprovalFocus(); // nothing left from an earlier test
});
afterEach(() => { cleanup(); vi.useRealTimers(); clearAuthSession(); });

const renderPage = (history: DailyLog[]) => {
    render(<ReflectPage history={history} crops={CROPS} tasks={[]} onUpdateTask={vi.fn()} onOpenLog={vi.fn()} onSpeak={vi.fn()} navigate={vi.fn()} sessionUserId={ME} ownName="प्रकाश" farmRole="PrimaryOwner"
        operators={[{ id: SUNIL, name: 'सुनील' }] as React.ComponentProps<typeof ReflectPage>['operators']} />);
};
const openRecording = (logId = 'g1-sunil') => {
    fireEvent.click(screen.getByTestId('plot-card-grape:g1'));
    fireEvent.click(screen.getByTestId(`rf-time-${logId}`));
};
const buttonId = 'rf-rec-g1-sunil-check';

describe('आढावा - "औषधं तपासा" on a recording (IT5 Task 2b)', () => {
    it('PlotRecording_ShowsCheckButton_OnlyForConfirmRecords: the authority decides, by the server\'s list - not the label, not a guess', () => {
        // holds ConfirmRecords: the button, with how many are left to check
        renderPage([sunilsSpray()]);
        openRecording();
        expect(screen.getByTestId(buttonId)).toHaveTextContent('औषधं तपासा (२)');
        cleanup();

        // a seat the server did NOT give the authority: nothing, whatever it is called
        for (const seat of [
            { role: 'CoOwner', authorities: [{ name: 'TakeAttendance' }, { name: 'SeeMoney' }] },
            { role: 'Worker', authorities: [] },
            { role: 'Worker' }, // the server sent no list: fails closed - only the primary account holder keeps the door
            null,
        ]) {
            farm.current = seat;
            renderPage([sunilsSpray()]);
            openRecording();
            expect(screen.queryByTestId(buttonId)).toBeNull();
            expect(screen.queryByTestId('rf-rec-g1-sunil-checked')).toBeNull();
            cleanup();
        }

        // the primary account holder with no list sent: he holds every authority (D-26)
        farm.current = { role: 'PrimaryOwner' };
        renderPage([sunilsSpray()]);
        openRecording();
        expect(screen.getByTestId(buttonId)).toBeInTheDocument();
    });

    it('PlotRecording_ShowsCheckButton_OnlyForConfirmRecords: only a record someone ELSE made, still waiting for review, that names a product', () => {
        const expectNone = (history: DailyLog[], recId: string) => {
            renderPage(history);
            openRecording(recId);
            expect(screen.queryByTestId(`rf-rec-${recId}-check`)).toBeNull();
            expect(screen.queryByTestId(`rf-rec-${recId}-checked`)).toBeNull();
            cleanup();
        };
        // his own record: he cannot be its checker
        expectNone([sunilsSpray({ id: 'g1-sunil', meta: { createdAtISO: '2026-10-25T04:00:00.000Z', createdByOperatorId: ME } })], 'g1-sunil');
        // already approved, or doubted: it is not in the review list any more
        expectNone([sunilsSpray({ verification: { status: LogVerificationStatus.VERIFIED, required: true } })], 'g1-sunil');
        expectNone([sunilsSpray({ verification: { status: LogVerificationStatus.DISPUTED, required: true } })], 'g1-sunil');
        // no product in it: nothing to check
        expectNone([sunilsSpray({ inputs: [] })], 'g1-sunil');
    });

    it('PlotRecording_ShowsCheckButton_OnlyForConfirmRecords: when every product is checked the recording says so, with no button', () => {
        renderPage([sunilsSpray({ inputIdentities: checked() })]);
        openRecording();
        expect(screen.queryByTestId(buttonId)).toBeNull();
        expect(screen.getByTestId('rf-rec-g1-sunil-checked')).toHaveTextContent('औषधं तपासली');
    });

    it('CheckButton_OpensReviewFocusedOnThatRecord: it opens the one review sheet with THAT record first - and nothing else happens', () => {
        const opened = vi.fn();
        window.addEventListener(OPEN_REVIEW_INBOX_EVENT, opened);
        try {
            renderPage([sunilsSpray()]);
            openRecording();
            expect(opened).not.toHaveBeenCalled();
            fireEvent.click(screen.getByTestId(buttonId));
            expect(opened).toHaveBeenCalledTimes(1); // the existing door (`openApprovalReview`), not a new place to approve
            expect(takeApprovalFocus()).toBe('g1-sunil'); // the record the sheet puts first
        } finally {
            window.removeEventListener(OPEN_REVIEW_INBOX_EVENT, opened);
        }
    });

    it('CheckButton_OpensReviewFocusedOnThatRecord: a recording that named two plots opens on the record that still has products to check', () => {
        const checkedFirst = sunilsSpray({ id: 'g1-a', inputIdentities: checked() });
        const toCheck = sunilsSpray({ id: 'g1-b' });
        expect(productsToCheckOf([checkedFirst, toCheck], ME)).toEqual({ unchecked: 2, total: 4, focusLogId: 'g1-b' });
        expect(productsToCheckOf([checkedFirst], ME)).toEqual({ unchecked: 0, total: 2, focusLogId: null });
        expect(productsToCheckOf([toCheck], null)).toEqual({ unchecked: 0, total: 0, focusLogId: null }); // nobody signed in: no checker
    });

    it('TrustedPerson_SameScreens_AsOwner: a trusted person who holds the authority is offered exactly what the owner is', () => {
        farm.current = owner;
        renderPage([sunilsSpray()]);
        openRecording();
        const asOwner = screen.getByTestId('rf-rec-g1-sunil').innerHTML;
        expect(screen.getByTestId(buttonId)).toHaveTextContent('औषधं तपासा (२)');
        cleanup();

        farm.current = trusted;
        renderPage([sunilsSpray()]);
        openRecording();
        expect(screen.getByTestId('rf-rec-g1-sunil').innerHTML).toBe(asOwner);
        fireEvent.click(screen.getByTestId(buttonId));
        expect(takeApprovalFocus()).toBe('g1-sunil');
    });

    it('the day\'s chosen date is not changed and no recording is edited by the button (P7)', () => {
        const history = [sunilsSpray()];
        const before = JSON.stringify(history);
        renderPage(history);
        openRecording();
        fireEvent.click(screen.getByTestId(buttonId));
        expect(JSON.stringify(history)).toBe(before);
        expect(TODAY_KEY).toBe('2026-10-25');
    });
});
