// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: voice-flow-v2-2026-11-23 (Task 11; amendments H2, H3, M4) — the saved screen, built from the result screen's pieces, on
 * real `DailyLog` shapes (a spray of two products in 200 L, a drip of 19:19:19, two speakers, one earlier recording):
 *   - the sections come in the approved order, the red mix banner first;
 *   - the title claims only what the sync state says (P10): "लक्षात ठेवलं ✓" on the phone, the server's words only once applied;
 *   - his voice sits with his words (under the meter); a typed recording has the typed note and no player;
 *   - a product row opens the product card; a red part opens the mic for that part; the blue button opens the detail page;
 *   - the self-move is held while the product card is open, while a clip plays, while any overlay is open, and is off when the
 *     container says so; his touch starts it again;
 *   - no "पक्कं आहे" here and no projected number (P4).
 * spec: plr-d10 (part 03, B6) — the self-move waits his reading time (3 s + 0.17 s a word of his words shown, 5 to 20 s), then the note
 * "आजच्या शेतीचा आढावा बघा" for 2.4 s; the end button "झालं — पूर्ण शेतीचा आढावा बघा" is the screen's last part.
 */
import '@testing-library/jest-dom/vitest';
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
import { MOVE_NOTE_MS, readingTimeMs } from '../readingTime';
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
    autoCloseOff: null, onOpenDetail: vi.fn(), onAutoClose: vi.fn(), onFinish: vi.fn(),
    ...over,
});

const before = (a: string, b: string): boolean =>
    !!(screen.getByTestId(a).compareDocumentPosition(screen.getByTestId(b)) & Node.DOCUMENT_POSITION_FOLLOWING);

beforeEach(() => { __resetBackStackForTests(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('SavedScreen — what he sees first', () => {
    it('the sections come in the founder\'s order: meter, his words, chemicals and nutrients, the other parts', () => {
        render(<SavedScreen {...props()} />);
        // Founder 2026-11-23: "below the meter is text, below the text the chemical and nutrient, and then other parts".
        const order = ['vr2-head', 'vr2-speakers', 'vr2-saved-card', 'vr2-speaker-done', 'vr2-given', 'vr2-parts', 'vr2-words', 'vr2-question',
            'extras-slot', 'vr2-edit', 'vr2-earlier', 'vr2-open-detail', 'vr2-finish', 'vr2-idle-bar'];
        for (let i = 1; i < order.length; i++) expect(before(order[i - 1], order[i]), `${order[i - 1]} before ${order[i]}`).toBe(true);
    });

    it('a wrong mix (a reviewed rule, test only) puts the red banner first', () => {
        const REVIEWED: MixRule[] = (referenceRules as { rules: MixRule[] }).rules.map(r => ({ ...r, reviewedBy: 'test-fixture', reviewedOn: '2026-11-06' }));
        const bad = log('L-NOW', { ...NOW, inputs: [{ id: 'ev-drip', method: 'Drip', sourceText: 'ठिबकने दिलं',
            mix: [{ id: 'd-can', productName: 'कॅल्शियम नायट्रेट', dose: 2, unit: 'kg' }, { id: 'd-npk', productName: '19:19:19', npkGrade: '19:19:19', dose: 3, unit: 'kg' }] }] });
        render(<SavedScreen {...props({ day: dayOf([bad], [bad]), answerKit: kitOf([bad], true), mixRules: REVIEWED })} />);
        expect(before('vr-mix-banner', 'vr2-head')).toBe(true);
    });

    it('F6: the headline is "जतन झालं ✓" with who said it under it; on the phone only, the badge says "लक्षात ठेवलं" and no server claim', () => {
        const { container } = render(<SavedScreen {...props()} />);
        expect(screen.getByTestId('vr2-saved-title').textContent).toBe('जतन झालं ✓');
        expect(screen.getByTestId('vr2-saved-who').textContent).toBe('तुम्ही स्वतः सांगितलं');
        expect(screen.getByTestId('vr2-claim-phone').textContent).toBe('लक्षात ठेवलं ✓');
        expect(screen.queryByTestId('vr2-claim-server')).toBeNull();
        // it must not repeat the old headline, which is a badge
        expect(screen.getByTestId('vr2-saved-title').textContent).not.toContain('श्रम सफलमध्ये');
        expect(container.textContent).not.toContain('श्रम सफलमध्ये');
    });

    it('server-acknowledged: the badge says the server has it (P10)', () => {
        render(<SavedScreen {...props({ sync: 'onServer' })} />);
        expect(screen.getByTestId('vr2-saved-title').textContent).toBe('जतन झालं ✓');
        expect(screen.getByTestId('vr2-claim-server').textContent).toBe('श्रम सफलमध्ये साठवून ठेवलं');
    });

    it('a sync that needs a hand says so, and the title stays the phone\'s claim', () => {
        render(<SavedScreen {...props({ sync: 'needsFix' })} />);
        expect(screen.getByTestId('vr2-claim-phone').textContent).toBe('लक्षात ठेवलं ✓');
        expect(screen.queryByTestId('vr2-claim-server')).toBeNull();
        expect(screen.getByTestId('vr2-needs-fix')).toBeTruthy();
    });

    it('the card: the title, one quiet line (who, time, पक्कं नाही) and the meter; his voice sits with his words (founder 2026-11-23)', () => {
        render(<SavedScreen {...props()} />);
        const card = within(screen.getByTestId('vr2-saved-card'));
        expect(card.queryByTestId('vr2-remembered')).toBeNull();
        expect(card.getByTestId('vr2-not-confirmed-badge')).toBeTruthy();
        expect(card.getByTestId('vr2-latest-who').textContent).toContain('सुनील');
        // F6: his voice is inside the card, big, right under the badges - no longer with his words
        expect(card.getByTestId('vr2-play')).toBeTruthy();
        expect(within(screen.getByTestId('vr2-words')).queryByTestId('vr2-play')).toBeNull();
        expect(card.queryByTestId('vr-parts')).toBeNull();
        // F3: the meter is the saved card's own dial, drawn only with the meter flag (as the result screen's meter is).
        expect(card.queryByTestId('vr2-meter')).toBeNull();
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

    it('"तुम्ही काय दिलं": a product row opens the product card', () => {
        render(<SavedScreen {...props()} />);
        expect(screen.getByTestId('vr2-given').textContent).toContain('तुम्ही काय दिलं');
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

    it('his words are open, with the why-tiles and the unclear lines', () => {
        render(<SavedScreen {...props()} />);
        const words = within(screen.getByTestId('vr2-words'));
        expect(words.getByTestId('vr2-words-text').textContent).toContain('दहा मजूर आले');
        expect(words.getByTestId('vr-why-heading').textContent).toBe('श्रम साथीला हे का समजले?');
        expect(words.getByTestId('vr2-unclear').textContent).toContain('मागच्या बाजूचं उद्या बघू');
    });

    it('the blue button opens the detail page', () => {
        const p = props();
        render(<SavedScreen {...p} />);
        expect(screen.getByTestId('vr2-open-detail').textContent).toContain('आजचा आढावा बघा');
        fireEvent.click(screen.getByTestId('vr2-open-detail'));
        expect(p.onOpenDetail).toHaveBeenCalledTimes(1);
    });

    it('the earlier recordings are in one fold, counted', () => {
        render(<SavedScreen {...props()} />);
        expect(screen.getByTestId('vr2-earlier-title').textContent).toBe('आजची आधीची बोलणी (१)');
        expect(screen.getByTestId(`vr-earlier-${EARLIER.id}`)).toBeTruthy();
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

describe('SavedScreen — the reading-time move (B6)', () => {
    beforeEach(() => { vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] }); vi.setSystemTime(new Date('2026-10-26T10:01:00.000Z')); });
    const advance = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });
    const state = () => screen.getByTestId('vr2-idle-bar').getAttribute('data-state');
    /** His 22 words: 3 s + 22 × 0.17 s = 6.74 s. */
    const WAIT = readingTimeMs(22);

    it('waits his reading time, from the words shown: 22 words = 6.74 s', () => {
        render(<SavedScreen {...props()} />);
        expect(WAIT).toBe(6740);
        expect(screen.getByTestId('vr2-idle-bar').getAttribute('data-wait-ms')).toBe('6740');
    });

    it('then the note "आजच्या शेतीचा आढावा बघा" for 2.4 s, then it moves once', () => {
        const p = props();
        render(<SavedScreen {...p} />);
        advance(WAIT - 300);
        expect(screen.queryByTestId('vr2-move-note')).toBeNull();
        advance(600);
        expect(screen.getByTestId('vr2-move-note')).toHaveTextContent('आजच्या शेतीचा आढावा बघा');
        expect(p.onAutoClose).not.toHaveBeenCalled();
        advance(MOVE_NOTE_MS + 300);
        expect(p.onAutoClose).toHaveBeenCalledTimes(1);
        advance(60_000);
        expect(p.onAutoClose).toHaveBeenCalledTimes(1);
    });

    it('a shorter talk waits less, never under 5 s; a very long one never over 20 s', () => {
        const short = log('L-NOW', { ...NOW, fullTranscript: 'दोन तास पाणी दिलं' });
        render(<SavedScreen {...props({ day: dayOf([short], [short, EARLIER]) })} />);
        expect(screen.getByTestId('vr2-idle-bar').getAttribute('data-wait-ms')).toBe('5000');
        cleanup();
        const long = log('L-NOW', { ...NOW, fullTranscript: Array.from({ length: 150 }, () => 'शब्द').join(' ') });
        render(<SavedScreen {...props({ day: dayOf([long], [long, EARLIER]) })} />);
        expect(screen.getByTestId('vr2-idle-bar').getAttribute('data-wait-ms')).toBe('20000');
    });

    it('his touch starts the wait again', () => {
        const p = props();
        render(<SavedScreen {...p} />);
        advance(5000);
        fireEvent.pointerDown(screen.getByTestId('vr2-saved-card'));
        advance(WAIT - 300);
        expect(screen.queryByTestId('vr2-move-note')).toBeNull();
        expect(p.onAutoClose).not.toHaveBeenCalled();
        advance(600 + MOVE_NOTE_MS + 300);
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
        expect(screen.queryByTestId('vr2-move-note')).toBeNull();
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

describe('SavedScreen — the end button (B6)', () => {
    it('"झालं — पूर्ण शेतीचा आढावा बघा" is the last part of the screen and finishes once per tap', () => {
        const p = props();
        render(<SavedScreen {...p} />);
        const end = screen.getByTestId('vr2-finish');
        expect(end).toHaveTextContent('झालं');
        expect(end).toHaveTextContent('पूर्ण शेतीचा आढावा बघा');
        expect(end.getAttribute('aria-label')).toBe('झालं — पूर्ण शेतीचा आढावा बघा');
        expect(before('vr2-open-detail', 'vr2-finish')).toBe(true);
        fireEvent.click(end);
        expect(p.onFinish).toHaveBeenCalledTimes(1);
        expect(p.onAutoClose).not.toHaveBeenCalled();
    });

    it('is shown even when the self-move is off (he can always finish)', () => {
        const p = props({ autoCloseOff: 'not_queued' });
        render(<SavedScreen {...p} />);
        fireEvent.click(screen.getByTestId('vr2-finish'));
        expect(p.onFinish).toHaveBeenCalledTimes(1);
    });

    it('not drawn when the caller gives no finish', () => {
        render(<SavedScreen {...props({ onFinish: undefined })} />);
        expect(screen.queryByTestId('vr2-finish')).toBeNull();
    });
});
