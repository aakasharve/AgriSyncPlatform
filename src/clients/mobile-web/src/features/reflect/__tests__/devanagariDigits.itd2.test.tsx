// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: dfes-input-truth-and-mix-check-2026-11-06 (lane IT-D2; founder D-123b, 2026-11-09) - the plot cards of पूर्ण शेतीचा आढावा
 * (IT5) and the plot's day view show every count and day number in Devanagari digits in Marathi mode ("आज ४ वेळा सांगितलं",
 * "दिवस २५", "जोडलेले फोटो २") and keep 0-9 in English mode. The whole page is rendered on real-shaped records.
 *
 * Fix round (review M2): the page now has a NON-empty ledger (the money chip and its spoken label), a non-zero attachment count and a weather
 * reading, so the card's money, "जोडलेल्या फाइल" count and temperature are in the scan; the scan covers every plot card, the farm card and
 * the day view header.
 *
 * Named exceptions on the same page (not changed by this lane; D-128 decides how far "everywhere" goes) - each is a test id below, and a
 * test proves each STILL holds a Latin digit, so the list stays true: see EXCEPTIONS.
 * Named inclusion (review M3): the product box inside the day view (`ProductBoxCard`, the IT4 component the result screen uses) IS
 * converted, while the rest of that day view (rows, time chips) is not - that mixed state is recorded, not hidden.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

vi.mock('../../../core/session/FarmContext', () => ({ useFarmContext: () => ({ currentFarmId: 'farm-1' }) }));
vi.mock('../../../shared/hooks/useUiPref', async () => {
    const { useState } = await import('react');
    return { useUiPref: <T,>(_key: string, fallback: T) => { const [v, set] = useState<T>(fallback); return [v, set, true] as const; } };
});
vi.mock('../../../services/harvestService', () => ({ getHarvestSessions: () => [], getOtherIncomeEntries: () => [] }));
vi.mock('../../attachments', () => ({ AttachmentList: () => null, useAttachmentRetry: () => ({ retryUpload: vi.fn() }) }));
const files = vi.hoisted(() => ({ n: 2 }));
vi.mock('../overview/useLogAttachmentCount', () => ({ useLogAttachmentCount: () => files.n }));
vi.mock('../../../core/telemetry/eventEmitters', () => ({ emitClosureSummaryViewed: vi.fn(), emitNextActionCreated: vi.fn() }));
vi.mock('../../logs/components/FarmWideTodayPanel', () => ({ default: () => null }));
vi.mock('../../finance/components/MoneyLensDrawer', () => ({ MoneyLensDrawer: () => null }));
// The server's ledger holds 1,800 spent on the plot that day (so the card's money chip is drawn) and a partial gap.
const ledger = vi.hoisted(() => ({ entries: [] as unknown[], gaps: [] as unknown[] }));
vi.mock('../overview/useMoneyLedger', () => ({ useMoneyLedger: () => ({ entries: ledger.entries, gaps: ledger.gaps, complete: true }) }));
vi.mock('../day/useDayListen', () => ({
    useDayListen: () => ({ kindOf: () => 'none', clipOf: () => undefined, playing: () => false, progress: 0, lengthOf: () => null, toggle: () => undefined, stop: () => undefined, farmOf: () => null }),
}));
vi.mock('../../../infrastructure/voice/logOriginalVoice', () => ({ fetchLogOriginalVoice: vi.fn() }));
vi.mock('../../../infrastructure/sync/PayloadValidator', () => ({ validatePayload: () => ({ ok: true }) }));
// The companion flag is ON for these tests; the flag-OFF test (the production default) turns it off for itself only.
const flags = vi.hoisted(() => ({ current: null as null | { understandingMeter: boolean } }));
vi.mock('../../../app/featureFlags', async (importActual) => {
    const actual = await importActual<typeof import('../../../app/featureFlags')>();
    const FEATURE_FLAGS = { ...actual.FEATURE_FLAGS, understandingMeter: true };
    flags.current = FEATURE_FLAGS;
    return { ...actual, FEATURE_FLAGS };
});
const getPlotDayUnderstanding = vi.hoisted(() => vi.fn());
vi.mock('../../../infrastructure/api/AgriSyncClient', () => ({ agriSyncClient: { getPlotDayUnderstanding: (...args: unknown[]) => getPlotDayUnderstanding(...args) } }));
const lang = vi.hoisted(() => ({ value: undefined as string | undefined }));
vi.mock('../../../i18n/LanguageContext', async (importActual) => ({
    ...(await importActual<typeof import('../../../i18n/LanguageContext')>()),
    useOptionalLanguage: () => (lang.value ? { language: lang.value } : null),
}));


import ReflectPage from '../ReflectPage';
import { reflectCopy } from '../reflectCopy';
import { latinDigitFindings } from '../../../shared/test/latinDigits';
import { crop, plot, log } from './reflectFixtures';

const ROWS = [
    { plotId: 'g1', score0to10: 7, understood: [{ mr: 'छाटणी', en: 'Pruning' }], nextHint: { mr: 'पिकात काय दिसलं ते', en: 'What you saw in the crop' } },
];

/** A plot with an area and a season day (started 24 days before the page's day). */
const CROPS = [crop('grape', 'द्राक्ष', 'Grapes', 'bg-purple-500', [
    plot('g1', 'सोनाका', { startDate: '2026-10-01', baseline: { totalArea: 2.5, unit: 'Acre' } } as never),
]), crop('cane', 'ऊस', 'Sugarcane', 'bg-emerald-500', [plot('c1', 'ऊस')])];

/** Every kind of count the card prints: people, hours, litres, a dose, how many times told. */
const history = [
    log({
        id: 'g1-me', plotIds: ['g1'], cropActivities: [{ id: 'a', title: 'छाटणी' }],
        weatherSnapshot: { fetchedAt: '2026-10-25T04:00:00.000Z', lat: 0, lon: 0, provider: 'test', current: { tempC: 28.5, humidity: 60, windKph: 5, precipMm: 0, conditionText: 'ऊन', iconCode: 'sun' } } as never,
        labour: [{ id: 'l', count: 4, maleCount: 3, femaleCount: 2, wagePerPerson: 400, totalCost: 1600 }] as never,
        irrigation: [{ id: 'i', durationHours: 2, waterVolumeLitres: 600 }] as never,
        meta: { createdAtISO: '2026-10-25T03:40:00.000Z', createdByOperatorId: 'me' },
    }),
    log({
        id: 'g1-sunil', plotIds: ['g1'], inputs: [{ id: 'ev', method: 'Spray', mix: [{ id: 'm', productName: 'कॉन्फिडॉर', dose: 250, unit: 'ml' }] }] as never,
        meta: { createdAtISO: '2026-10-25T04:40:00.000Z', createdByOperatorId: 'op-sunil' },
    }),
];

beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 25, 10, 0, 0));
    lang.value = undefined;
    files.n = 2;
    ledger.entries = [{ id: 'e1', plotId: 'g1', dateKey: '2026-10-25', direction: 'Expense', category: 'Labour', amount: 1800 }];
    ledger.gaps = [];
    getPlotDayUnderstanding.mockReset();
    getPlotDayUnderstanding.mockResolvedValue(ROWS);
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

const renderPage = () => {
    render(<ReflectPage history={history} crops={CROPS} tasks={[]} onUpdateTask={vi.fn()} navigate={vi.fn()} onOpenLog={vi.fn()} onSpeak={vi.fn()}
        sessionUserId="me" ownName="प्रकाश" farmRole="PrimaryOwner"
        operators={[{ id: 'op-sunil', name: 'सुनील' }] as React.ComponentProps<typeof ReflectPage>['operators']} />);
};

/**
 * EXCEPTIONS - on the same page, not changed by this lane (D-128). Each is a test id (or prefix) and WHY it keeps its digits:
 *   day-label, day-quick-*            the page's day chips ("25 ऑक्टो"): the shared reflect date formatter
 *   farm-crop-*, activity-feed-count  the page's own crop / recording counters
 *   vr-day-*                          the day view's rows (`DayParts`, shared with the check and correction screens)
 *   rf-time-*                         the day view's time chips (`formatFarmerLogTime`, the app's fixed Marathi time words)
 */
const EXCEPTIONS = ['day-label', 'day-quick-0', 'activity-feed-count', 'farm-crop-all', 'vr-day-head-labour', 'rf-time-g1-me'];

describe('IT-D2 - पूर्ण शेतीचा आढावा: the plot card in Marathi mode', () => {
    it('every plot card and the day view header hold no Latin digit', async () => {
        lang.value = 'mr';
        renderPage();
        await waitFor(() => expect(screen.getByTestId('plot-hint-grape:g1')).toBeInTheDocument());
        const card = screen.getByTestId('plot-card-grape:g1');
        // The numbers really are on the card: the area and the season day, a chip's headcount and litres, how many times told.
        expect(card).toHaveTextContent('२.५ एकर · दिवस २५');
        expect(card).toHaveTextContent('४ जण · ३ पुरुष · २ महिला');
        expect(card).toHaveTextContent('२ तास · ६०० लिटर');
        expect(screen.getByTestId('plot-times-grape:g1')).toHaveTextContent('आज २ वेळा सांगितलं');
        // The money chip, its spoken label, the file count with its label and the temperature are on the card (and in the scan).
        expect(screen.getByTestId('plot-money-grape:g1')).toHaveTextContent('₹ १,८००');
        expect(screen.getByTestId('plot-money-grape:g1').getAttribute('aria-label')).toContain('₹ १,८००');
        expect(screen.getByTestId('plot-files-grape:g1').getAttribute('aria-label')).toBe('जोडलेल्या फाइल २');
        expect(card).toHaveTextContent('२८.५°C');
        const cards = screen.getAllByTestId(/^plot-card-/);
        expect(cards.length).toBeGreaterThan(0);
        expect(cards.flatMap(c => latinDigitFindings(c))).toEqual([]);
        fireEvent.click(card);
        expect(screen.getByTestId('rf-day-date')).toHaveTextContent('आज · दिवस २५');
        expect(latinDigitFindings(screen.getByTestId('rf-day-date'))).toEqual([]);
        // Review M3: the product box of the day view is the IT4 component and shows the dose in Devanagari digits ...
        const box = document.querySelector('[data-testid^="vr-product-box-"]');
        expect(box?.textContent ?? '').toContain('२५० मिली');
        // ... while the rest of this day view (a labour row) is D-128 territory and keeps what it had.
        expect(screen.getByTestId('vr-day-head-labour').textContent).toMatch(/4 जण/);
    });

    it('the words of reflectCopy: no count or day number in Marathi mode, for any number', () => {
        const mr = reflectCopy('mr');
        for (const n of [0, 1, 2, 9, 10, 25, 100, 1234]) {
            for (const text of [mr.timesTold(n, true), mr.timesTold(n, false), mr.seasonDay(n), mr.photos(n)]) expect(text, String(n)).not.toMatch(/[0-9]/);
        }
        expect(mr.timesTold(4, true)).toBe('आज ४ वेळा सांगितलं');
        expect(mr.timesTold(4, false)).toBe('४ वेळा सांगितलं');
        expect(mr.seasonDay(25)).toBe('दिवस २५');
        expect(mr.photos(12)).toBe('जोडलेले फोटो १२');
    });
});

describe('IT-D2 - पूर्ण शेतीचा आढावा: display only', () => {
    it('rendering the page leaves the records and the ledger exactly as they were (the amounts are still the numbers they were)', async () => {
        lang.value = 'mr';
        const before = structuredClone({ history, ledger: ledger.entries });
        renderPage();
        await waitFor(() => expect(screen.getByTestId('plot-hint-grape:g1')).toBeInTheDocument());
        fireEvent.click(screen.getByTestId('plot-card-grape:g1'));
        expect({ history, ledger: ledger.entries }).toEqual(before);
        expect(JSON.stringify(ledger.entries)).toContain('"amount":1800');
    });
});

describe('IT-D2 - पूर्ण शेतीचा आढावा: English mode keeps 0-9', () => {
    it('the same card in English: Told 2 times today, and the numbers he said, in Latin digits', async () => {
        lang.value = 'en';
        renderPage();
        await waitFor(() => expect(screen.getByTestId('plot-card-grape:g1')).toBeInTheDocument());
        expect(screen.getByTestId('plot-times-grape:g1')).toHaveTextContent('Told 2 times today');
        expect(screen.getByTestId('plot-card-grape:g1')).toHaveTextContent('4 people');
        expect(screen.getByTestId('plot-card-grape:g1')).toHaveTextContent('2 hours');
        expect(screen.getByTestId('plot-card-grape:g1')).not.toHaveTextContent(/[०-९]/);
        const en = reflectCopy('en');
        expect(en.seasonDay(25)).toBe('Day 25');
        expect(en.photos(3)).toBe('Photos attached 3');
        // English keeps 0-9 on the money chip, the file count's label and the temperature too.
        expect(screen.getByTestId('plot-money-grape:g1')).toHaveTextContent('₹ 1,800');
        expect(screen.getByTestId('plot-files-grape:g1').getAttribute('aria-label')).toBe('जोडलेल्या फाइल 2');
        expect(screen.getByTestId('plot-card-grape:g1')).toHaveTextContent('28.5°C');
    });
});

describe('IT-D2 - what this lane leaves on the same page is named, and still true', () => {
    it('each named exception still holds a Latin digit (when one is fixed, retire it from EXCEPTIONS and from the header)', async () => {
        lang.value = 'mr';
        renderPage();
        await waitFor(() => expect(screen.getByTestId('plot-hint-grape:g1')).toBeInTheDocument());
        fireEvent.click(screen.getByTestId('plot-card-grape:g1'));
        for (const id of EXCEPTIONS) {
            const el = within(document.body).getAllByTestId(id)[0];
            expect(latinDigitFindings(el), id).not.toEqual([]);
        }
    });
});
