// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: dfes-input-truth-and-mix-check-2026-11-06 (lane IT-D2; founder D-123b, 2026-11-09) - on the result screen (IT4) every number
 * is shown in Devanagari digits (०-९) in Marathi mode, and keeps 0-9 in English mode. The REAL container over a real Dexie, with
 * data that makes every number appear: the meter, the "how many times today" count, a past day, a time, hours, litres, a headcount,
 * rupees, doses (recorded and spoken), a percentage, the clip length. Display only: what is stored is never touched.
 *
 * The scan is EVERY text node and every spoken label of the whole screen. What it lets through is named below, and why:
 *   - a name exactly as it was recorded ("19:19:19" is the fertiliser's grade, written as the product's own name);
 *   - the cited publication's title (English, shown as published, with its own number).
 * His own words (the transcript) are quoted as he said them and are written without a digit here.
 */
import 'fake-indexeddb/auto';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const { lng, flags } = vi.hoisted(() => ({ lng: { v: 'mr' as 'mr' | 'en' }, flags: { understandingMeter: true } }));
vi.mock('../../../../../app/featureFlags', async (orig) => {
    const real = await orig<typeof import('../../../../../app/featureFlags')>();
    return { ...real, FEATURE_FLAGS: new Proxy(real.FEATURE_FLAGS, { get: (t, k) => (k in flags ? flags[k as keyof typeof flags] : t[k as keyof typeof t]) }) };
});
vi.mock('../../../hooks/useDayUnderstanding', () => ({
    useDayUnderstanding: () => ({ score: 7, classification: null, refresh: vi.fn(async () => undefined), isLoading: false, error: null }),
}));
vi.mock('../../../hooks/usePlotDayUnderstanding', () => ({
    usePlotDayUnderstanding: () => ({ score: 7, refresh: vi.fn(async () => undefined) }),
}));
vi.mock('../../../../../infrastructure/sync/BackgroundSyncWorker', () => ({
    backgroundSyncWorker: { triggerNow: vi.fn(async () => undefined), start: vi.fn(), stop: vi.fn() },
}));
vi.mock('../../../../../app/providers/DataSourceProvider', () => ({
    useDataSource: () => ({ dataSource: { logs: {} }, auditPort: { append: vi.fn(async () => undefined) } }),
}));
vi.mock('../../../../../i18n/LanguageContext', async () => {
    const { t } = await import('../../../../../i18n/translations');
    const ctx = () => ({ language: lng.v, setLanguage: () => undefined, t: (k: string) => t(k, lng.v) });
    return { useLanguage: ctx, useOptionalLanguage: ctx };
});
vi.mock('../../../../../core/domain/services/DateKeyService', async (orig) => {
    const actual = await orig<typeof import('../../../../../core/domain/services/DateKeyService')>();
    return { ...actual, getDateKey: (t?: Date | string) => (t === undefined ? '2026-10-26' : actual.getDateKey(t)) };
});
vi.mock('../../../../../infrastructure/voice/VoiceClipRetention', async (orig) => ({
    ...(await orig<typeof import('../../../../../infrastructure/voice/VoiceClipRetention')>()),
    readVoiceClipPlaintext: vi.fn(async () => new Uint8Array([1, 2, 3]).buffer),
}));
vi.mock('../../../../../core/session/FarmContext', () => ({ useOptionalFarmContext: () => null }));

import referenceRules from '../../../../../../../../../sync-contract/reference/inputs/mix-rules.json';
import { getDatabase, resetDatabase } from '../../../../../infrastructure/storage/DexieDatabase';
import type { VoiceClipCacheRecord } from '../../../../../infrastructure/storage/DexieDatabase';
import { clearAuthSession, setAuthSession } from '../../../../../infrastructure/storage/AuthTokenStore';
import type { MixRule } from '../../../../../domain/inputs/mixRules';
import { LogVerificationStatus, type DailyLog, type FarmerProfile } from '../../../../../types';
import { latinDigitFindings } from '../../../../../shared/test/latinDigits';
import { VoiceResultContainer, type VoiceResultContainerProps } from '../VoiceResultContainer';
import { TodayActivityClipsSheet } from '../ClipGlance';
import ProductCard, { type ProductAnswerKit } from '../ProductCard';
import { productBoxesOf } from '../productModel';
import { resultCopy } from '../resultCopy';
import { buildFeedEntries } from '../../../../../core/navigation/activityFeedEntries';
import { forgetPlayedReveals } from '../RingStage';

const ME = 'a1a1a1a1-0000-4000-8000-000000000001';
const RAMESH = 'b2b2b2b2-0000-4000-8000-000000000002';
const NOW = 'c3c3c3c3-0000-4000-8000-000000000003';
const EARLIER = 'd4d4d4d4-0000-4000-8000-000000000004';
const FARM = 'f0f0f0f0-0000-4000-8000-0000000000f1';
const REVIEWED: MixRule[] = (referenceRules as { rules: MixRule[] }).rules.map(r => ({ ...r, reviewedBy: 'test-fixture', reviewedOn: '2026-11-06' }));

/** NOT numbers the app printed - see the header. */
const NOT_NUMBERS = [
    '19:19:19', // a fertiliser grade written as the product's own name (he said it, the record keeps it as the product's name)
    'Agro Dosage Guide (English), 309 pp., founder copy', // never shown; here so a source title can never trip the scan
];
const SOURCE_TITLES = (referenceRules as { rules: Array<{ sources: Array<{ title: string }> }> }).rules.flatMap(r => r.sources.map(s => s.title));
const ALLOWED = [...NOT_NUMBERS, ...SOURCE_TITLES];

const spray = {
    id: 'ev-spray', method: 'Spray', sourceText: 'कॉन्फिडॉर आणि प्रेम गोल्ड फवारलं',
    mix: [
        { id: 'm-conf', productName: 'कॉन्फिडॉर', dose: 250, unit: 'ml' },
        { id: 'm-prem', productName: 'प्रेम गोल्ड', dose: 1.5, unit: 'kg', basisQty: 1, basisUnit: 'L' },
    ],
};
const drip = {
    id: 'ev-drip', method: 'Drip', sourceText: 'कॅल्शियम नायट्रेट आणि एकोणीस एकोणीस एकोणीस ठिबकने',
    mix: [
        { id: 'd-can', productName: 'कॅल्शियम नायट्रेट', dose: 2, unit: 'kg', numbers: { dose: { certainty: 'reported', quantity: 2, unit: 'kg', spokenText: '2 किलो' } } },
        { id: 'd-npk', productName: '19:19:19', npkGrade: '19:19:19', dose: 3, unit: 'kg' },
    ],
};
const SAID = 'कॉन्फिडॉर आणि प्रेम गोल्ड फवारलं, कॅल्शियम नायट्रेट आणि एकोणीस एकोणीस एकोणीस ठिबकने, दोन तास पाणी दिलं, चार मजूर आले';

const log = (id: string, over: Record<string, unknown>): DailyLog => ({
    id, date: '2026-10-26', dayOutcome: 'WORK_RECORDED',
    context: { selection: [{ cropId: 'c1', cropName: 'द्राक्ष', selectedPlotIds: ['plot-1'], selectedPlotNames: ['प्लॉट १'] }] },
    cropActivities: [], irrigation: [], labour: [], inputs: [], machinery: [],
    verification: { status: LogVerificationStatus.DRAFT, required: true },
    meta: { createdAtISO: '2026-10-26T10:00:00.000Z', createdByOperatorId: ME, farmId: FARM },
    ...over,
}) as unknown as DailyLog;

/** Every kind of number the screen prints, in one recording. */
const fullLog = (over: Record<string, unknown> = {}) => log(NOW, {
    fullTranscript: SAID,
    inputs: [{ ...spray, cost: 120 }, drip],
    irrigation: [
        { id: 'irr', durationHours: 2, waterVolumeLitres: 600, sourceText: 'दोन तास पाणी' },
        { id: 'irr-tank', role: 'spray-carrier', waterVolumeLitres: 500, durationHours: 1 },
    ],
    labour: [{ id: 'lab', count: 4, maleCount: 3, femaleCount: 2, wagePerPerson: 400, totalCost: 1600, sourceText: 'चार मजूर आले' }],
    machinery: [{ id: 'mac', type: 'tractor', ownership: 'rented', hoursUsed: 3, rentalCost: 1500, fuelCost: 200 }],
    activityExpenses: [{ id: 'exp', reason: 'डिझेल', totalAmount: 750 }],
    manualTotalCost: 5000,
    ...over,
});
const earlierLog = (over: Record<string, unknown> = {}) => log(EARLIER, {
    fullTranscript: 'सकाळी छाटणी केली',
    cropActivities: [{ id: 'crop-m', title: 'छाटणी', sourceText: 'छाटणी केली' }],
    labour: [{ id: 'lab-e', count: 2, sourceText: 'दोन मजूर' }],
    meta: { createdAtISO: '2026-10-26T03:30:00.000Z', createdByOperatorId: RAMESH, farmId: FARM },
    ...over,
});

const clipRow = (id: string, dailyLogId: string): VoiceClipCacheRecord => ({
    id, dailyLogId, farmId: 'farm-1', plotId: 'plot-1', recordedAtUtc: '2026-10-26T10:00:00.000Z', durationMs: 4000,
    mimeType: 'audio/webm', sizeBytes: 3, ciphertext: new Uint8Array([1]).buffer, iv: new Uint8Array([1]), wrappedDekId: 'dek',
    status: 'parsed', retentionPolicy: 'processing_30d', expiresAtUtc: '2026-11-25T00:00:00.000Z', createdAt: 'T', updatedAt: 'T',
} as unknown as VoiceClipCacheRecord);

const props = (history: DailyLog[], over: Partial<VoiceResultContainerProps> = {}): VoiceResultContainerProps => ({
    result: { logIds: [NOW], clipId: 'clip-now', key: 'clip-now|T', unclear: [] },
    history,
    farmerProfile: { name: 'सुनील', activeOperatorId: ME, operators: [] } as unknown as FarmerProfile,
    operatorNameById: new Map([[RAMESH, 'रमेश']]),
    farmId: FARM, farmRole: 'PrimaryOwner', placeLabel: 'द्राक्ष · प्लॉट १',
    syncQueuedById: new Map([[NOW, true]]),
    onEdit: vi.fn(), onBack: vi.fn(), onAddAnother: vi.fn(), mixRules: REVIEWED, ...over,
});

beforeEach(async () => {
    flags.understandingMeter = true;
    forgetPlayedReveals();
    try { await getDatabase().delete(); } catch { /* first run */ }
    await resetDatabase();
    await getDatabase().voiceClips.put(clipRow('clip-now', NOW));
    await getDatabase().voiceClips.put(clipRow('clip-earlier', EARLIER));
    setAuthSession({ userId: ME, accessToken: 't', expiresAtUtc: new Date(Date.now() + 3_600_000).toISOString() });
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:clip'), revokeObjectURL: vi.fn() }));
});
afterEach(() => { cleanup(); clearAuthSession(); lng.v = 'mr'; });

/** Open everything a farmer can open on the screen: every day line, the product card, his words, every earlier recording. */
async function openEverything(): Promise<void> {
    await screen.findByTestId('vr-lines');
    for (const row of screen.getAllByTestId(/^vr-line-row-/)) fireEvent.click(row);
    fireEvent.click(screen.getByTestId('vr-words-toggle'));
    for (const d of Array.from(document.querySelectorAll('details'))) d.setAttribute('open', '');
    await waitFor(() => expect(screen.getAllByTestId(/^vr-prow-/).length).toBeGreaterThan(0));
    // The clips of this phone: the big player and the earlier recording's player (the clip length is a number on the screen).
    await waitFor(() => expect(screen.getByTestId('vr-play')).toBeTruthy());
    await waitFor(() => expect(screen.getByTestId(`vr-earlier-play-${EARLIER}`)).toBeTruthy());
}

describe('IT-D2 - the result screen in Marathi mode shows no Latin digit', () => {
    it('today, with an earlier recording: the whole screen, every line open, the product card open', async () => {
        lng.v = 'mr';
        render(<VoiceResultContainer {...props([fullLog(), earlierLog()])} />);
        await openEverything();
        // The numbers really are on the screen (the scan must have something to scan): the meter, the count and a recorded dose.
        expect(screen.getByTestId('vr-ring-message').textContent).toMatch(/[०-९]/);
        expect(screen.getByTestId('vr-ring').textContent).toMatch(/७.*१०/); // the meter: the score of 10, "७ / १०"
        expect(screen.getByTestId('vr-mix-banner')).toBeTruthy(); // the red tank (calcium with 19:19:19) is on the screen: the banner and the box are scanned
        expect(screen.getByTestId('vr-count').textContent).toBe('आज २ वेळा सांगितलं');
        expect(screen.getByTestId('vr-prow-m-conf').textContent).toContain('२५० मिली');
        expect(screen.getByTestId('vr-prow-m-prem').textContent).toContain('१.५ किलो');
        expect(screen.getByTestId('vr-prow-d-can').textContent).toContain('२ किलो');
        fireEvent.click(screen.getByTestId('vr-prow-m-conf'));
        expect(screen.getByTestId('vr-product-card')).toBeTruthy();
        expect(latinDigitFindings(screen.getByTestId('voice-result'), ALLOWED)).toEqual([]);
    });

    it('a past day: the day chip, the day count line and the time of the recording', async () => {
        lng.v = 'mr';
        const past = fullLog({ date: '2026-10-20', meta: { createdAtISO: '2026-10-20T10:00:00.000Z', createdByOperatorId: ME, farmId: FARM } });
        const pastEarlier = earlierLog({ date: '2026-10-20', meta: { createdAtISO: '2026-10-20T03:30:00.000Z', createdByOperatorId: RAMESH, farmId: FARM } });
        render(<VoiceResultContainer {...props([past, pastEarlier])} />);
        await openEverything();
        expect(screen.getByTestId('vr-day').textContent).toContain('२० ऑक्टो');
        expect(screen.getByTestId('vr-count').textContent).toContain('२');
        expect(latinDigitFindings(screen.getByTestId('voice-result'), ALLOWED)).toEqual([]);
    });
});

describe('IT-D2 - the hero line of a past day, with the meter off', () => {
    it('Marathi: "<date> च्या कामाबद्दल साथीला ..." names the day in Devanagari digits; English keeps 0-9', async () => {
        flags.understandingMeter = false;
        const past = fullLog({ date: '2026-10-20', meta: { createdAtISO: '2026-10-20T10:00:00.000Z', createdByOperatorId: ME, farmId: FARM } });
        lng.v = 'mr';
        render(<VoiceResultContainer {...props([past])} />);
        await screen.findByTestId('vr-hero-line');
        expect(screen.getByTestId('vr-hero-line').textContent).toMatch(/२०/);
        expect(latinDigitFindings(screen.getByTestId('vr-hero'))).toEqual([]);
        cleanup();
        lng.v = 'en';
        render(<VoiceResultContainer {...props([past])} />);
        await screen.findByTestId('vr-hero-line');
        expect(screen.getByTestId('vr-hero-line').textContent).toMatch(/20 Oct/);
    });
});

describe('IT-D2 - English mode keeps 0-9', () => {
    it('the same recording in English: the counts, the amounts and the day show Latin digits', async () => {
        lng.v = 'en';
        render(<VoiceResultContainer {...props([fullLog(), earlierLog()])} />);
        await openEverything();
        expect(screen.getByTestId('vr-count').textContent).toBe('Told 2 times today');
        expect(screen.getByTestId('vr-prow-m-conf').textContent).toContain('250 ml');
        expect(screen.getByTestId('vr-prow-m-prem').textContent).toContain('1.5 kg');
        expect(within(screen.getByTestId('vr-lines')).getByTestId('vr-line-head-part:labour').textContent).toMatch(/^3 Male workers · 2 Female workers|4 people/);
        for (const id of ['vr-count', 'vr-lines']) expect(screen.getByTestId(id).textContent, id).not.toMatch(/[०-९]/);
    });
});

describe('IT-D2 - the product card with a matched purchase bill (money and date)', () => {
    const logWithBill = fullLog();
    const kit = (over: Partial<ProductAnswerKit>): ProductAnswerKit => ({
        logById: new Map([[NOW, logWithBill]]), canCheck: true, canSeeMoney: true, nameOfUser: () => 'सुनील', cropNamesOf: () => ['द्राक्ष'],
        onAnswer: vi.fn(async () => undefined), onPhoto: vi.fn(async () => undefined),
        billOf: () => ({ date: '5 नोव्हें.', amount: 1250.5 }), ...over,
    });
    const show = (k: ProductAnswerKit) => {
        const item = productBoxesOf(logWithBill)[0].items[0];
        return render(<ProductCard item={item} logId={NOW} kit={k} onClose={vi.fn()} />);
    };

    it('Marathi: the bill date, the rupees (with their fraction, none cut off) and the dose are in Devanagari digits', () => {
        lng.v = 'mr';
        show(kit({}));
        expect(screen.getByTestId('vr-fact-bill')).toHaveTextContent('५ नोव्हें.');
        expect(screen.getByTestId('vr-fact-bill')).toHaveTextContent('₹१२५०.५');
        expect(screen.getByTestId('vr-fact-dose')).toHaveTextContent('२५० मिली');
        expect(latinDigitFindings(screen.getByTestId('vr-product-card'), ALLOWED)).toEqual([]);
    });

    it('English: the same card keeps 0-9', () => {
        lng.v = 'en';
        show(kit({}));
        expect(screen.getByTestId('vr-fact-bill')).toHaveTextContent('5 नोव्हें.');
        expect(screen.getByTestId('vr-fact-bill')).toHaveTextContent('₹1250.5');
        expect(screen.getByTestId('vr-fact-dose')).toHaveTextContent('250 ml');
        expect(screen.getByTestId('vr-product-card').textContent).not.toMatch(/[०-९]/);
    });
});

describe('IT-D2 - the copy of the result screen holds no Latin digit for any count in Marathi mode', () => {
    it('resultCopy: more / mixBannerMany', () => {
        const mr = resultCopy('mr');
        const en = resultCopy('en');
        for (const n of [0, 1, 2, 9, 10, 57, 1234]) {
            expect(mr.more(n), String(n)).not.toMatch(/[0-9]/);
            expect(mr.mixBannerMany(n), String(n)).not.toMatch(/[0-9]/);
            expect(en.more(n)).toBe(`Show ${n} more`);
            expect(en.mixBannerMany(n)).toBe(`${n} mixes are wrong`);
        }
        expect(mr.mixBannerMany(12)).toBe('१२ मिश्रणं चुकीची आहेत');
    });
});

describe('IT-D2 - the recordings sheet of the day (ClipGlance): the length of a clip and what was understood from it', () => {
    const HERE = log('LOG-HERE', {
        fullTranscript: 'आज चार मजूर आले आणि दोन तास पाणी दिलं',
        labour: [{ id: 'lab', count: 4, sourceText: 'चार मजूर आले' }],
        irrigation: [{ id: 'irr', durationHours: 2, sourceText: 'दोन तास पाणी' }],
        meta: { createdByOperatorId: 'op1', createdAtISO: '2026-10-26T05:00:00.000Z' },
    });
    let audios = 0;
    const createAudio = () => {
        audios += 1;
        return { play: vi.fn(async () => undefined), pause: vi.fn(), duration: 6, currentTime: 0, onended: null, ontimeupdate: null, onloadedmetadata: null } as unknown as HTMLAudioElement;
    };
    const entries = () => buildFeedEntries([HERE], {
        crops: [{ id: 'c1', name: 'द्राक्ष', color: 'bg-purple-500', plots: [] }] as never, operatorNameById: new Map([['op1', 'पुर्वेश']]),
        getLogContextSnapshot: () => ({ plotName: 'सोनाका', cropName: 'द्राक्ष' }), onOpenLog: vi.fn(), youIds: new Set(['op1']),
    });

    beforeEach(async () => {
        audios = 0;
        await getDatabase().voiceClips.put({ ...clipRow('clip-here', 'LOG-HERE'), durationMs: 6000 });
    });

    it('Marathi: the clip length on the card and the open recording (time, clock, understood lines) hold no Latin digit', async () => {
        lng.v = 'mr';
        render(<TodayActivityClipsSheet entries={entries()} dateLabel="सोमवार" onClose={vi.fn()} createAudio={createAudio} />);
        await waitFor(() => expect(screen.getByTestId('card-play')).toBeTruthy());
        expect(screen.getByTestId('card-duration')).toHaveTextContent('०:०६');
        expect(latinDigitFindings(screen.getByTestId('card-duration'))).toEqual([]);
        await act(async () => { fireEvent.click(screen.getByTestId('card-open')); });
        const glance = screen.getByTestId('clip-glance');
        expect(glance).toHaveTextContent('४ जण');
        expect(glance).toHaveTextContent('२ तास');
        expect(within(glance).getByTestId('clip-glance-play-length')).toHaveTextContent('०:०६');
        expect(latinDigitFindings(glance)).toEqual([]);
        expect(audios).toBe(0);
    });

    it('English: the same recording keeps 0-9', async () => {
        lng.v = 'en';
        render(<TodayActivityClipsSheet entries={entries()} dateLabel="Monday" onClose={vi.fn()} createAudio={createAudio} />);
        await waitFor(() => expect(screen.getByTestId('card-play')).toBeTruthy());
        expect(screen.getByTestId('card-duration')).toHaveTextContent('0:06');
        await act(async () => { fireEvent.click(screen.getByTestId('card-open')); });
        const glance = screen.getByTestId('clip-glance');
        expect(within(glance).getByTestId('clip-glance-play-length')).toHaveTextContent('0:06');
        expect(glance).toHaveTextContent('4 people');
        expect(glance.textContent).not.toMatch(/[०-९]/);
    });
});

describe('IT-D2 - display only: the stored record is never touched, and his own words keep their digits', () => {
    it('rendering the result screen with every line and the card open leaves the log objects exactly as they were', async () => {
        lng.v = 'mr';
        const history = [fullLog(), earlierLog()];
        const before = structuredClone(history);
        render(<VoiceResultContainer {...props(history)} />);
        await openEverything();
        fireEvent.click(screen.getByTestId('vr-prow-m-conf'));
        expect(history).toEqual(before);
        expect(JSON.stringify(history)).toContain('"dose":250'); // the number itself is still the number
    });

    it('a transcript he spoke with a digit ("4 मजूर") is shown as spoken, while the amount line made from it is in Devanagari', async () => {
        lng.v = 'mr';
        const spoken = 'आज 4 मजूर आले';
        const history = [fullLog({
            fullTranscript: spoken,
            labour: [{ id: 'lab', count: 4, sourceText: '4 मजूर आले' }],
            irrigation: [], inputs: [], machinery: [], activityExpenses: [], manualTotalCost: undefined,
        })];
        render(<VoiceResultContainer {...props(history)} />);
        await screen.findByTestId('vr-lines');
        fireEvent.click(screen.getByTestId('vr-line-row-part:labour'));
        fireEvent.click(screen.getByTestId('vr-words-toggle'));
        expect(screen.getByTestId('vr-line-head-part:labour').textContent).toBe('४ जण');
        // his words, in the folded block and as the quote under the part, still carry the 4 he said
        expect(screen.getByTestId('vr-words-body').textContent).toContain('4 मजूर आले');
        expect(screen.getByTestId('vr-line-body-part:labour').textContent).toContain('4 मजूर आले'); // the quote under the part
        expect(history[0].fullTranscript).toBe(spoken);
    });
});
