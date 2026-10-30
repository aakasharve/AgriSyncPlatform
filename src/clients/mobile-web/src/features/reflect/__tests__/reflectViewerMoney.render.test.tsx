// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane RF; review B001, B002, B004)
 *
 * The whole आढावा page, as a WORKER's phone and as the OWNER's phone see the same farm day — through the real row
 * path (`dayRecordings` → `withMoneyShown` → the feed row and the glance), the real ▶ gate (`useDayListen`), and the
 * real whole-farm panel:
 *   - B001: "he said it" is the signed-in session's user only. On a worker's phone (whose profile's active operator
 *     the sync set to the owner's id) the owner's records never read "तुम्ही", never show the owner's amounts, and
 *     never offer the owner's original voice on an older record;
 *   - B002: a row that only said "डिझेल 800 दिले" headlines as "खर्च" for him — no hidden amount on a row or glance;
 *   - B004: the whole-farm panel's money is the server ledger's whole-farm spend that day, for whoever may see money
 *     ("—" otherwise, and "—" when there is none — never रु. 0); deleted records are not counted; no record's own
 *     total appears anywhere on the page.
 * Only infrastructure edges are stand-ins: the ledger read, the clips on this phone, storage, telemetry.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';

vi.mock('../../../i18n/LanguageContext', async () => {
    const { t } = await import('../../../i18n/translations');
    const ctx = () => ({ language: 'mr', setLanguage: () => undefined, t: (k: string) => t(k, 'mr') });
    return { useLanguage: ctx, useOptionalLanguage: ctx };
});
vi.mock('../../../core/session/FarmContext', () => ({ useFarmContext: () => ({ currentFarmId: 'farm-1' }) }));
vi.mock('../../../shared/hooks/useUiPref', async () => {
    const { useState } = await import('react');
    return { useUiPref: <T,>(_key: string, fallback: T) => { const [v, set] = useState<T>(fallback); return [v, set, true] as const; } };
});
vi.mock('../../../services/harvestService', () => ({ getHarvestSessions: () => [], getOtherIncomeEntries: () => [] }));
vi.mock('../../attachments', () => ({ AttachmentList: () => null, useAttachmentRetry: () => ({ retryUpload: vi.fn() }) }));
vi.mock('../overview/useLogAttachmentCount', () => ({ useLogAttachmentCount: () => 0 }));
vi.mock('../../../core/telemetry/eventEmitters', () => ({ emitClosureSummaryViewed: vi.fn(), emitNextActionCreated: vi.fn() }));
vi.mock('../../finance/components/MoneyLensDrawer', () => ({ MoneyLensDrawer: () => null }));
const ledger = vi.hoisted(() => ({ entries: [] as unknown[] }));
vi.mock('../overview/useMoneyLedger', () => ({ useMoneyLedger: () => ({ entries: ledger.entries, gaps: [], complete: true }) }));
// No clip of these records is on this phone; ▶ is decided by the real `useDayListen` / `listenModel`.
vi.mock('../../logs/components/voiceResult/useClipPlayback', async importOriginal => ({
    ...(await importOriginal<typeof import('../../logs/components/voiceResult/useClipPlayback')>()),
    useLogClips: () => ({ clips: new Map(), ready: true }),
    useClipPlayback: () => ({ playingId: null, progress: 0, lengths: new Map(), heard: new Set(), toggle: vi.fn(), stop: vi.fn() }),
}));
vi.mock('../../../infrastructure/voice/logOriginalVoice', () => ({ fetchLogOriginalVoice: vi.fn() }));
vi.mock('../../../infrastructure/sync/PayloadValidator', () => ({ validatePayload: () => ({ ok: true }) }));

import ReflectPage from '../ReflectPage';
import { LogVerificationStatus, type DailyLog } from '../../../types';
import { CROPS, TODAY_KEY, farmLog, log, money } from './reflectFixtures';

const OWNER = 'owner-1';
const WORKER = 'worker-1';
const meta = (hhmm: string, who: string) => ({ createdAtISO: `2026-10-25T${hhmm}:00.000Z`, createdByOperatorId: who, farmId: 'farm-1' });

const history: DailyLog[] = [
    // The owner's "डिझेल 800 दिले", as the server sends it to a reader who may not hear his words (no transcript, no phrase).
    log({ id: 'dz', plotIds: ['g1'], meta: meta('04:00', OWNER), legacyPartial: false, activityExpenses: [{ id: 'x', reason: 'डिझेल', totalAmount: 800, items: [] }] } as Partial<DailyLog> & { id: string }),
    // An older record of the owner's, kept on the server only as task lines.
    log({ id: 'old', plotIds: ['g2'], meta: meta('03:00', OWNER), legacyPartial: true, cropActivities: [{ id: 'c', title: 'छाटणी' }] }),
    // Whole-farm records: their own totals (9,999) must appear nowhere; a deleted one is not work done.
    farmLog({ id: 'farm', meta: meta('05:00', OWNER), labour: [{ id: 'l', type: 'HIRED', count: 2 }], financialSummary: money(9999) }),
    farmLog({ id: 'farm-deleted', meta: meta('06:00', OWNER), cropActivities: [{ id: 'd', title: 'खुरपणी' }], financialSummary: money(5555), deletion: { deletedAtISO: '2026-10-25T07:00:00.000Z' } as DailyLog['deletion'] }),
];
const SPENT_WHOLE_FARM = { id: 'wf', dateKey: TODAY_KEY, direction: 'Expense', category: 'Fuel', amount: 800 };

const renderAs = (who: 'worker' | 'owner') => render(
    <ReflectPage history={history} crops={CROPS} tasks={[]} onUpdateTask={vi.fn()} onOpenLog={vi.fn()}
        sessionUserId={who === 'worker' ? WORKER : OWNER} farmRole={who === 'worker' ? 'Worker' : 'PrimaryOwner'}
        operators={[{ id: OWNER, name: 'मालक' }] as React.ComponentProps<typeof ReflectPage>['operators']} />,
);
const openFeed = () => fireEvent.click(screen.getByTestId('activity-feed-button'));

beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 25, 10, 0, 0));
    ledger.entries = [SPENT_WHOLE_FARM];
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('a WORKER\'s phone (review B001, B002)', () => {
    it('the owner\'s records are the owner\'s: never "तुम्ही", never his amounts — the diesel row headlines "खर्च"', () => {
        renderAs('worker');
        openFeed();
        const feed = screen.getByTestId('rf-feed');
        expect(screen.getByTestId('rf-feed-dz-who')).toHaveTextContent('मालक');
        expect(screen.getByTestId('rf-feed-dz-who')).toHaveAttribute('data-you', 'no');
        expect(screen.getByTestId('rf-feed-old-who')).toHaveTextContent('मालक');
        expect(feed).not.toHaveTextContent('तुम्ही');
        expect(screen.getByTestId('rf-feed-dz-work')).toHaveTextContent('खर्च');
        expect(feed.textContent).not.toContain('800');
        fireEvent.click(screen.getByTestId('rf-feed-dz-open'));
        expect(screen.getByTestId('rf-glance').textContent).not.toContain('800');
        expect(within(screen.getByTestId('rf-glance-dz-understood')).getByText('—')).toBeInTheDocument();
    });

    it('no server voice on the owner\'s older record (the server would refuse him)', () => {
        renderAs('worker');
        openFeed();
        fireEvent.click(screen.getByTestId('rf-feed-old-open'));
        expect(screen.queryByTestId('rf-glance-old-play-listen')).toBeNull();
        expect(screen.queryByTestId('ov-play-old')).toBeNull();
    });

    it('the whole-farm panel: "—" for money he may not see; the deleted record is not counted; no record\'s own total', () => {
        renderAs('worker');
        const panel = screen.getByTestId('farm-wide-today-panel');
        expect(panel).toHaveTextContent('रु. —');
        expect(screen.getByTestId('farm-wide-record-count')).toHaveTextContent('1');
        const page = document.body.textContent ?? '';
        for (const amount of ['800', '9,999', '9999', '5,555', '5555']) expect(page).not.toContain(amount);
    });
});

describe('the OWNER\'s phone, the same day', () => {
    it('his own records read "तुम्ही" with his amounts; his older record offers "मूळ आवाज ऐका"', () => {
        renderAs('owner');
        openFeed();
        expect(screen.getByTestId('rf-feed-dz-who')).toHaveTextContent('तुम्ही');
        expect(screen.getByTestId('rf-feed-dz-work')).toHaveTextContent('डिझेल · ₹800');
        fireEvent.click(screen.getByTestId('rf-feed-old-open'));
        expect(screen.getByTestId('rf-glance-old-play-listen')).toHaveAttribute('data-listen', 'server');
        expect(screen.getByTestId('ov-play-old')).toBeInTheDocument();
    });

    it('the whole-farm panel shows the LEDGER\'s whole-farm spend (800), never the records\' own totals', () => {
        renderAs('owner');
        const panel = screen.getByTestId('farm-wide-today-panel');
        expect(panel).toHaveTextContent('रु. 800');
        expect(screen.getByTestId('farm-wide-record-count')).toHaveTextContent('1');
        const page = document.body.textContent ?? '';
        for (const total of ['9,999', '9999', '5,555', '5555']) expect(page).not.toContain(total);
    });

    it('the verifier inbox shows no record\'s own money total either', () => {
        const pending = log({ id: 'pend', plotIds: ['g1'], meta: meta('08:00', OWNER), cropActivities: [{ id: 'p', title: 'छाटणी' }], financialSummary: money(7777),
            verification: { required: true, status: LogVerificationStatus.PENDING } } as Partial<DailyLog> & { id: string });
        render(<ReflectPage history={[...history, pending]} crops={CROPS} tasks={[]} onUpdateTask={vi.fn()} sessionUserId={OWNER} farmRole="PrimaryOwner"
            currentOperator={{ id: OWNER, name: 'मालक', isVerifier: true } as React.ComponentProps<typeof ReflectPage>['currentOperator']} />);
        expect(document.body.textContent).toContain('छाटणी'); // the inbox is there
        for (const total of ['7,777', '7777']) expect(document.body.textContent).not.toContain(total);
    });

    it('nothing spent at farm scope in the ledger: "—", never रु. 0', () => {
        ledger.entries = [];
        renderAs('owner');
        const panel = screen.getByTestId('farm-wide-today-panel');
        expect(panel).toHaveTextContent('रु. —');
        expect(panel.textContent).not.toContain('रु. 0');
    });
});
