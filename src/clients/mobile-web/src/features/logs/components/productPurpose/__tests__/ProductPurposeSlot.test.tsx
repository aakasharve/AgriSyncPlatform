// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (Part 03 final design, row B4) — Sathi asks what a product was for, through the
 * REAL slot, card, client and store: only the network (`apiFetch`), the phone's speech recogniser, the sync read-out and the native
 * check are stand-ins. Real outcomes: what is drawn, what is sent, and that a let-go is never sent.
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
    apiFetch: vi.fn(),
    sync: 'onServer' as 'onPhone' | 'onServer' | 'needsFix',
    native: false,
    transcribe: vi.fn(),
    notify: vi.fn(),
    lang: 'mr' as 'mr' | 'en',
    observers: [] as Array<{ cb: IntersectionObserverCallback; el: Element | null }>,
}));

vi.mock('../../../../../infrastructure/api/apiFetch', () => ({ apiFetch: h.apiFetch }));
vi.mock('../../voiceResult/useRecordingTrust', () => ({ useLogSyncState: () => h.sync }));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => h.native } }));
vi.mock('../../../../../infrastructure/voice/DeviceSpeechRecognizer', () => ({ DeviceSpeechRecognizer: class { transcribe = h.transcribe; } }));
vi.mock('../../../services/dfesAnswerSignal', () => ({ notifyDfesAnswered: h.notify, subscribeDfesAnswered: () => () => undefined }));
vi.mock('../../../../../i18n/LanguageContext', () => ({ useOptionalLanguage: () => ({ language: h.lang }) }));

import { ProductPurposeSlot, LET_GO_AFTER_TRIES } from '../ProductPurposeSlot';
import { __resetProductPurposeStoreForTests, productPurposeAnswerOf } from '../../../services/productPurposeStore';
import { __resetBackStackForTests, dismissTopOverlay, openOverlayCount } from '../../../../../core/navigation/backStack';
import type { DailyLog } from '../../../../../types';

const FARM = 'farm-1';
const LOG = { id: 'log-1', date: '2026-11-28', inputs: [] } as unknown as DailyLog;
const QUESTION = 'युथेन एम-45 कोणत्या रोगासाठी मारलं?';

const item = (over: Record<string, unknown> = {}) => ({
    inputEventId: 'ev-1', mixIndex: 0, productName: 'Uthane M-45', catalogProductId: 'p-mancozeb-75-wp',
    statedReason: null, purposeStated: false, ask: true, answer: null, ...over,
});
const purposes = (over: Record<string, unknown> = {}, items = [item()]) => ({ dailyLogId: 'log-1', mayAnswer: true, items, ...over });
const reply = (status: number, body?: unknown) => ({
    ok: status >= 200 && status < 300, status,
    json: async () => { if (body === undefined) throw new Error('no body'); return body; },
}) as unknown as Response;
const stored = (code: string | null, response: string, mode = 'chip', extra: Record<string, unknown> = {}) => ({
    questionEventId: 'qe-1', answerMode: mode, response, responseWithheld: false, answerCode: code,
    answeredByUserId: 'u-1', answeredAtUtc: '2026-11-28T06:00:00Z', counts: { purpose: 1 }, ...extra,
});

/** GET answers in turn; POST answers in turn. */
function serve(gets: Array<Response>, posts: Array<Response> = []) {
    h.apiFetch.mockImplementation(async (_path: string, init?: RequestInit) => {
        if ((init?.method ?? 'GET') === 'POST') return posts.shift() ?? reply(500);
        return gets.shift() ?? reply(500);
    });
}
const posts = () => h.apiFetch.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'POST');
const postBody = (n = 0) => JSON.parse(String((posts()[n][1] as RequestInit).body));

function mount(children = (hold: boolean) => <div data-testid="other-question" data-hold={hold ? 'yes' : 'no'} />) {
    return render(<ProductPurposeSlot enabled farmId={FARM} log={LOG}>{children}</ProductPurposeSlot>);
}
/** He scrolls the slot into view (the observer the slot made reports it). */
const scrollToSlot = () => act(() => {
    for (const o of h.observers) o.cb([{ isIntersecting: true, intersectionRatio: 0.7, target: o.el } as unknown as IntersectionObserverEntry], {} as IntersectionObserver);
});
/** The slot is drawn and watching; he scrolls to it; the card is open. */
async function openTheCard() {
    await screen.findByTestId('pq-slot');
    await waitFor(() => expect(h.observers.some(o => o.el !== null)).toBe(true));
    scrollToSlot();
    await screen.findByTestId('pq-overlay');
}
/** One try to scroll past the open card (the next counts only after a pause). */
const tryToScroll = (n: number) => {
    const overlay = screen.getByTestId('pq-overlay');
    for (let i = 0; i < n; i++) {
        vi.setSystemTime(new Date(Date.now() + 1000));
        fireEvent.wheel(overlay, { deltaY: 120 });
    }
};

beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-28T06:00:00Z'));
    h.apiFetch.mockReset();
    h.transcribe.mockReset();
    h.notify.mockReset();
    h.sync = 'onServer';
    h.native = false;
    h.lang = 'mr';
    h.observers = [];
    __resetProductPurposeStoreForTests();
    __resetBackStackForTests();
    vi.stubGlobal('IntersectionObserver', class {
        private readonly rec: { cb: IntersectionObserverCallback; el: Element | null };
        constructor(cb: IntersectionObserverCallback) { this.rec = { cb, el: null }; h.observers.push(this.rec); }
        observe(el: Element) { this.rec.el = el; }
        disconnect() { h.observers = h.observers.filter(o => o !== this.rec); }
        unobserve() { /* not used */ }
        takeRecords() { return []; }
    });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); document.body.style.overflowY = ''; });

describe('which product, and whether to ask at all', () => {
    it('asks about the first product the server asks about, in the design\'s words; the day\'s other question waits', async () => {
        serve([reply(200, purposes({}, [item({ ask: false, mixIndex: 1, inputEventId: 'ev-0' }), item()]))]);
        mount();
        expect(await screen.findByTestId('pq-slot-question')).toHaveTextContent(QUESTION);
        expect(screen.getByTestId('pq-slot')).toHaveAttribute('data-slot', 'sathi-question');
        expect(screen.getByTestId('other-question')).toHaveAttribute('data-hold', 'yes');
        const [path] = h.apiFetch.mock.calls[0] as [string];
        expect(path).toBe('/shramsafal/question-events/product-purposes?farmId=farm-1&dailyLogId=log-1');
    });

    it('the rest of the question area is not remounted when the slot comes (its own effects run once)', async () => {
        serve([reply(200, purposes())]);
        let mounts = 0;
        const Rest: React.FC<{ hold: boolean }> = ({ hold }) => {
            React.useEffect(() => { mounts++; }, []);
            return <div data-testid="other-question" data-hold={hold ? 'yes' : 'no'} />;
        };
        mount(hold => <Rest hold={hold} />);
        await screen.findByTestId('pq-slot');
        expect(mounts).toBe(1);
    });

    it('no card when mayAnswer is false — and the day\'s question is let through', async () => {
        serve([reply(200, purposes({ mayAnswer: false }))]);
        mount();
        await waitFor(() => expect(screen.getByTestId('other-question')).toHaveAttribute('data-hold', 'no'));
        expect(screen.queryByTestId('pq-slot')).toBeNull();
        scrollToSlot();
        expect(screen.queryByTestId('pq-overlay')).toBeNull();
    });

    it('no card when no item is asked about', async () => {
        serve([reply(200, purposes({}, [item({ ask: false })]))]);
        mount();
        await waitFor(() => expect(screen.getByTestId('other-question')).toHaveAttribute('data-hold', 'no'));
        expect(screen.queryByTestId('pq-slot')).toBeNull();
    });

    it.each([403, 404])('a %s on the read shows no card at all', async (status) => {
        serve([reply(status), reply(status)]);
        mount();
        await waitFor(() => expect(screen.getByTestId('other-question')).toHaveAttribute('data-hold', 'no'));
        expect(screen.queryByTestId('pq-slot')).toBeNull();
        expect(screen.queryByTestId('pq-overlay')).toBeNull();
    });

    it('English mode: no card, no read (the question is Marathi only)', () => {
        h.lang = 'en';
        mount();
        expect(screen.queryByTestId('pq-slot')).toBeNull();
        expect(screen.getByTestId('other-question')).toHaveAttribute('data-hold', 'no');
        expect(h.apiFetch).not.toHaveBeenCalled();
    });

    it('the switch off: nothing read, the day\'s question as before', () => {
        render(<ProductPurposeSlot enabled={false} farmId={FARM} log={LOG}>{hold => <div data-testid="other-question" data-hold={hold ? 'yes' : 'no'} />}</ProductPurposeSlot>);
        expect(h.apiFetch).not.toHaveBeenCalled();
        expect(screen.getByTestId('other-question')).toHaveAttribute('data-hold', 'no');
    });

    it('a record not on the server yet is read again once it gets there', async () => {
        h.sync = 'onPhone';
        serve([reply(404), reply(200, purposes())]);
        const view = mount();
        await waitFor(() => expect(h.apiFetch).toHaveBeenCalledTimes(1));
        expect(screen.queryByTestId('pq-slot')).toBeNull();
        h.sync = 'onServer';
        view.rerender(<ProductPurposeSlot enabled farmId={FARM} log={LOG}>{hold => <div data-testid="other-question" data-hold={hold ? 'yes' : 'no'} />}</ProductPurposeSlot>);
        expect(await screen.findByTestId('pq-slot-question')).toHaveTextContent(QUESTION);
        expect(h.apiFetch).toHaveBeenCalledTimes(2);
    });
});

describe('the full-screen card', () => {
    it('opens when the slot scrolls into view, blocks the page\'s scroll, and offers the targets in Marathi and "माहीत नाही"', async () => {
        serve([reply(200, purposes())]);
        mount();
        await screen.findByTestId('pq-slot');
        expect(screen.queryByTestId('pq-overlay')).toBeNull();
        await openTheCard();
        const overlay = screen.getByTestId('pq-overlay');
        expect(overlay).toHaveAttribute('role', 'dialog');
        expect(document.body.style.overflowY).toBe('hidden');
        expect(screen.getByTestId('vr-question-prompt')).toHaveTextContent(QUESTION);
        const chips = screen.getAllByTestId('vr-answer-option').map(c => c.textContent);
        expect(chips).toEqual(['ॲन्थ्रॅक्नोज', 'लवकरचा करपा', 'उशिराचा करपा', 'करपा', 'तांबेरा', 'पानांवरील ठिपके', 'माहीत नाही']);
        // Marathi only, no emoji, no "AI".
        const text = screen.getByTestId('pq-card').textContent ?? '';
        expect(text).not.toMatch(/[A-Za-z]{3,}/);
        expect(text).not.toMatch(/\bAI\b/);
        expect(text).not.toMatch(/\p{Extended_Pictographic}/u);
        // On the web there is no mic button (it could not listen).
        expect(screen.queryByTestId('vr-answer-speak')).toBeNull();
    });

    it('a try to scroll past it does not move the page: it says why', async () => {
        serve([reply(200, purposes())]);
        mount();
        await openTheCard();
        const wheel = new WheelEvent('wheel', { deltaY: 120, cancelable: true, bubbles: true });
        vi.setSystemTime(new Date(Date.now() + 1000));
        act(() => { screen.getByTestId('pq-overlay').dispatchEvent(wheel); });
        expect(wheel.defaultPrevented).toBe(true);
        expect(screen.getByTestId('pq-nudge')).toHaveAttribute('data-on', 'yes');
        expect(screen.getByTestId('pq-nudge')).toHaveTextContent('आधी एवढं सांगा, मग पुढे जाऊया');
        expect(screen.getByTestId('pq-overlay')).toBeInTheDocument();
    });

    it(`lets go after ${LET_GO_AFTER_TRIES} tries without an answer — and NEVER sends it; "आता सांगतो" opens it again`, async () => {
        serve([reply(200, purposes())]);
        mount();
        await openTheCard();
        tryToScroll(LET_GO_AFTER_TRIES - 1);
        expect(screen.getByTestId('pq-overlay')).toBeInTheDocument();
        tryToScroll(1);
        expect(screen.queryByTestId('pq-overlay')).toBeNull();
        expect(document.body.style.overflowY).toBe('');
        expect(screen.getByTestId('pq-slot')).toHaveAttribute('data-state', 'later');
        expect(screen.getByTestId('pq-slot-later')).toHaveTextContent('नंतर सांगायचं ठेवलं.');
        expect(posts()).toHaveLength(0);
        // scrolling past again does not trap him a second time
        scrollToSlot();
        expect(screen.queryByTestId('pq-overlay')).toBeNull();
        fireEvent.click(screen.getByTestId('pq-tell-now'));
        expect(screen.getByTestId('pq-overlay')).toBeInTheDocument();
        expect(posts()).toHaveLength(0);
    });

    it('"नंतर" and the phone\'s back let go too, and neither is sent', async () => {
        serve([reply(200, purposes())]);
        mount();
        await openTheCard();
        fireEvent.click(screen.getByTestId('vr-later'));
        expect(screen.queryByTestId('pq-overlay')).toBeNull();
        fireEvent.click(screen.getByTestId('pq-tell-now'));
        expect(openOverlayCount()).toBe(1);
        act(() => { dismissTopOverlay(); });
        expect(screen.queryByTestId('pq-overlay')).toBeNull();
        expect(posts()).toHaveLength(0);
        expect(h.notify).not.toHaveBeenCalled();
    });
});

describe('a real answer', () => {
    it('a chip: the contract body; 200, then the read again; the slot and the store show it; the meter reads again', async () => {
        serve([reply(200, purposes()), reply(200, purposes({}, [item({ ask: false, answer: stored('lateblight', 'उशिराचा करपा') })]))], [reply(200, { id: 'qe-1' })]);
        mount();
        await openTheCard();
        fireEvent.click(screen.getByText('उशिराचा करपा'));
        await waitFor(() => expect(screen.getByTestId('pq-slot')).toHaveAttribute('data-state', 'done'));
        expect(screen.queryByTestId('pq-overlay')).toBeNull();
        expect(postBody()).toMatchObject({
            farmId: FARM, dailyLogId: 'log-1', questionKey: 'product.purpose', inputEventId: 'ev-1', mixIndex: 0,
            answerMode: 'chip', answerCode: 'lateblight', response: 'उशिराचा करपा', skipped: false,
            marathiApproved: true, promptOrigin: 'pattern', promptText: QUESTION, lookLineIds: [],
            plotId: null, shownAtUtc: null, bankVersion: null, deviationReasonCode: null,
        });
        expect(h.notify).toHaveBeenCalledTimes(1);
        expect(screen.getByTestId('pq-slot-answer')).toHaveTextContent('युथेन एम-45 · उशिराचा करपा');
        expect(productPurposeAnswerOf('log-1', 'ev-1', 0)?.answerCode).toBe('lateblight');
        expect(screen.getByTestId('other-question')).toHaveAttribute('data-hold', 'yes'); // still one question on this screen
    });

    it('"माहीत नाही" is a real answer, sent with the code "unknown"', async () => {
        serve([reply(200, purposes()), reply(200, purposes({}, [item({ ask: false, answer: stored('unknown', 'माहीत नाही') })]))], [reply(200, { id: 'qe-1' })]);
        mount();
        await openTheCard();
        fireEvent.click(screen.getByText('माहीत नाही'));
        await waitFor(() => expect(screen.getByTestId('pq-slot')).toHaveAttribute('data-state', 'done'));
        expect(postBody()).toMatchObject({ answerMode: 'chip', answerCode: 'unknown', response: 'माहीत नाही' });
        expect(screen.getByTestId('pq-slot-answer')).toHaveTextContent('युथेन एम-45 · माहीत नाही');
    });

    it('a 409 shows the answer ALREADY stored, never his new one as if kept', async () => {
        serve([reply(200, purposes()), reply(200, purposes({}, [item({ ask: false, answer: stored('rust', 'तांबेरा') })]))], [reply(409)]);
        mount();
        await openTheCard();
        fireEvent.click(screen.getByText('करपा'));
        await waitFor(() => expect(screen.getByTestId('pq-slot')).toHaveAttribute('data-state', 'done'));
        expect(screen.getByTestId('pq-slot-answer')).toHaveTextContent('युथेन एम-45 · तांबेरा');
        expect(screen.getByTestId('pq-slot-answer')).not.toHaveTextContent(/करपा$/);
        expect(h.notify).not.toHaveBeenCalled();
    });

    it.each([403, 404])('a %s on the answer takes the card and the slot away', async (status) => {
        serve([reply(200, purposes())], [reply(status)]);
        mount();
        await openTheCard();
        fireEvent.click(screen.getByText('करपा'));
        await waitFor(() => expect(screen.queryByTestId('pq-slot')).toBeNull());
        expect(screen.queryByTestId('pq-overlay')).toBeNull();
        expect(screen.getByTestId('other-question')).toHaveAttribute('data-hold', 'no');
    });

    it('a 400 (the product is no longer in the record): read again, and it is not asked', async () => {
        serve([reply(200, purposes()), reply(200, purposes({}, []))], [reply(400)]);
        mount();
        await openTheCard();
        fireEvent.click(screen.getByText('करपा'));
        await waitFor(() => expect(screen.queryByTestId('pq-slot')).toBeNull());
        expect(screen.queryByTestId('pq-overlay')).toBeNull();
    });

    it('not kept (offline): it says so, the chips stay, and nothing moves', async () => {
        serve([reply(200, purposes())], [reply(503)]);
        mount();
        await openTheCard();
        fireEvent.click(screen.getByText('करपा'));
        expect(await screen.findByTestId('vr-answer-status')).toHaveAttribute('data-state', 'failed');
        expect(screen.getAllByTestId('vr-answer-option').length).toBeGreaterThan(1);
        expect(h.notify).not.toHaveBeenCalled();
        expect(screen.getByTestId('pq-slot')).toHaveAttribute('data-state', 'open');
    });

    it('the mic on the card (installed app): his words are read back, "हो, बरोबर" sends them as a spoken answer', async () => {
        h.native = true;
        h.transcribe.mockResolvedValue({ transcript: 'करप्यासाठी मारलं' });
        serve([reply(200, purposes()), reply(200, purposes({}, [item({ ask: false, answer: stored(null, 'करप्यासाठी मारलं', 'voice') })]))], [reply(200, { id: 'qe-2' })]);
        mount();
        await openTheCard();
        fireEvent.click(screen.getByTestId('vr-answer-speak'));
        expect(await screen.findByTestId('pq-heard-words')).toHaveTextContent('“करप्यासाठी मारलं”');
        expect(h.transcribe).toHaveBeenCalledWith({ language: 'mr-IN' });
        expect(posts()).toHaveLength(0); // nothing is sent until he says it is right
        fireEvent.click(screen.getByTestId('pq-heard-yes'));
        await waitFor(() => expect(screen.getByTestId('pq-slot')).toHaveAttribute('data-state', 'done'));
        expect(postBody()).toMatchObject({ answerMode: 'voice', answerCode: null, response: 'करप्यासाठी मारलं', skipped: false });
        expect(screen.getByTestId('pq-slot-answer')).toHaveTextContent('युथेन एम-45 · “करप्यासाठी मारलं”');
        expect(h.notify).toHaveBeenCalledTimes(1);
    });

    it('nothing heard: it says so and asks again; no answer is sent', async () => {
        h.native = true;
        h.transcribe.mockResolvedValue({ error: 'failed' });
        serve([reply(200, purposes())]);
        mount();
        await openTheCard();
        fireEvent.click(screen.getByTestId('vr-answer-speak'));
        expect(await screen.findByTestId('pq-not-heard')).toHaveTextContent('काही ऐकू आलं नाही. माइक परत दाबा आणि सांगा.');
        expect(posts()).toHaveLength(0);
    });
});
