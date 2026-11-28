// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (Part 03, B2) — the product flash card and the check card that pops by itself, on a
 * real record (Confidor in a spray, his words "कॉन्फिडॉर अडीचशे एमएल") and the real library:
 *   - one page in the design's order: the product, what he gave (his words), what it is for, what is in it, "तपासायची", the source;
 *   - D-199 = b: no "how it works" and no IRAC / FRAC group while nothing is ticked;
 *   - the check card pops when the "तपासायची" row has been in view a moment, never before; its three answers go the existing way
 *     ("हो, बरोबर" = the confirmed answer naming the product, "नाही — फोटो काढा" = the photo, "शेत मालक बघतील" = nothing sent); it goes
 *     back into the row, which then says what was answered; closed without an answer, it does not pop again this session;
 *   - the card snaps back once its end has been in view after he scrolled; × and the phone's back do the same; haptics on the grow
 *     and the snap back; with reduced motion it simply opens and closes.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';

vi.mock('../../../../../i18n/LanguageContext', async () => {
    const { t } = await import('../../../../../i18n/translations');
    const ctx = () => ({ language: 'mr', setLanguage: () => undefined, t: (k: string) => t(k, 'mr') });
    return { useLanguage: ctx, useOptionalLanguage: ctx };
});
const haptics = vi.hoisted(() => ({ light: vi.fn(), medium: vi.fn(), heavy: vi.fn(), selection: vi.fn(), success: vi.fn(), warning: vi.fn(), error: vi.fn() }));
vi.mock('../../../../../shared/utils/haptics', () => ({ hapticFeedback: haptics, default: haptics, vibrate: vi.fn() }));

import { __resetBackStackForTests, dismissTopOverlay } from '../../../../../core/navigation/backStack';
import type { DailyLog } from '../../../../../types';
import type { ProductAnswerKit } from '../../voiceResult/ProductCard';
import { productBoxesOf } from '../../voiceResult/productModel';
import { resetCheckSessionForTests } from '../ProductCheck';
import ProductFlashCard, { type ProductFlashCardProps } from '../ProductFlashCard';
import type { TankWords } from '../SavedProducts';

/** A stand-in for the browser's IntersectionObserver: the test says when an element is in view. */
class FakeIO {
    static all: FakeIO[] = [];
    els: Element[] = [];
    constructor(private cb: IntersectionObserverCallback) { FakeIO.all.push(this); }
    observe(el: Element) { this.els.push(el); }
    unobserve() { /* not used */ }
    disconnect() { FakeIO.all = FakeIO.all.filter(x => x !== this); }
    takeRecords() { return []; }
    static show(el: Element, ratio = 1) {
        for (const io of [...FakeIO.all]) {
            if (io.els.includes(el)) io.cb([{ target: el, isIntersecting: ratio > 0, intersectionRatio: ratio } as unknown as IntersectionObserverEntry], io as unknown as IntersectionObserver);
        }
    }
}

const SAID = 'दोनशे लिटरच्या टाकीत कॉन्फिडॉर अडीचशे एमएल टाकलं. अशा तीन टाक्या मारल्या.';
const logOf = (over: Record<string, unknown> = {}): DailyLog => ({
    id: 'L-NOW', date: '2026-11-28', fullTranscript: SAID, cropActivities: [], labour: [], machinery: [],
    irrigation: [{ id: 'w', role: 'spray-carrier', waterVolumeLitres: 200, numbers: { waterVolumeLitres: { certainty: 'reported', quantity: 200, spokenText: 'दोनशे लिटर' } } }],
    inputs: [{ id: 'ev-spray', method: 'Spray', sourceText: 'कॉन्फिडॉर अडीचशे एमएल टाकलं',
        mix: [{ id: 'm-conf', productName: 'कॉन्फिडॉर', dose: 250, unit: 'ml', numbers: { dose: { certainty: 'reported', quantity: 250, spokenText: 'अडीचशे एमएल' } } }] }],
    meta: { createdAtISO: '2026-11-28T10:00:00.000Z', createdByOperatorId: 'op-me', farmId: 'farm-1' },
    ...over,
}) as unknown as DailyLog;

const kitOf = (log: DailyLog, canCheck = false, over: Partial<ProductAnswerKit> = {}): ProductAnswerKit => ({
    logById: new Map([[log.id, log]]), canCheck, canSeeMoney: false, nameOfUser: () => 'सुनील', cropNamesOf: () => [],
    onAnswer: vi.fn(async () => undefined), onPhoto: vi.fn(async () => undefined), ...over,
});
const WORDS: TankWords = { tanks: 3, said: ['दोनशे लिटरच्या', 'अशा तीन टाक्या मारल्या'], saidOf: () => ['कॉन्फिडॉर अडीचशे एमएल'] };

const mount = (over: Partial<ProductFlashCardProps> & { log?: DailyLog; canCheck?: boolean } = {}) => {
    const log = over.log ?? logOf();
    const box = productBoxesOf(log)[0];
    const kit = over.kit ?? kitOf(log, over.canCheck);
    const p: ProductFlashCardProps = {
        item: box.items[0], logId: log.id, kit, box, words: WORDS, talk: undefined, speaker: { name: 'सुनील', you: true }, onClose: vi.fn(), ...over,
    };
    const view = render(<ProductFlashCard {...p} />);
    return { p, kit, view };
};
const CARD = 'vr2-pf-m-conf';
const row = () => screen.getByTestId(`${CARD}-check`);
const advance = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });
const follows = (a: HTMLElement, b: HTMLElement) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

beforeEach(() => {
    __resetBackStackForTests();
    resetCheckSessionForTests();
    FakeIO.all = [];
    vi.stubGlobal('IntersectionObserver', FakeIO);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    Object.values(haptics).forEach(f => f.mockClear());
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('the flash card — one page, in the design\'s order', () => {
    it('the product, what he gave with his words, what it is for, what is in it, the check row, the source', () => {
        mount();
        const card = screen.getByTestId('vr2-product-flash');
        expect(screen.getByTestId(`${CARD}-name`).textContent).toBe('कॉन्फिडॉर');
        const gave = screen.getByTestId(`${CARD}-gave`);
        expect(gave.textContent).toContain('तुम्ही दिलं');
        expect(screen.getByTestId(`${CARD}-amount`).textContent).toBe('अडीचशे एमएल');
        expect(screen.getByTestId(`${CARD}-release`).textContent).toBe('फवारणी · पाणी: दोनशे लिटर · ३ टाक्या');
        expect([...gave.querySelectorAll(`[data-testid="${CARD}-said-q"]`)].map(e => e.textContent)).toEqual(['कॉन्फिडॉर अडीचशे एमएल']);
        const pests = screen.getByTestId(`${CARD}-for-pest`);
        expect(pests.textContent).toContain('या किडींवर काम करतं');
        expect(pests.textContent).toContain('फुलकिडे');
        expect(pests.textContent).toContain('पांढरी माशी');
        expect(screen.getByTestId(`${CARD}-inside-ingredient`).textContent).toBe('घटकइमिडाक्लोप्रिड १७.८%');
        expect(screen.getByTestId(`${CARD}-inside-form`).textContent).toBe('प्रकारएसएल');
        expect(screen.getByTestId(`${CARD}-source`).textContent).toBe('माहिती: श्रमसफल लायब्ररी · तज्ज्ञांची तपासणी बाकी');
        const order = [`${CARD}-name`, `${CARD}-gave`, `${CARD}-for-pest`, `${CARD}-inside`, `${CARD}-check`, `${CARD}-source`, 'vr2-flash-end'].map(id => screen.getByTestId(id));
        for (let i = 1; i < order.length; i++) expect(follows(order[i - 1], order[i]), order[i].getAttribute('data-testid') ?? '').toBe(true);
        // D-199 = b: nothing ticked, so no "how it works" and no group, whatever the library holds
        expect(screen.queryByTestId(`${CARD}-how`)).toBeNull();
        expect(screen.queryByTestId(`${CARD}-inside-group`)).toBeNull();
        expect(card.textContent).not.toMatch(/IRAC|FRAC|कसं काम करतं/);
        expect(row().getAttribute('data-state')).toBe('open');
        expect(within(row()).getByTestId(`${CARD}-check-title`).textContent).toBe('तपासायची');
    });

    it('someone else\'s talk: "<name> यांनी दिलं"', () => {
        mount({ speaker: { name: 'रमेश', you: false } });
        expect(screen.getByTestId(`${CARD}-gave`).textContent).toContain('रमेश यांनी दिलं');
    });
});

describe('the check card — by itself, when "तपासायची" is in view', () => {
    it('pops only after the row has been in view a moment, showing the name, its ingredient and his words', () => {
        mount();
        act(() => FakeIO.show(row(), 1));
        advance(400);
        expect(screen.queryByTestId('vr2-check-card')).toBeNull();
        advance(60);
        const check = screen.getByTestId('vr2-check-card');
        expect(check.textContent).toContain('हे बरोबर आहे का?');
        expect(screen.getByTestId('vr2-check-name').textContent).toBe('कॉन्फिडॉर');
        expect(screen.getByTestId('vr2-check-ingredient').textContent).toBe('इमिडाक्लोप्रिड १७.८%');
        expect(screen.getByTestId('vr2-check-heard').textContent).toBe('“कॉन्फिडॉर अडीचशे एमएल”');
        expect(haptics.medium).toHaveBeenCalled();
    });

    it('leaving the view before the moment passes cancels it', () => {
        mount();
        act(() => FakeIO.show(row(), 1));
        advance(300);
        act(() => FakeIO.show(row(), 0));
        advance(1000);
        expect(screen.queryByTestId('vr2-check-card')).toBeNull();
    });

    it('"हो, बरोबर" is the existing confirmed answer naming the library product; the card goes back and the row says so', async () => {
        const { kit, p } = mount();
        act(() => FakeIO.show(row(), 1));
        advance(450);
        fireEvent.click(screen.getByTestId('vr2-check-yes'));
        await flush();
        expect(kit.onAnswer).toHaveBeenCalledTimes(1);
        expect(kit.onAnswer).toHaveBeenCalledWith({ logId: 'L-NOW', item: p.item, verdict: 'confirmed', catalogProductId: 'p-imidacloprid-17-8-sl' });
        expect(kit.onPhoto).not.toHaveBeenCalled();
        expect(screen.queryByTestId('vr2-check-card')).toBeNull();
        expect(row().getAttribute('data-state')).toBe('yes');
        expect(within(row()).getByTestId(`${CARD}-check-title`).textContent).toBe('तपासलं: बरोबर');
        expect(haptics.success).toHaveBeenCalled();
    });

    it('"नाही — फोटो काढा" is the existing photo; nothing else is sent', async () => {
        const { kit, p } = mount();
        act(() => FakeIO.show(row(), 1));
        advance(450);
        fireEvent.click(screen.getByTestId('vr2-check-photo'));
        await flush();
        expect(kit.onPhoto).toHaveBeenCalledWith({ logId: 'L-NOW', item: p.item });
        expect(kit.onAnswer).not.toHaveBeenCalled();
        expect(within(row()).getByTestId(`${CARD}-check-title`).textContent).toBe('फोटो काढला · तपासणी बाकी');
    });

    it('"शेत मालक बघतील": nothing is sent (the product stays for the owner to check), the row remembers it this session', async () => {
        const { kit } = mount();
        act(() => FakeIO.show(row(), 1));
        advance(450);
        fireEvent.click(screen.getByTestId('vr2-check-owner'));
        await flush();
        expect(kit.onAnswer).not.toHaveBeenCalled();
        expect(kit.onPhoto).not.toHaveBeenCalled();
        expect(within(row()).getByTestId(`${CARD}-check-title`).textContent).toBe('शेत मालक बघतील');
        cleanup();
        mount();
        expect(within(row()).getByTestId(`${CARD}-check-title`).textContent).toBe('शेत मालक बघतील');
        act(() => FakeIO.show(row(), 1));
        advance(1000);
        expect(screen.queryByTestId('vr2-check-card')).toBeNull();
    });

    it('for someone who checks records the third answer is the bottom card\'s own "नंतर पाहीन", and it sends nothing', async () => {
        const { kit } = mount({ canCheck: true });
        act(() => FakeIO.show(row(), 1));
        advance(450);
        expect(screen.getByTestId('vr2-check-owner').textContent).toBe('नंतर पाहीन');
        fireEvent.click(screen.getByTestId('vr2-check-owner'));
        await flush();
        expect(kit.onAnswer).not.toHaveBeenCalled();
        expect(row().getAttribute('data-state')).toBe('open');
    });

    it('closed without an answer, it does not pop again this session — a tap on the row still opens it', () => {
        mount();
        act(() => FakeIO.show(row(), 1));
        advance(450);
        fireEvent.click(screen.getByTestId('vr2-check-close'));
        expect(screen.queryByTestId('vr2-check-card')).toBeNull();
        cleanup();
        mount();
        act(() => FakeIO.show(row(), 1));
        advance(1000);
        expect(screen.queryByTestId('vr2-check-card')).toBeNull();
        fireEvent.click(row());
        expect(screen.getByTestId('vr2-check-card')).toBeTruthy();
    });

    it('an answer that could not be kept says so, and the card stays', async () => {
        const log = logOf();
        const kit = kitOf(log, false, { onAnswer: vi.fn(async () => { throw new Error('queue'); }) });
        mount({ log, kit });
        fireEvent.click(row());
        fireEvent.click(screen.getByTestId('vr2-check-yes'));
        await flush();
        expect(screen.getByTestId('vr2-check-failed').textContent).toBe('आत्ता ठेवता आलं नाही — पुन्हा दाबा');
        expect(screen.getByTestId('vr2-check-card')).toBeTruthy();
    });

    it('a product already answered on the record says so and does not pop', () => {
        const answered = logOf({ inputIdentities: [{ inputEventId: 'ev-spray', mixIndex: 0, verdict: 'confirmed', isCheck: false, assertedByUserId: 'op-me', assertedAtUtc: '2026-11-28T10:05:00Z', catalogProductId: 'p-imidacloprid-17-8-sl' }] });
        mount({ log: answered });
        expect(row().getAttribute('data-state')).toBe('yes');
        act(() => FakeIO.show(row(), 1));
        advance(1000);
        expect(screen.queryByTestId('vr2-check-card')).toBeNull();
    });
});

describe('the flash card — snapping back', () => {
    it('once its end has been in view a moment after he scrolled, it goes back by itself', () => {
        const { p } = mount();
        const scroll = screen.getByTestId('vr2-flash-scroll');
        act(() => FakeIO.show(screen.getByTestId('vr2-flash-end'), 1));
        advance(2000);
        expect(p.onClose).not.toHaveBeenCalled(); // not before he scrolled there
        scroll.scrollTop = 120;
        act(() => { fireEvent.scroll(scroll); });
        act(() => FakeIO.show(screen.getByTestId('vr2-flash-end'), 1));
        advance(900);
        expect(p.onClose).not.toHaveBeenCalled();
        advance(60);
        expect(p.onClose).toHaveBeenCalledTimes(1);
        expect(haptics.light).toHaveBeenCalled();
    });

    it('× closes it; the phone\'s back closes the check card first, then the flash card', () => {
        const { p } = mount();
        fireEvent.click(row());
        expect(screen.getByTestId('vr2-check-card')).toBeTruthy();
        act(() => { expect(dismissTopOverlay()).toBe(true); });
        expect(screen.queryByTestId('vr2-check-card')).toBeNull();
        expect(p.onClose).not.toHaveBeenCalled();
        act(() => { expect(dismissTopOverlay()).toBe(true); });
        expect(p.onClose).toHaveBeenCalledTimes(1);
        cleanup();
        const second = mount();
        fireEvent.click(screen.getByTestId('vr2-flash-close'));
        expect(second.p.onClose).toHaveBeenCalledTimes(1);
    });

    it('grows out of the row it was opened on (haptic on the grow); with reduced motion it simply opens and closes', () => {
        const from = { left: 20, top: 400, width: 300, height: 64 };
        mount({ from });
        expect(haptics.medium).toHaveBeenCalledTimes(1);
        expect(screen.getByTestId('vr2-product-flash').getAttribute('data-phase')).toBe('from');
        cleanup();
        vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('reduce'), media: q, addEventListener: () => undefined, removeEventListener: () => undefined }));
        const reduced = mount({ from });
        expect(screen.getByTestId('vr2-product-flash').getAttribute('data-phase')).toBe('open');
        fireEvent.click(screen.getByTestId('vr2-flash-close'));
        expect(reduced.p.onClose).toHaveBeenCalledTimes(1);
    });
});
