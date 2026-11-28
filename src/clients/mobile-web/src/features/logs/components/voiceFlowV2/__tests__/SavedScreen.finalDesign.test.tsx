// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (Part 03, Stream B: B1 + B3) — the result screen as the founder's FINAL design draws
 * it (result-v12-final.html), on real `DailyLog` shapes (a spray of Confidor in 200 L, three tanks said in his words, ten workers,
 * and an earlier talk by someone else):
 *   - the order: the top card, the meter card, his words, his voice, "यातून काय समजलं" (products first), the question slot,
 *     "आजची बोलणी", the 24-hour line, the end button — and no "मागे" bar;
 *   - the 7 days come from the phone's own history, and only once it has pulled;
 *   - the tank count is the parse's, else his words', else none — never invented (P4);
 *   - the 24-hour line follows the SERVER's `editableUntilUtc` only, for the talk's own speaker; once it passed his edit doors close (P10);
 *   - a row of "आजची बोलणी" opens that whole talk (its words, its voice, its parts), and its own "मागे" closes it;
 *   - Sathi asks "तुम्ही तुमचा आवाज ऐकलात का?" once his clip played to its end.
 */
import React from 'react';
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';

vi.mock('../../../../../i18n/LanguageContext', async () => {
    const { t } = await import('../../../../../i18n/translations');
    const ctx = () => ({ language: 'mr', setLanguage: () => undefined, t: (k: string) => t(k, 'mr') });
    return { useLanguage: ctx, useOptionalLanguage: ctx };
});
vi.mock('../../../../../core/domain/services/DateKeyService', async (orig) => {
    const actual = await orig<typeof import('../../../../../core/domain/services/DateKeyService')>();
    return { ...actual, getDateKey: (t?: Date | string) => (t === undefined ? '2026-10-26' : actual.getDateKey(t)) };
});

import { __resetBackStackForTests, dismissTopOverlay } from '../../../../../core/navigation/backStack';
import { getDatabase, resetDatabase } from '../../../../../infrastructure/storage/DexieDatabase';
import type { VoiceClipCacheRecord } from '../../../../../infrastructure/storage/DexieDatabase';
import type { CropProfile, DailyLog } from '../../../../../types';
import type { ProductAnswerKit } from '../../voiceResult/ProductCard';
import { buildDayView, type WhoDeps } from '../../voiceResult/resultModel';
import SavedScreen, { type SavedScreenProps } from '../SavedScreen';
import { VoiceLayer } from '../VoiceLayer';

const ME = 'op-me';
const RAMESH = 'op-ramesh';
const DATE = '2026-10-26';
const SAID = 'आज दहा मजूर आले. दोनशे लिटरच्या टाकीत कॉन्फिडॉर अडीचशे एमएल टाकलं. अशा तीन टाक्या मारल्या.';
const FUTURE = '2099-01-01T00:00:00Z';
const PAST = '2000-01-01T00:00:00Z';

const log = (id: string, over: Record<string, unknown>): DailyLog => ({
    id, date: DATE, dayOutcome: 'WORK_RECORDED',
    context: { selection: [{ cropId: 'c1', cropName: 'Grapes', selectedPlotIds: ['plot-1'], selectedPlotNames: ['प्लॉट १'] }] },
    cropActivities: [], irrigation: [], labour: [], inputs: [], machinery: [],
    meta: { createdAtISO: '2026-10-26T10:00:00.000Z', createdByOperatorId: ME, farmId: 'farm-1', provenance: { source: 'ai' } },
    ...over,
}) as unknown as DailyLog;

const spray = (over: Record<string, unknown> = {}) => ({
    id: 'ev-spray', method: 'Spray', sourceText: 'कॉन्फिडॉर अडीचशे एमएल टाकलं',
    mix: [{ id: 'm-conf', productName: 'कॉन्फिडॉर', dose: 250, unit: 'ml', numbers: { dose: { certainty: 'reported', quantity: 250, spokenText: 'अडीचशे एमएल' } } }],
    ...over,
});
const nowLog = (over: Record<string, unknown> = {}): DailyLog => log('L-NOW', {
    fullTranscript: SAID,
    labour: [{ id: 'lab', count: 10, sourceText: 'दहा मजूर आले' }],
    irrigation: [{ id: 'w', role: 'spray-carrier', waterVolumeLitres: 200, numbers: { waterVolumeLitres: { certainty: 'reported', quantity: 200, spokenText: 'दोनशे लिटर' } } }],
    inputs: [spray()],
    ...over,
});
const NOW = nowLog();
const EARLIER = log('L-EARLY', {
    fullTranscript: 'सकाळी छाटणी केली',
    cropActivities: [{ id: 'crop-m', title: 'छाटणी', sourceText: 'छाटणी केली' }],
    meta: { createdAtISO: '2026-10-26T03:00:00.000Z', createdByOperatorId: RAMESH, farmId: 'farm-1', provenance: { source: 'ai' } },
});
const CROPS = [{ id: 'c1', name: 'Grapes', iconName: 'Grape', color: '#16a34a', plots: [], supportedTasks: [], workflow: [] }] as unknown as CropProfile[];

const deps: WhoDeps = { youIds: new Set([ME]), nameOf: id => (id === RAMESH ? 'रमेश' : undefined), ownName: 'सुनील', unknownLabel: 'अज्ञात', language: 'mr', nativeDigits: true };
const dayOf = (current: DailyLog[], history: DailyLog[]) => buildDayView(current, history, deps);
const clipRow = (dailyLogId: string): VoiceClipCacheRecord => ({ id: `clip-${dailyLogId}`, dailyLogId, durationMs: 4000 } as unknown as VoiceClipCacheRecord);
const kitOf = (logs: DailyLog[]): ProductAnswerKit => ({
    logById: new Map(logs.map(l => [l.id, l] as const)),
    canCheck: true, canSeeMoney: false,
    nameOfUser: () => 'सुनील', cropNamesOf: () => [],
    onAnswer: vi.fn(async () => undefined), onPhoto: vi.fn(async () => undefined),
});

const props = (current: DailyLog = NOW, over: Partial<SavedScreenProps> = {}): SavedScreenProps => ({
    day: dayOf([current], [current, EARLIER]),
    recordingKey: 'clip-now|T', placeLabel: 'द्राक्ष · प्लॉट १', farmId: 'farm-1', nodes: [], unclear: [],
    clips: new Map([[current.id, clipRow(current.id)]]), playingId: null, progress: 0, lengthOf: () => 4, onTogglePlay: vi.fn(),
    sync: 'onPhone', syncQueuedOf: () => true, confirmed: false,
    onEdit: vi.fn(), onAddAnother: vi.fn(), onTellMore: vi.fn(),
    questionPanel: <div data-testid="question-panel">प्रश्न</div>, extras: <div data-testid="extras-slot" />,
    answerKit: kitOf([current, EARLIER]),
    autoCloseOff: null, onOpenDetail: vi.fn(), onAutoClose: vi.fn(), onFinish: vi.fn(),
    crops: CROPS, history: [current, EARLIER],
    ...over,
});

const before = (a: string, b: string): boolean =>
    !!(screen.getByTestId(a).compareDocumentPosition(screen.getByTestId(b)) & Node.DOCUMENT_POSITION_FOLLOWING);
const quotes = (root: HTMLElement, testId: string): string[] => [...root.querySelectorAll(`[data-testid="${testId}-q"]`)].map(e => e.textContent ?? '');
const seedPull = () => getDatabase().syncCursors.put({ tableName: 'shramsafal', lastSyncAt: '2026-10-26T09:00:00.000Z', version: 1 });

beforeEach(async () => { __resetBackStackForTests(); await resetDatabase(); });
afterEach(() => { cleanup(); });

describe('the final design — the order of the sections', () => {
    it('top card, his words, his voice, यातून काय समजलं (products first), the question, आजची बोलणी, the 24-hour line, the end button', () => {
        render(<SavedScreen {...props(nowLog({ editableUntilUtc: FUTURE }), { viewerUserId: ME })} />);
        const order = ['vr2-head', 'vr2-talk', 'vr2-words', 'vr2-listen', 'vr2-understood', 'vr2-given', 'vr2-parts', 'vr2-edit',
            'vr2-question', 'extras-slot', 'vr2-talks', 'vr2-end-note', 'vr2-finish', 'vr2-idle-bar'];
        for (let i = 1; i < order.length; i++) expect(before(order[i - 1], order[i]), `${order[i - 1]} before ${order[i]}`).toBe(true);
        // each section says what the design says
        expect(screen.getByTestId('vr2-words-title').textContent).toBe('तुमचं बोलणं');
        expect(screen.getByTestId('vr2-words-text').textContent).toBe(SAID);
        expect(screen.getByTestId('vr2-play-voice-title').textContent).toBe('हा तुमचा आवाज');
        expect(screen.getByTestId('vr2-understood').textContent).toContain('यातून काय समजलं');
        expect(within(screen.getByTestId('vr2-question')).getByTestId('question-panel')).toBeTruthy();
        expect(screen.getByTestId('vr2-talks-title').textContent).toContain('आजची बोलणी');
        expect(screen.getByTestId('vr2-end-note').textContent).toBe('काही बदल करायचा असेल तर २४ तासांत करता येईल');
        expect(screen.getByTestId('vr2-finish').textContent).toBe('झालंपूर्ण शेतीचा आढावा बघा');
    });

    it('the pieces the final design replaced are gone: the saved title card, the why-tiles, the earlier fold and the detail button', () => {
        render(<SavedScreen {...props()} />);
        for (const id of ['vr2-saved-title', 'vr-why-heading', 'vr2-earlier', 'vr2-open-detail']) expect(screen.queryByTestId(id), id).toBeNull();
        // the honest sync claim stays, in the talk card (P10)
        expect(within(screen.getByTestId('vr2-talk')).getByTestId('vr2-claim-phone').textContent).toBe('लक्षात ठेवलं ✓');
        expect(screen.queryByTestId('vr2-claim-server')).toBeNull();
    });

    it('the top card: the crop page\'s photo of the crop, its name, the plot selector, and who told today', () => {
        const p = props();
        render(<SavedScreen {...p} />);
        const head = within(screen.getByTestId('vr2-head'));
        expect(head.getByTestId('vr2-crop-photo').getAttribute('src')).toBe('/images/crops/Black Grapes.jpg');
        expect(head.getByTestId('vr2-crop-name').textContent).toBe('द्राक्ष');
        const plot = head.getByTestId('vr2-plot-select');
        expect(plot.textContent).toContain('प्लॉट १');
        fireEvent.click(plot);
        expect(p.onEdit).toHaveBeenCalledWith('L-NOW');
        const who = head.getByTestId('vr2-speakers').textContent ?? '';
        expect(who).toContain('आज कोणी सांगितलं:');
        expect(who).toContain('सुनील · १ वेळा');
        expect(who).toContain('रमेश · १ वेळा');
    });

    it('the end button calls the screen\'s finish handler (never the self-close); without one it is the close handler', () => {
        const p = props();
        render(<SavedScreen {...p} />);
        fireEvent.click(screen.getByTestId('vr2-finish'));
        expect(p.onFinish).toHaveBeenCalledTimes(1);
        expect(p.onAutoClose).not.toHaveBeenCalled();
        cleanup();
        const q = props(NOW, { onFinish: undefined });
        render(<SavedScreen {...q} />);
        fireEvent.click(screen.getByTestId('vr2-finish'));
        expect(q.onAutoClose).toHaveBeenCalledTimes(1);
    });

    it('no "मागे" bar: inside the voice layer the top row is dropped while the result is on, its back control kept mounted', () => {
        const { rerender } = render(
            <VoiceLayer step="saved" back={<button type="button" data-testid="the-back">मागे</button>} placeLabel="द्राक्ष · प्लॉट १" rightChip="या महिन्यात २ दिवस">
                <SavedScreen {...props()} />
            </VoiceLayer>,
        );
        const top = screen.getByTestId('voice-layer-top');
        expect(top.getAttribute('data-hidden')).toBe('yes');
        expect(top.className).toContain('hidden');
        expect(screen.queryByTestId('voice-layer-place')).toBeNull();
        expect(screen.queryByTestId('voice-layer-chip')).toBeNull();
        expect(top.contains(screen.getByTestId('the-back'))).toBe(true);
        rerender(
            <VoiceLayer step="saved" back={<button type="button" data-testid="the-back">मागे</button>} placeLabel="द्राक्ष · प्लॉट १"><p>detail</p></VoiceLayer>,
        );
        expect(screen.getByTestId('voice-layer-top').getAttribute('data-hidden')).toBe('no');
        expect(screen.getByTestId('voice-layer-place')).toBeTruthy();
    });
});

describe('यातून काय समजलं — products first, his own words under each value', () => {
    it('the spray first, with its water, its tank count from his words, and his words under it and under the product', () => {
        render(<SavedScreen {...props()} />);
        const und = screen.getByTestId('vr2-understood');
        const tank = within(und).getByTestId('vr-tank-ev-spray');
        expect(!!(tank.compareDocumentPosition(within(und).getByTestId('vr2-part-labour')) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
        expect(within(tank).getByTestId('vr-tank-value').textContent).toBe('फवारणी · ३ टाक्या');
        expect(within(tank).getByTestId('vr-tank-count').getAttribute('data-count')).toBe('3');
        expect(within(tank).getByTestId('vr-product-water').textContent).toBe('पाणी: दोनशे लिटर');
        expect(quotes(tank, 'vr-tank-said-ev-spray')).toEqual(['दोनशे लिटरच्या', 'अशा तीन टाक्या मारल्या']);
        expect(quotes(tank, 'vr-prow-said-m-conf')).toEqual(['कॉन्फिडॉर अडीचशे एमएल']);
        // the other parts: the value and his words; the products are not drawn a second time as a part
        const labour = within(und).getByTestId('vr2-part-labour');
        expect(within(labour).getByTestId('vr2-part-value-labour').textContent).toBe('१० जण');
        expect(quotes(labour, 'vr2-part-said-labour')).toEqual(['दहा मजूर आले']);
        expect(within(und).queryByTestId('vr2-part-inputs')).toBeNull();
    });

    it('a library product row opens the product flash card (B2); a product the library does not know keeps the bottom card', () => {
        render(<SavedScreen {...props()} />);
        fireEvent.click(screen.getByTestId('vr-prow-m-conf'));
        expect(screen.getByTestId('vr2-product-flash').getAttribute('data-item')).toBe('m-conf');
        expect(screen.queryByTestId('vr-product-card')).toBeNull();
        cleanup();
        const unknown = nowLog({ inputs: [spray({ mix: [{ id: 'm-x', productName: 'झेडएक्सक्यू', dose: 50, unit: 'ml' }] })] });
        render(<SavedScreen {...props(unknown)} />);
        fireEvent.click(screen.getByTestId('vr-prow-m-x'));
        expect(screen.getByTestId('vr-product-card')).toBeTruthy();
        expect(screen.queryByTestId('vr2-product-flash')).toBeNull();
    });

    it('tank count: the parse\'s count when the record holds one (it wins over his words)', () => {
        const parsed = nowLog({ inputs: [spray({ carrierType: 'Tank', carrierCount: 4 })] });
        render(<SavedScreen {...props(parsed)} />);
        expect(screen.getByTestId('vr-tank-value').textContent).toBe('फवारणी · ४ टाक्या');
        expect(screen.getByTestId('vr-tank-count').getAttribute('data-count')).toBe('4');
    });

    it('tank count: none when neither the parse nor his words hold one — never a made-up number', () => {
        const said = 'आज दहा मजूर आले. दोनशे लिटरच्या टाकीत कॉन्फिडॉर अडीचशे एमएल टाकलं.';
        render(<SavedScreen {...props(nowLog({ fullTranscript: said }))} />);
        expect(screen.queryByTestId('vr-tank-count')).toBeNull();
        expect(screen.getByTestId('vr-tank-value').textContent).toBe('फवारणी');
        expect(quotes(screen.getByTestId('vr-tank-ev-spray'), 'vr-tank-said-ev-spray')).toEqual(['दोनशे लिटरच्या']);
    });

    it('an untold part of the day is the red button that opens the ONE mic for it', () => {
        const p = props();
        render(<SavedScreen {...p} />);
        fireEvent.click(within(screen.getByTestId('vr2-parts-untold')).getByTestId('vr2-part-machinery'));
        expect(p.onTellMore).toHaveBeenCalledWith('machinery');
    });
});

describe('the 24-hour line follows the server\'s editableUntilUtc only, for the talk\'s own speaker (B5)', () => {
    const asSpeaker = (over: Partial<SavedScreenProps> = {}): Partial<SavedScreenProps> => ({ viewerUserId: ME, ...over });

    it('absent: no line anywhere (the phone never works out 24 hours itself)', () => {
        render(<SavedScreen {...props(NOW, asSpeaker())} />);
        expect(screen.queryByTestId('vr2-edit-window')).toBeNull();
        expect(screen.queryByTestId('vr2-end-note')).toBeNull();
        expect(screen.getByTestId('vr2-edit')).toBeTruthy();
    });

    it('unreadable (no zone): no line, and nothing is closed by it', () => {
        render(<SavedScreen {...props(nowLog({ editableUntilUtc: '2099-01-01T00:00:00' }), asSpeaker())} />);
        expect(screen.queryByTestId('vr2-end-note')).toBeNull();
        expect(screen.queryByTestId('vr2-edit-closed')).toBeNull();
        expect(screen.getByTestId('vr2-edit')).toBeTruthy();
    });

    it('still ahead, for the speaker: "बदल करता येतो · २४ तास" in the talk card and the line above "झालं"', () => {
        render(<SavedScreen {...props(nowLog({ editableUntilUtc: FUTURE }), asSpeaker())} />);
        expect(within(screen.getByTestId('vr2-talk')).getByTestId('vr2-edit-window').textContent).toBe('बदल करता येतो · २४ तास');
        expect(before('vr2-end-note', 'vr2-finish')).toBe(true);
    });

    it('someone else viewing the talk (the owner): no line — the window is not his', () => {
        render(<SavedScreen {...props(nowLog({ editableUntilUtc: FUTURE }), { viewerUserId: 'op-owner' })} />);
        expect(screen.queryByTestId('vr2-edit-window')).toBeNull();
        expect(screen.queryByTestId('vr2-end-note')).toBeNull();
    });
});

describe('after the 24 hours: the speaker\'s own edit doors on this talk close (B5)', () => {
    const closedFor = (viewerUserId: string, over: Partial<SavedScreenProps> = {}) =>
        props(nowLog({ editableUntilUtc: PAST }), { viewerUserId, onChangeDay: vi.fn(), ...over });

    it('the speaker: the calm line in place of "बदला", no move by the day chip or the plot; answers and checks stay', () => {
        render(<SavedScreen {...closedFor(ME)} />);
        expect(screen.getByTestId('vr2-edit-closed').textContent).toBe('या बोलण्याचे २४ तास संपले, त्यामुळे आता तुम्हाला हे बदलता येत नाही. शेत मालक अजूनही बदलू शकतात.');
        expect(screen.queryByTestId('vr2-edit')).toBeNull();
        expect(screen.queryByTestId('vr2-edit-window')).toBeNull();
        expect(screen.queryByTestId('vr2-end-note')).toBeNull();
        expect(screen.queryByTestId('vr2-day')).toBeNull();
        expect(screen.getByTestId('vr2-plot-select').tagName).not.toBe('BUTTON');
        // never for product checks, answers or confirmations
        expect(screen.getByTestId('vr-prow-m-conf').tagName).toBe('BUTTON');
        expect(within(screen.getByTestId('vr2-question')).getByTestId('question-panel')).toBeTruthy();
        expect(screen.getByTestId('vr2-finish')).toBeTruthy();
    });

    it('the primary owner on his own talk: the same doors close, and the line does not send him to the owner', () => {
        render(<SavedScreen {...closedFor(ME, { viewerIsOwner: true })} />);
        expect(screen.getByTestId('vr2-edit-closed').textContent).toBe('या बोलण्याचे २४ तास संपले, त्यामुळे आता हे बदलता येत नाही.');
    });

    it('the owner (or a grant holder) on someone else\'s talk: every door stays open', () => {
        const p = closedFor('op-owner', { viewerIsOwner: true });
        render(<SavedScreen {...p} />);
        expect(screen.queryByTestId('vr2-edit-closed')).toBeNull();
        fireEvent.click(screen.getByTestId('vr2-edit'));
        expect(p.onEdit).toHaveBeenCalledWith('L-NOW');
        fireEvent.click(screen.getByTestId('vr2-day'));
        expect(p.onChangeDay).toHaveBeenCalledTimes(1);
        expect(screen.getByTestId('vr2-plot-select').tagName).toBe('BUTTON');
    });
});

describe('the 7 days inside the meter card', () => {
    const history = [
        NOW, EARLIER,
        log('L-24', { date: '2026-10-24' }),
        log('L-FORM', { date: '2026-10-23', meta: { createdAtISO: '2026-10-23T05:00:00.000Z', farmId: 'farm-1', provenance: { source: 'manual' } } }),
        log('L-OTHER', { date: '2026-10-22', meta: { createdAtISO: '2026-10-22T05:00:00.000Z', farmId: 'farm-2', provenance: { source: 'ai' } } }),
    ];

    it('before the phone\'s first pull: no days are drawn (an empty dot would be a guess)', async () => {
        render(<SavedScreen {...props(NOW, { history })} />);
        await act(async () => { await new Promise(r => setTimeout(r, 30)); });
        expect(screen.queryByTestId('vr2-streak')).toBeNull();
    });

    it('after it: seven days from the phone\'s own history, today last and ringed, inside the meter card', async () => {
        await seedPull();
        render(<SavedScreen {...props(NOW, { history })} />);
        const streak = await screen.findByTestId('vr2-streak');
        expect(screen.getByTestId('vr2-saved-card').contains(streak)).toBe(true);
        expect(streak.textContent).toContain('गेले ७ दिवस');
        expect(streak.textContent).toContain('भरलेले = बोललेले दिवस');
        const days = within(streak).getAllByTestId('vr2-streak-day');
        expect(days.map(d => d.getAttribute('data-date'))).toEqual(['2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25', '2026-10-26']);
        // a form entry and another farm's log are not talks of this farm
        expect(days.map(d => d.getAttribute('data-told'))).toEqual(['no', 'no', 'no', 'no', 'yes', 'no', 'yes']);
        expect(days.map(d => d.getAttribute('data-today'))).toEqual(['no', 'no', 'no', 'no', 'no', 'no', 'yes']);
        expect(days.map(d => d.textContent)).toEqual(['मं', 'बु', 'गु', 'शु', 'श', 'र', 'सो']);
    });
});

describe('आजची बोलणी — one row per talk, a tap opens the whole talk', () => {
    it('the talk he just made first, then the earlier one: who, time, part icons, voice length (only when its clip is here)', () => {
        render(<SavedScreen {...props()} />);
        const rows = within(screen.getByTestId('vr2-talks')).getAllByRole('button');
        expect(rows.map(r => r.getAttribute('data-testid'))).toEqual(['vr2-talk-row-L-NOW', 'vr2-talk-row-L-EARLY']);
        expect(screen.getByTestId('vr2-talk-who-L-NOW').textContent).toBe('सुनील');
        expect(screen.getByTestId('vr2-talk-now-L-NOW').textContent).toBe('आत्ताचं');
        expect(screen.getByTestId('vr2-talk-time-L-EARLY').textContent).toBeTruthy();
        expect([...screen.getByTestId('vr2-talk-parts-L-NOW').querySelectorAll('[data-part]')].map(e => e.getAttribute('data-part'))).toEqual(['inputs', 'labour']);
        expect(screen.getByTestId('vr2-talk-length-L-NOW').textContent).toBe('०:०४');
        expect(screen.getByTestId('vr2-talk-who-L-EARLY').textContent).toBe('रमेश');
        expect([...screen.getByTestId('vr2-talk-parts-L-EARLY').querySelectorAll('[data-part]')].map(e => e.getAttribute('data-part'))).toEqual(['crop']);
        expect(screen.queryByTestId('vr2-talk-length-L-EARLY')).toBeNull();
        expect(screen.queryByTestId('vr2-talk-now-L-EARLY')).toBeNull();
    });

    it('a tap on an earlier talk opens it in full: its words, its voice, all its parts with his words; its "मागे" closes it', () => {
        const p = props(NOW, { clips: new Map([[NOW.id, clipRow(NOW.id)], [EARLIER.id, clipRow(EARLIER.id)]]) });
        render(<SavedScreen {...p} />);
        fireEvent.click(screen.getByTestId('vr2-talk-row-L-EARLY'));
        const view = screen.getByTestId('vr2-talk-view');
        expect(view.getAttribute('data-talk')).toBe('L-EARLY');
        const v = within(view);
        expect(v.getByTestId('vr2-tv-who').textContent).toBe('रमेश');
        expect(v.getByTestId('vr2-tv-words-title').textContent).toBe('काय सांगितलं');
        expect(v.getByTestId('vr2-words-text').textContent).toBe('सकाळी छाटणी केली');
        expect(v.getByTestId('vr2-tv-play-voice-title').textContent).toBe('रमेश यांचा आवाज');
        fireEvent.click(v.getByTestId('vr2-tv-play'));
        expect(p.onTogglePlay).toHaveBeenCalledWith('L-EARLY');
        expect(v.getByTestId('vr2-part-value-crop').textContent).toBe('छाटणी');
        expect(quotes(v.getByTestId('vr2-part-crop'), 'vr2-part-said-crop')).toEqual(['छाटणी केली']);
        // a talk opened from the list asks for nothing, and never shows the other talk's parts
        expect(v.queryByTestId('vr2-parts-untold')).toBeNull();
        expect(v.queryByTestId('vr2-part-labour')).toBeNull();
        expect(v.getByTestId('vr2-tv-foot').textContent).toBe('हे बोलणं तसंच जपलं आहे.');
        fireEvent.click(v.getByTestId('vr2-talk-view-back'));
        expect(screen.queryByTestId('vr2-talk-view')).toBeNull();
    });

    it('the talk he just made opens too, with its products; the phone\'s back closes it', () => {
        render(<SavedScreen {...props()} />);
        fireEvent.click(screen.getByTestId('vr2-talk-row-L-NOW'));
        const v = within(screen.getByTestId('vr2-talk-view'));
        expect(v.getByTestId('vr-tank-value').textContent).toBe('फवारणी · ३ टाक्या');
        expect(v.getByTestId('vr2-tv-foot').textContent).toBe('हेच आत्ताचं बोलणं आहे.');
        act(() => { expect(dismissTopOverlay()).toBe(true); });
        expect(screen.queryByTestId('vr2-talk-view')).toBeNull();
    });
});

describe('his voice: "तुम्ही तुमचा आवाज ऐकलात का?" once it played to its end', () => {
    it('not asked before the clip ended; asked once after; "हो, ऐकला" marks the clip', () => {
        const p = props();
        const { rerender } = render(<SavedScreen {...p} />);
        expect(screen.queryByTestId('vr2-heard-sheet')).toBeNull();
        rerender(<SavedScreen {...p} heard={new Set([NOW.id])} />);
        expect(screen.getByTestId('vr2-heard-question').textContent).toBe('तुम्ही तुमचा आवाज ऐकलात का?');
        fireEvent.click(screen.getByTestId('vr2-heard-yes'));
        expect(screen.queryByTestId('vr2-heard-sheet')).toBeNull();
        expect(screen.getByTestId('vr2-play-heard').textContent).toBe('ऐकलं');
        rerender(<SavedScreen {...p} heard={new Set([NOW.id])} />);
        expect(screen.queryByTestId('vr2-heard-sheet')).toBeNull();
    });

    it('"पुन्हा ऐका" plays it again and does not ask again', () => {
        const p = props();
        render(<SavedScreen {...p} heard={new Set([NOW.id])} />);
        fireEvent.click(screen.getByTestId('vr2-heard-again'));
        expect(p.onTogglePlay).toHaveBeenCalledWith(NOW.id);
        expect(screen.queryByTestId('vr2-heard-sheet')).toBeNull();
        expect(screen.queryByTestId('vr2-play-heard')).toBeNull();
    });
});
