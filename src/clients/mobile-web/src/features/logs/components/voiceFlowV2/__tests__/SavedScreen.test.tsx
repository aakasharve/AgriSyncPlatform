// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: voice-flow-v2-2026-11-23 (Task 11; amendments H2, H3, M4) — the saved screen, built from the result screen's pieces, on
 * real `DailyLog` shapes (a spray of two products in 200 L, a drip of 19:19:19, two speakers, one earlier recording):
 *   - the sections come in the final design's order (Part 03 B1, result-v12-final.html), the red mix banner first;
 *   - the talk card's badge claims only what the sync state says (P10): "लक्षात ठेवलं ✓" on the phone, the server's words only once applied;
 *   - his voice sits under his words; a typed recording has the typed note and no player;
 *   - a product row opens the product card; a red part opens the mic for that part; the end button is the one way out;
 *   (the final design's own rules — streak, tank count, 24-hour line, the talks — are in SavedScreen.finalDesign.test.tsx)
 *   - the 30 s close is held while the product card is open, while a clip plays, while any overlay is open, and is off when the
 *     container says so; his touch starts it again from 30;
 *   - no "पक्कं आहे" here and no projected number (P4).
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';

const { flags } = vi.hoisted(() => ({ flags: { understandingMeter: false } }));
vi.mock('../../../../../app/featureFlags', async (orig) => {
    const real = await orig<typeof import('../../../../../app/featureFlags')>();
    return { ...real, FEATURE_FLAGS: new Proxy(real.FEATURE_FLAGS, { get: (t, k) => (k in flags ? flags[k as keyof typeof flags] : t[k as keyof typeof t]) }) };
});
vi.mock('../../../../../i18n/LanguageContext', async () => {
    const { t } = await import('../../../../../i18n/translations');
    const ctx = () => ({ language: 'mr', setLanguage: () => undefined, t: (k: string) => t(k, 'mr') });
    return { useLanguage: ctx, useOptionalLanguage: ctx };
});
vi.mock('../../../../../core/domain/services/DateKeyService', async (orig) => {
    const actual = await orig<typeof import('../../../../../core/domain/services/DateKeyService')>();
    return { ...actual, getDateKey: (t?: Date | string) => (t === undefined ? '2026-10-26' : actual.getDateKey(t)) };
});

import referenceRules from '../../../../../../../../../sync-contract/reference/inputs/mix-rules.json';
import type { MixRule } from '../../../../../domain/inputs/mixRules';
import { __resetBackStackForTests, registerBackDismiss } from '../../../../../core/navigation/backStack';
import type { VoiceClipCacheRecord } from '../../../../../infrastructure/storage/DexieDatabase';
import type { DailyLog } from '../../../../../types';
import type { ProductAnswerKit } from '../../voiceResult/ProductCard';
import { buildDayView, type WhoDeps } from '../../voiceResult/resultModel';
import SavedScreen, { type SavedScreenProps } from '../SavedScreen';

const ME = 'op-me';
const RAMESH = 'op-ramesh';
const DATE = '2026-10-26';
const SAID = 'आज दहा मजूर आले, कॉन्फिडॉर अडीचशे एमएल आणि युथेन पाचशे ग्रॅम दोनशे लिटर पाण्यात फवारलं, एकोणीस एकोणीस एकोणीस पाच किलो ठिबकने दिलं';

const log = (id: string, over: Record<string, unknown>): DailyLog => ({
    id, date: DATE, dayOutcome: 'WORK_RECORDED',
    context: { selection: [{ cropId: 'c1', cropName: 'Grapes', selectedPlotIds: ['plot-1'], selectedPlotNames: ['प्लॉट १'] }] },
    cropActivities: [], irrigation: [], labour: [], inputs: [], machinery: [],
    meta: { createdAtISO: '2026-10-26T10:00:00.000Z', createdByOperatorId: ME, farmId: 'farm-1' },
    ...over,
}) as unknown as DailyLog;

const NOW = log('L-NOW', {
    fullTranscript: SAID,
    labour: [{ id: 'lab', count: 10, sourceText: 'दहा मजूर आले' }],
    inputs: [
        { id: 'ev-spray', method: 'Spray', carrierVolume: 200, carrierUnit: 'L', sourceText: 'दोनशे लिटर पाण्यात फवारलं',
            mix: [{ id: 'm-conf', productName: 'कॉन्फिडॉर', dose: 250, unit: 'ml' }, { id: 'm-uth', productName: 'युथेन एम-४५', dose: 500, unit: 'g' }] },
        { id: 'ev-drip', method: 'Drip', sourceText: 'पाच किलो ठिबकने दिलं',
            mix: [{ id: 'd-npk', productName: '19:19:19', npkGrade: '19:19:19', dose: 5, unit: 'kg' }] },
    ],
});
const EARLIER = log('L-EARLY', {
    fullTranscript: 'सकाळी छाटणी केली',
    cropActivities: [{ id: 'crop-m', title: 'छाटणी', sourceText: 'छाटणी केली' }],
    meta: { createdAtISO: '2026-10-26T03:00:00.000Z', createdByOperatorId: RAMESH, farmId: 'farm-1' },
});

const deps: WhoDeps = { youIds: new Set([ME]), nameOf: id => (id === RAMESH ? 'रमेश' : undefined), ownName: 'सुनील', unknownLabel: 'अज्ञात', language: 'mr', nativeDigits: true };
const dayOf = (current: DailyLog[], history: DailyLog[]) => buildDayView(current, history, deps);

const clipRow = (dailyLogId: string): VoiceClipCacheRecord => ({ id: `clip-${dailyLogId}`, dailyLogId, durationMs: 4000 } as unknown as VoiceClipCacheRecord);

const kitOf = (logs: DailyLog[], canCheck: boolean): ProductAnswerKit => ({
    logById: new Map(logs.map(l => [l.id, l] as const)),
    canCheck, canSeeMoney: false,
    nameOfUser: () => 'सुनील', cropNamesOf: () => [],
    onAnswer: vi.fn(async () => undefined), onPhoto: vi.fn(async () => undefined),
});

const props = (over: Partial<SavedScreenProps> = {}): SavedScreenProps => ({
    day: dayOf([NOW], [NOW, EARLIER]),
    recordingKey: 'clip-now|T', placeLabel: 'द्राक्ष · प्लॉट १', farmId: 'farm-1', nodes: [], unclear: ['मागच्या बाजूचं उद्या बघू'],
    clips: new Map([[NOW.id, clipRow(NOW.id)]]), playingId: null, progress: 0, lengthOf: () => 4, onTogglePlay: vi.fn(),
    sync: 'onPhone', syncQueuedOf: () => true, confirmed: false,
    onEdit: vi.fn(), onAddAnother: vi.fn(), onTellMore: vi.fn(),
    questionPanel: <div data-testid="question-panel" />, extras: <div data-testid="extras-slot" />,
    answerKit: kitOf([NOW, EARLIER], false),
    autoCloseOff: null, onOpenDetail: vi.fn(), onAutoClose: vi.fn(),
    ...over,
});

const before = (a: string, b: string): boolean =>
    !!(screen.getByTestId(a).compareDocumentPosition(screen.getByTestId(b)) & Node.DOCUMENT_POSITION_FOLLOWING);

beforeEach(() => { __resetBackStackForTests(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('SavedScreen — what he sees first', () => {
    it('the sections come in the final design\'s order (Part 03 B1): top card, his words, his voice, what was understood, the question, the talks, the end', () => {
        render(<SavedScreen {...props()} />);
        // Founder 28 Nov (result-v12-final.html): his words, his voice, "यातून काय समजलं" (products first), the question, "आजची बोलणी", "झालं".
        const order = ['vr2-head', 'vr2-speakers', 'vr2-speaker-done', 'vr2-talk', 'vr2-words', 'vr2-listen', 'vr2-understood', 'vr2-given', 'vr2-parts',
            'vr2-edit', 'vr2-question', 'extras-slot', 'vr2-talks', 'vr2-finish', 'vr2-idle-bar'];
        for (let i = 1; i < order.length; i++) expect(before(order[i - 1], order[i]), `${order[i - 1]} before ${order[i]}`).toBe(true);
    });

    it('a wrong mix (a reviewed rule, test only) puts the red banner first', () => {
        const REVIEWED: MixRule[] = (referenceRules as { rules: MixRule[] }).rules.map(r => ({ ...r, reviewedBy: 'test-fixture', reviewedOn: '2026-11-06' }));
        const bad = log('L-NOW', { ...NOW, inputs: [{ id: 'ev-drip', method: 'Drip', sourceText: 'ठिबकने दिलं',
            mix: [{ id: 'd-can', productName: 'कॅल्शियम नायट्रेट', dose: 2, unit: 'kg' }, { id: 'd-npk', productName: '19:19:19', npkGrade: '19:19:19', dose: 3, unit: 'kg' }] }] });
        render(<SavedScreen {...props({ day: dayOf([bad], [bad]), answerKit: kitOf([bad], true), mixRules: REVIEWED })} />);
        expect(before('vr-mix-banner', 'vr2-head')).toBe(true);
    });

    it('on the phone only, the talk card\'s badge says "लक्षात ठेवलं" and there is no server claim (P10); no saved-title card (final design)', () => {
        const { container } = render(<SavedScreen {...props()} />);
        expect(screen.queryByTestId('vr2-saved-title')).toBeNull();
        expect(within(screen.getByTestId('vr2-talk')).getByTestId('vr2-claim-phone').textContent).toBe('लक्षात ठेवलं ✓');
        expect(screen.queryByTestId('vr2-claim-server')).toBeNull();
        expect(container.textContent).not.toContain('श्रम सफलमध्ये');
    });

    it('server-acknowledged: the badge says the server has it (P10)', () => {
        render(<SavedScreen {...props({ sync: 'onServer' })} />);
        expect(screen.getByTestId('vr2-claim-server').textContent).toBe('श्रम सफलमध्ये साठवून ठेवलं');
    });

    it('a sync that needs a hand says so, and the title stays the phone\'s claim', () => {
        render(<SavedScreen {...props({ sync: 'needsFix' })} />);
        expect(screen.getByTestId('vr2-claim-phone').textContent).toBe('लक्षात ठेवलं ✓');
        expect(screen.queryByTestId('vr2-claim-server')).toBeNull();
        expect(screen.getByTestId('vr2-needs-fix')).toBeTruthy();
    });

    it('the talk card: पक्कं नाही, his words, then his voice under them (final design); no meter card without the meter flag or a pulled history', () => {
        render(<SavedScreen {...props()} />);
        const talk = within(screen.getByTestId('vr2-talk'));
        expect(talk.getByTestId('vr2-not-confirmed-badge')).toBeTruthy();
        expect(talk.getByTestId('vr2-play')).toBeTruthy();
        expect(before('vr2-words', 'vr2-play')).toBe(true);
        // F3: the meter is the cream card's own dial, drawn only with the meter flag (as the result screen's meter is).
        expect(screen.queryByTestId('vr2-saved-card')).toBeNull();
        expect(screen.queryByTestId('vr2-meter')).toBeNull();
    });

    it('with the meter flag the card holds the dial; no server score = the pending words, no needle, no number', () => {
        flags.understandingMeter = true;
        try {
            render(<SavedScreen {...props({ farmId: null })} />);
            const card = within(screen.getByTestId('vr2-saved-card'));
            expect(card.getByTestId('vr2-meter').getAttribute('data-state')).toBe('pending');
            expect(card.queryByTestId('vr2-meter-needle')).toBeNull();
            expect(card.getByTestId('vr2-meter-pending').textContent).toBeTruthy();
        } finally {
            flags.understandingMeter = false;
        }
    });

    it('no clip on this phone: the listen frame says so and offers no ▶', () => {
        render(<SavedScreen {...props({ clips: new Map() })} />);
        expect(screen.getByTestId('vr2-play-none')).toBeTruthy();
        expect(screen.queryByTestId('vr2-play')).toBeNull();
    });

    it('a typed recording: the typed note, no player', () => {
        const typed = log('L-NOW', { ...NOW, typedEntry: true });
        render(<SavedScreen {...props({ day: dayOf([typed], [typed]) })} />);
        expect(screen.getByTestId('vr-typed-note')).toBeTruthy();
        expect(screen.queryByTestId('vr2-play')).toBeNull();
    });

    it('"यातून काय समजलं": a product row opens the product card', () => {
        render(<SavedScreen {...props()} />);
        expect(screen.getByTestId('vr2-understood').textContent).toContain('यातून काय समजलं');
        fireEvent.click(screen.getByTestId('vr-prow-m-conf'));
        expect(screen.getByTestId('vr-product-card')).toBeTruthy();
        expect(screen.getByTestId('vr-card-name').textContent).toContain('कॉन्फिडॉर');
    });

    it('a red part opens the mic for THAT part', () => {
        const p = props();
        render(<SavedScreen {...p} />);
        fireEvent.click(screen.getByTestId('vr2-part-machinery'));
        expect(p.onTellMore).toHaveBeenCalledWith('machinery');
        expect(screen.getByTestId('vr2-part-labour').textContent).toContain('१० जण');
    });

    it('his words are open with the unclear lines; his own words now sit under each value instead of the why-tiles (final design)', () => {
        render(<SavedScreen {...props()} />);
        const words = within(screen.getByTestId('vr2-words'));
        expect(words.getByTestId('vr2-words-text').textContent).toContain('दहा मजूर आले');
        expect(words.queryByTestId('vr-why-heading')).toBeNull();
        expect(words.getByTestId('vr2-unclear').textContent).toContain('मागच्या बाजूचं उद्या बघू');
        expect(within(screen.getByTestId('vr2-part-labour')).getByTestId('vr2-part-said-labour').textContent).toContain('दहा मजूर आले');
    });

    it('one way out (final design): the end button, no blue detail button', () => {
        const p = props();
        render(<SavedScreen {...p} />);
        expect(screen.queryByTestId('vr2-open-detail')).toBeNull();
        fireEvent.click(screen.getByTestId('vr2-finish'));
        expect(p.onAutoClose).toHaveBeenCalledTimes(1);
    });

    it('the earlier recordings are rows of "आजची बोलणी" (B3), after the talk he just made', () => {
        render(<SavedScreen {...props()} />);
        expect(screen.queryByTestId('vr2-earlier')).toBeNull();
        expect(before('vr2-talk-row-L-NOW', `vr2-talk-row-${EARLIER.id}`)).toBe(true);
        expect(screen.getByTestId(`vr2-talk-who-${EARLIER.id}`).textContent).toBe('रमेश');
        expect(screen.getByTestId('vr2-speakers').textContent).toContain('रमेश');
    });

    it('no "पक्कं आहे" here, and no projected number (P4)', () => {
        const { container } = render(<SavedScreen {...props({ answerKit: kitOf([NOW, EARLIER], true) })} />);
        expect(screen.queryByTestId('vr-confirm')).toBeNull();
        const text = container.textContent ?? '';
        expect(text).not.toMatch(/→\s*[0-9०-९]/);
        expect(text).not.toMatch(/\/१०|\/10/);
    });

    it('the speaker\'s line shows for someone who does not check products, not for a checker', () => {
        render(<SavedScreen {...props()} />);
        expect(screen.getByTestId('vr2-speaker-done')).toBeTruthy();
        cleanup();
        render(<SavedScreen {...props({ answerKit: kitOf([NOW, EARLIER], true) })} />);
        expect(screen.queryByTestId('vr2-speaker-done')).toBeNull();
    });

    it('several plots: one "बदला" per plot, each with its own badge', () => {
        const a = log('L-A', { ...NOW, id: 'L-A' });
        const b = log('L-B', { ...NOW, id: 'L-B', fullTranscript: undefined, context: { selection: [{ cropId: 'c1', cropName: 'Grapes', selectedPlotIds: ['plot-2'], selectedPlotNames: ['प्लॉट २'] }] } });
        const p = props({ day: dayOf([a, b], [a, b]), clips: new Map() });
        render(<SavedScreen {...p} />);
        fireEvent.click(screen.getByTestId('vr2-edit-L-B'));
        expect(p.onEdit).toHaveBeenCalledWith('L-B');
        expect(screen.getByTestId('vr2-edit-L-A')).toBeTruthy();
        expect(screen.queryByTestId('vr2-edit')).toBeNull();
    });
});

describe('SavedScreen — the 30 s close', () => {
    beforeEach(() => { vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] }); vi.setSystemTime(new Date('2026-10-26T10:01:00.000Z')); });
    const advance = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });
    const state = () => screen.getByTestId('vr2-idle-bar').getAttribute('data-state');

    it('closes itself after 30 s untouched', () => {
        const p = props();
        render(<SavedScreen {...p} />);
        advance(31_000);
        expect(p.onAutoClose).toHaveBeenCalledTimes(1);
    });

    it('his touch starts it again from 30', () => {
        const p = props();
        render(<SavedScreen {...p} />);
        advance(20_000);
        fireEvent.pointerDown(screen.getByTestId('vr2-talk'));
        advance(20_000);
        expect(p.onAutoClose).not.toHaveBeenCalled();
        advance(11_000);
        expect(p.onAutoClose).toHaveBeenCalledTimes(1);
    });

    it('held while the product card is open', () => {
        const p = props();
        render(<SavedScreen {...p} />);
        fireEvent.click(screen.getByTestId('vr-prow-m-conf'));
        advance(60_000);
        expect(state()).toBe('paused');
        expect(p.onAutoClose).not.toHaveBeenCalled();
    });

    it('held while a clip plays', () => {
        const p = props({ playingId: NOW.id });
        render(<SavedScreen {...p} />);
        advance(60_000);
        expect(state()).toBe('paused');
        expect(screen.getByTestId('vr2-idle-left').textContent).toContain('थांबवलं');
        expect(p.onAutoClose).not.toHaveBeenCalled();
    });

    it('held while any overlay is open (the app\'s back stack)', () => {
        const p = props();
        render(<SavedScreen {...p} />);
        const release = registerBackDismiss(() => undefined);
        advance(60_000);
        expect(state()).toBe('paused');
        expect(p.onAutoClose).not.toHaveBeenCalled();
        release();
        advance(31_000);
        expect(p.onAutoClose).toHaveBeenCalledTimes(1);
    });

    it('held while the day sheet is open', () => {
        const p = props({ pickingDay: true });
        render(<SavedScreen {...p} />);
        advance(60_000);
        expect(p.onAutoClose).not.toHaveBeenCalled();
    });

    it('off when the container says so: no countdown, never closes', () => {
        const p = props({ autoCloseOff: 'not_queued' });
        render(<SavedScreen {...p} />);
        advance(120_000);
        expect(state()).toBe('off');
        expect(p.onAutoClose).not.toHaveBeenCalled();
    });
});
