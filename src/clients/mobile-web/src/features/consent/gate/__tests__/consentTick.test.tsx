// @vitest-environment jsdom
// spec: plr-d10-x1-consent-tick-on-phone-screen-2026-10-25
//       (AC4, AC7, AC8, AC9, AC10, AC11, AC13, AC15, AC16, AC19, AC20, AC21)
//
// Authored by test-writer from the spec alone.
//
// `useConsentBeforeOtp` + `<ConsentTick>` + `<ConsentNoticeSheet>`, driven through a tiny
// harness. Mocked: the network (consentGateApi), the link store (consentGateLinkReconciler),
// the app language (LanguageContext) and the Capacitor App plugin (so Android Back can be
// pressed). Real: `useConsentGate` over fake-indexeddb, so the device mark the voice-clip
// store reads is checked where it actually lives.
//
// The rules pinned here are the ones a later "smoother onboarding" change would break:
//   • consent belongs to the person at the phone-number screen, not to the phone: every
//     visit shows the tick UNticked, whatever the phone accepted before (amended AC4);
//   • nothing but the tick enables sending; nothing is recorded unless ticked; a failed
//     record marks nothing; one write in flight at a time (amended AC16);
//   • every acceptance carries its own pre-registration session id (AC19);
//   • the sheet shows the whole notice and every string it (or the tick row) shows is in
//     the hashed text — AC9 / AC13 walk the rendered DOM, not a list someone has to remember.

import 'fake-indexeddb/auto';
import '@testing-library/jest-dom/vitest';
import React from 'react';
import Dexie from 'dexie';
import userEvent from '@testing-library/user-event';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

// ── hoisted mock state ───────────────────────────────────────────────────────────────
const h = vi.hoisted(() => {
    type Lang = 'mr' | 'en';
    let current: Lang = 'mr';
    const listeners = new Set<() => void>();
    return {
        lang: {
            get: (): Lang => current,
            set: (l: Lang) => { current = l; listeners.forEach((fn) => fn()); },
            reset: (l: Lang = 'mr') => { current = l; },
            subscribe: (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; },
            calls: [] as string[],
        },
        record: vi.fn(),
        remember: vi.fn(),
        native: false,
        back: {
            registrations: [] as Array<{ event: string; cb: (e: unknown) => void; remove: Mock<() => Promise<void>> }>,
            exitApp: vi.fn(async () => undefined),
        },
    };
});

vi.mock('../../../../i18n/LanguageContext', async () => {
    const ReactMod = await import('react');
    const { t: translate } = await import('../../../../i18n/translations');
    const useValue = () => {
        const language = ReactMod.useSyncExternalStore(h.lang.subscribe, h.lang.get, h.lang.get);
        return {
            language,
            setLanguage: (l: 'mr' | 'en') => { h.lang.calls.push(l); h.lang.set(l); },
            t: (key: string) => translate(key, language),
        };
    };
    return {
        useLanguage: useValue,
        useOptionalLanguage: useValue,
        LanguageProvider: ({ children }: { children: React.ReactNode }) => children,
    };
});

vi.mock('../consentGateApi', () => ({
    recordConsentGateAcceptance: (...a: unknown[]) => h.record(...a),
    resolveConsentSource: () => (h.native ? 'android' : 'web'),
}));

vi.mock('../consentGateLinkReconciler', () => ({
    rememberConsentGateAcceptanceForLinking: (...a: unknown[]) => h.remember(...a),
    reconcileConsentGateLink: async () => 'nothing-pending',
    __resetConsentGateLinkReconcilerForTests: () => undefined,
}));

// Android: `Capacitor.isNativePlatform()` follows `h.native`; everything else is the real core.
vi.mock('@capacitor/core', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@capacitor/core')>();
    const Capacitor = new Proxy(actual.Capacitor, {
        get(target, prop, receiver) {
            if (prop === 'isNativePlatform') return () => h.native;
            if (prop === 'getPlatform') return () => (h.native ? 'android' : 'web');
            return Reflect.get(target, prop, receiver);
        },
    });
    return { ...actual, Capacitor };
});

// The App plugin: every listener is captured so a test can press the hardware Back button
// exactly as Capacitor would — by calling every listener that is still registered.
vi.mock('@capacitor/app', () => {
    const addListener = (event: string, cb: (e: unknown) => void) => {
        const remove = vi.fn<() => Promise<void>>(async () => undefined);
        h.back.registrations.push({ event, cb, remove });
        const handle = { remove };
        return Object.assign(Promise.resolve(handle), handle);
    };
    return {
        App: {
            addListener,
            removeAllListeners: vi.fn(async () => undefined),
            exitApp: h.back.exitApp,
            minimizeApp: vi.fn(async () => undefined),
            getInfo: vi.fn(async () => ({})),
            getState: vi.fn(async () => ({ isActive: true })),
        },
    };
});

import { useConsentBeforeOtp } from '../useConsentBeforeOtp';
import * as ConsentTickModule from '../ConsentTick';
import { buildConsentAcceptance } from '../consentAcceptance';
import {
    CONSENT_NOTICE,
    DATA_FIDUCIARY,
    NOTICE_VERSION,
    canonicalNoticeText,
    type NoticeLanguage,
} from '../consentNotice';
import { t as translate } from '../../../../i18n/translations';
import { getDatabase, resetDatabase } from '../../../../infrastructure/storage/DexieDatabase';
import { setActiveDatabaseName } from '../../../../infrastructure/storage/activeDatabaseName';
import { UNIDENTIFIED_DATABASE_NAME } from '../../../../infrastructure/storage/userDatabaseName';

type ConsentBeforeOtp = ReturnType<typeof useConsentBeforeOtp>;
type TickComponent = React.FC<{ consent: ConsentBeforeOtp; disabled?: boolean }>;
// The spec names the component, not the export form; accept either.
const tickExports = ConsentTickModule as unknown as { default?: TickComponent; ConsentTick?: TickComponent };
const ConsentTick = (tickExports.default ?? tickExports.ConsentTick) as TickComponent;

const IDS = { termsAcceptanceEventId: 't-1', consentGrantEventId: 'c-1' };
/** The device mark the voice-clip store reads (unchanged device semantics). */
const ACCEPTED_NOTICE_PREF = 'shramsafal_consent_gate_accepted_notice';
const deviceMark = async (): Promise<unknown> => (await getDatabase().uiPrefs.get(ACCEPTED_NOTICE_PREF))?.value;

// ── harness ──────────────────────────────────────────────────────────────────────────
let latest: ConsentBeforeOtp | null = null;
const Harness: React.FC<{ tickDisabled?: boolean }> = ({ tickDisabled }) => {
    const consent = useConsentBeforeOtp();
    latest = consent;
    return (
        <div>
            <input data-testid="harness-phone" type="tel" defaultValue="" />
            <div data-testid="tick-host">
                <ConsentTick consent={consent} disabled={tickDisabled} />
            </div>
            <output data-testid="harness-can-send">{String(consent.canSend)}</output>
            <output data-testid="harness-language">{consent.language}</output>
        </div>
    );
};
const hook = (): ConsentBeforeOtp => {
    if (!latest) throw new Error('harness not rendered');
    return latest;
};

/** Works whether the tick is an <input type=checkbox> or an ARIA checkbox. */
function tickState(el: HTMLElement): boolean {
    if (el instanceof HTMLInputElement) return el.checked;
    const aria = el.getAttribute('aria-checked');
    if (aria !== null) return aria === 'true';
    const inner = el.querySelector<HTMLInputElement>('input[type="checkbox"]');
    if (inner) return inner.checked;
    throw new Error('consent-tick is not a checkbox');
}

function isTickDisabled(el: HTMLElement): boolean {
    if (el instanceof HTMLInputElement) return el.disabled;
    if (el.getAttribute('aria-disabled') === 'true') return true;
    const inner = el.querySelector<HTMLInputElement>('input[type="checkbox"]');
    return inner ? inner.disabled : false;
}

const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
const EDGE = /^[^\p{L}\p{M}\p{N}]+|[^\p{L}\p{M}\p{N}]+$/gu;
const HAS_WORD = /[\p{L}\p{N}]/u;
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 40)); });

/** The innermost element whose text contains `text` — what a finger on that sentence hits. */
function deepestElementContaining(root: Element, text: string): HTMLElement {
    const target = norm(text);
    const matches = [root, ...Array.from(root.querySelectorAll('*'))]
        .filter((el) => norm(el.textContent ?? '').includes(target));
    const deepest = matches.filter((el) => !matches.some((other) => other !== el && el.contains(other)));
    if (deepest.length === 0) throw new Error(`no element shows: ${text}`);
    return deepest[0] as HTMLElement;
}

function textNodesUnder(root: Node): string[] {
    const out: string[] = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let n: Node | null = walker.nextNode();
    while (n) {
        const text = norm(n.textContent ?? '');
        if (text) out.push(text);
        n = walker.nextNode();
    }
    return out;
}

/** Screen chrome that is not a legal statement (spec: translations gain chrome only). */
function chromeStrings(): Set<string> {
    const keys = ['noticeClose', 'noticeBack', 'documentLoading', 'documentFailed', 'retry', 'languageGroupLabel'];
    const out = new Set<string>(['मराठी', 'English']);
    for (const language of ['mr', 'en'] as const) {
        for (const key of keys) out.add(norm(translate(`consentGate.${key}`, language)).replace(EDGE, ''));
    }
    return out;
}

/** A rendered fragment is "hashed" if the canonical text contains it (separators tolerated). */
function isHashed(fragment: string, canonical: string, chrome: Set<string>): boolean {
    const f = norm(fragment).replace(EDGE, '');
    if (!HAS_WORD.test(f)) return true; // pure punctuation / separators / icons
    if (chrome.has(f) || canonical.includes(f)) return true;
    const parts = f
        .split(/\s+[—–\-·•|:]\s+|:\s+/)
        .map((p) => p.replace(EDGE, ''))
        .filter((p) => HAS_WORD.test(p));
    return parts.length > 1 && parts.every((p) => chrome.has(p) || canonical.includes(p));
}

function unhashedStringsUnder(root: Node, language: NoticeLanguage): string[] {
    const canonical = norm(canonicalNoticeText(language));
    const chrome = chromeStrings();
    return textNodesUnder(root).filter((t) => !isHashed(t, canonical, chrome));
}

/** Every copy string a farmer must be able to see (codes and ids are never shown). */
function displayableCopy(language: NoticeLanguage): string[] {
    const c = CONSENT_NOTICE[language];
    return [
        c.title, c.intro, c.brandLine, c.purposeCardsHeading,
        ...c.cards.flatMap((card) => [card.title, card.data, card.purpose]),
        c.willNotDo.heading, ...c.willNotDo.items,
        c.processors,
        c.rights.heading, c.rights.where, ...c.rights.items, c.rights.withdrawal, c.rights.boardComplaint,
        c.entity.heading, c.entity.contactLabel,
        c.acceptanceMeaning, c.ctaDisabledHint,
        c.tick.lead, c.tick.link, c.tick.tail,
        c.links.terms, c.links.privacy,
    ].filter((s) => s.trim().length > 0);
}

const SCROLL_CLASSES = ['overflow-y-auto', 'overflow-auto', 'overflow-y-scroll', 'overflow-scroll'];
const isScroller = (el: Element) =>
    SCROLL_CLASSES.some((c) => el.classList.contains(c))
    || /auto|scroll/.test((el as HTMLElement).style?.overflowY ?? '')
    || /auto|scroll/.test((el as HTMLElement).style?.overflow ?? '');

const LEGAL_MD = '# Legal heading\n\nLegal body paragraph.';

/** Tick, then record once, through the hook — the shape every page uses. */
async function tickAndRecord(): Promise<void> {
    fireEvent.click(screen.getByTestId('consent-tick'));
    await waitFor(() => expect(hook().canSend).toBe(true));
    await act(async () => { await hook().recordIfNeeded(); });
}

beforeEach(async () => {
    try { await resetDatabase(); } catch { /* none open */ }
    await Dexie.delete(UNIDENTIFIED_DATABASE_NAME);
    window.localStorage.clear();
    setActiveDatabaseName(UNIDENTIFIED_DATABASE_NAME);

    h.lang.reset('mr');
    h.lang.calls.length = 0;
    h.native = false;
    h.back.registrations.length = 0;
    h.back.exitApp.mockClear();
    h.record.mockReset();
    h.record.mockResolvedValue(IDS);
    h.remember.mockReset();
    h.remember.mockResolvedValue(undefined);
    latest = null;
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, text: async () => LEGAL_MD })));
});

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

// ─────────────────────────────────────────────────────────────────────────────────────
describe('ConsentTick — never pre-ticked, and the only thing that enables sending (AC11)', () => {
    it('renders the tick UNticked on arrival, with status required', () => {
        render(<Harness />);
        expect(tickState(screen.getByTestId('consent-tick'))).toBe(false);
        expect(hook().ticked).toBe(false);
        expect(hook().status).toBe('required');
        expect(hook().recording).toBe(false);
    });

    it('is the only checkbox it renders', () => {
        render(<Harness />);
        const host = screen.getByTestId('tick-host');
        const boxes = host.querySelectorAll('input[type="checkbox"], [role="checkbox"]');
        expect(boxes).toHaveLength(1);
    });

    it('canSend is false while unticked and true once ticked', async () => {
        render(<Harness />);
        expect(hook().canSend).toBe(false);
        expect(screen.getByTestId('harness-can-send')).toHaveTextContent('false');

        fireEvent.click(screen.getByTestId('consent-tick'));

        await waitFor(() => expect(hook().canSend).toBe(true));
        expect(hook().ticked).toBe(true);
        expect(tickState(screen.getByTestId('consent-tick'))).toBe(true);
    });

    it('un-ticking takes canSend away again', async () => {
        render(<Harness />);
        const box = screen.getByTestId('consent-tick');
        fireEvent.click(box);
        await waitFor(() => expect(hook().canSend).toBe(true));
        fireEvent.click(box);
        await waitFor(() => expect(hook().canSend).toBe(false));
        expect(tickState(box)).toBe(false);
    });

    it('opening and closing the notice does not tick the box or enable sending', async () => {
        render(<Harness />);
        fireEvent.click(screen.getByTestId('consent-open-notice'));
        expect(await screen.findByTestId('consent-notice-sheet')).toBeInTheDocument();
        fireEvent.click(screen.getByTestId('consent-notice-close'));
        await waitFor(() => expect(screen.queryByTestId('consent-notice-sheet')).toBeNull());

        expect(tickState(screen.getByTestId('consent-tick'))).toBe(false);
        expect(hook().canSend).toBe(false);
    });

    it('the disabled prop holds the tick: it cannot be changed', async () => {
        const user = userEvent.setup();
        render(<Harness tickDisabled />);
        const box = screen.getByTestId('consent-tick');
        expect(isTickDisabled(box)).toBe(true);

        await user.click(box);
        await settle();
        expect(tickState(box)).toBe(false);
        expect(hook().ticked).toBe(false);
        expect(hook().canSend).toBe(false);
    });
});

describe('AC4 — consent belongs to the person at the screen, not to the phone', () => {
    it('a phone that accepted before still shows the tick, unticked, on a new visit', async () => {
        await getDatabase().uiPrefs.put({ key: ACCEPTED_NOTICE_PREF, value: NOTICE_VERSION });

        render(<Harness />);
        await settle();

        expect(screen.getByTestId('consent-tick')).toBeInTheDocument();
        expect(tickState(screen.getByTestId('consent-tick'))).toBe(false);
        expect(hook().status).toBe('required');
        expect(hook().canSend).toBe(false);
    });

    it('within one visit, a successful accept removes the tick and allows sending without a tick', async () => {
        render(<Harness />);
        await tickAndRecord();

        await waitFor(() => expect(hook().status).toBe('passed'));
        expect(screen.getByTestId('tick-host')).toBeEmptyDOMElement();
        expect(screen.queryByTestId('consent-tick')).toBeNull();
        expect(screen.queryByTestId('consent-tick-hint')).toBeNull();
        expect(screen.queryByTestId('consent-open-notice')).toBeNull();
        expect(hook().canSend).toBe(true);
    });

    it('within one visit, a retry after a successful accept records nothing more', async () => {
        render(<Harness />);
        await tickAndRecord();
        await waitFor(() => expect(hook().status).toBe('passed'));

        await act(async () => { await hook().recordIfNeeded(); });
        await act(async () => { await hook().recordIfNeeded(); });

        expect(h.record).toHaveBeenCalledTimes(1);
        expect(h.remember).toHaveBeenCalledTimes(1);
    });

    it('each acceptance writes the device mark the voice-clip store reads', async () => {
        render(<Harness />);
        expect(await deviceMark()).not.toBe(NOTICE_VERSION);
        await tickAndRecord();
        await waitFor(async () => expect(await deviceMark()).toBe(NOTICE_VERSION), { timeout: 5000 });
    });

    it('a later visit on the same phone shows the tick again and records again', async () => {
        render(<Harness />);
        await tickAndRecord();
        await waitFor(async () => expect(await deviceMark()).toBe(NOTICE_VERSION), { timeout: 5000 });
        cleanup();
        latest = null;

        render(<Harness />);
        await settle();
        expect(tickState(screen.getByTestId('consent-tick'))).toBe(false);
        expect(hook().status).toBe('required');
        expect(hook().canSend).toBe(false);

        await tickAndRecord();
        expect(h.record).toHaveBeenCalledTimes(2);
    });
});

describe('AC19 — every acceptance carries its own pre-registration session id', () => {
    it('two acceptances send two different ids, and each remembered link payload carries its own', async () => {
        render(<Harness />);
        await tickAndRecord();
        cleanup();
        latest = null;
        render(<Harness />);
        await tickAndRecord();

        expect(h.record).toHaveBeenCalledTimes(2);
        const firstId = h.record.mock.calls[0][1];
        const secondId = h.record.mock.calls[1][1];
        expect(typeof firstId).toBe('string');
        expect(typeof secondId).toBe('string');
        expect((firstId as string).length).toBeGreaterThan(0);
        expect((secondId as string).length).toBeGreaterThan(0);
        expect(secondId).not.toBe(firstId);

        expect(h.remember).toHaveBeenCalledTimes(2);
        expect(h.remember.mock.calls[0][1]).toBe(firstId);
        expect(h.remember.mock.calls[1][1]).toBe(secondId);
    });
});

describe('ConsentTick — the label and the hint', () => {
    it.each(['mr', 'en'] as const)('[%s] label is lead + link button + tail in the app language', (language) => {
        h.lang.reset(language);
        render(<Harness />);
        const { tick } = CONSENT_NOTICE[language];
        const host = screen.getByTestId('tick-host');

        expect(screen.getByTestId('consent-open-notice')).toHaveTextContent(norm(tick.link));
        const hostText = norm(host.textContent ?? '');
        if (tick.lead.trim()) expect(hostText).toContain(norm(tick.lead));
        if (tick.tail.trim()) expect(hostText).toContain(norm(tick.tail));
        expect(hook().language).toBe(language);
    });

    it('shows the muted hint while unticked, and drops it once ticked', async () => {
        render(<Harness />);
        expect(screen.getByTestId('consent-tick-hint')).toHaveTextContent(norm(CONSENT_NOTICE.mr.ctaDisabledHint));

        fireEvent.click(screen.getByTestId('consent-tick'));
        await waitFor(() => expect(screen.queryByTestId('consent-tick-hint')).toBeNull());
    });

    it('the link is a button, not a navigation', () => {
        render(<Harness />);
        const link = screen.getByTestId('consent-open-notice');
        expect(link.tagName).toBe('BUTTON');
        expect(link.getAttribute('href')).toBeNull();
    });
});

describe('AC20 — the whole tick row is the tap target', () => {
    it('the sentence, the link and the box sit in one <label> for the box', () => {
        render(<Harness />);
        const box = screen.getByTestId('consent-tick');
        const label = box.closest('label')
            ?? (box.id ? document.querySelector<HTMLLabelElement>(`label[for="${box.id}"]`) : null);
        expect(label).not.toBeNull();
        expect(label as HTMLLabelElement).toContainElement(screen.getByTestId('consent-open-notice'));
        expect(norm((label as HTMLLabelElement).textContent ?? '')).toContain(norm(CONSENT_NOTICE.mr.tick.tail));
    });

    it.each(['mr', 'en'] as const)('[%s] tapping the sentence ticks the box (and tapping it again un-ticks)', async (language) => {
        h.lang.reset(language);
        const user = userEvent.setup();
        render(<Harness />);
        const sentence = deepestElementContaining(screen.getByTestId('tick-host'), CONSENT_NOTICE[language].tick.tail);

        await user.click(sentence);
        await waitFor(() => expect(hook().ticked).toBe(true));
        expect(tickState(screen.getByTestId('consent-tick'))).toBe(true);
        expect(screen.queryByTestId('consent-notice-sheet')).toBeNull();

        await user.click(deepestElementContaining(screen.getByTestId('tick-host'), CONSENT_NOTICE[language].tick.tail));
        await waitFor(() => expect(hook().ticked).toBe(false));
    });

    it('tapping the green link opens the notice and does NOT tick', async () => {
        const user = userEvent.setup();
        render(<Harness />);

        await user.click(screen.getByTestId('consent-open-notice'));

        expect(await screen.findByTestId('consent-notice-sheet')).toBeInTheDocument();
        await settle();
        expect(hook().ticked).toBe(false);
        expect(tickState(screen.getByTestId('consent-tick'))).toBe(false);
        expect(hook().canSend).toBe(false);
    });
});

describe('ConsentNoticeSheet — the full notice, in-app (AC7, AC8)', () => {
    const openSheet = async () => {
        fireEvent.click(screen.getByTestId('consent-open-notice'));
        return screen.findByTestId('consent-notice-sheet');
    };

    it('opens from the link and closes back to the same screen, keeping the tick as it was', async () => {
        render(<Harness />);
        fireEvent.change(screen.getByTestId('harness-phone'), { target: { value: '9876543210' } });
        fireEvent.click(screen.getByTestId('consent-tick'));
        await waitFor(() => expect(hook().ticked).toBe(true));

        await openSheet();
        expect(hook().noticeOpen).toBe(true);
        fireEvent.click(screen.getByTestId('consent-notice-close'));
        await waitFor(() => expect(screen.queryByTestId('consent-notice-sheet')).toBeNull());

        expect(hook().noticeOpen).toBe(false);
        expect(tickState(screen.getByTestId('consent-tick'))).toBe(true);
        expect(screen.getByTestId('harness-phone')).toHaveValue('9876543210');
    });

    it('setNoticeOpen drives the sheet', async () => {
        render(<Harness />);
        act(() => hook().setNoticeOpen(true));
        expect(await screen.findByTestId('consent-notice-sheet')).toBeInTheDocument();
        act(() => hook().setNoticeOpen(false));
        await waitFor(() => expect(screen.queryByTestId('consent-notice-sheet')).toBeNull());
    });

    it.each(['mr', 'en'] as const)('[%s] renders the whole notice in the displayed language, with who and how to reach them', async (language) => {
        h.lang.reset(language);
        render(<Harness />);
        const sheet = await openSheet();
        const c = CONSENT_NOTICE[language];
        const text = norm(sheet.textContent ?? '');

        for (const line of [
            c.title, c.intro, c.brandLine, c.purposeCardsHeading,
            c.willNotDo.heading, ...c.willNotDo.items, c.processors,
            c.rights.heading, c.rights.where, ...c.rights.items, c.rights.withdrawal, c.rights.boardComplaint,
            c.entity.heading,
        ]) {
            expect(text).toContain(norm(line));
        }
        for (const card of c.cards) {
            expect(text).toContain(norm(card.title));
            expect(text).toContain(norm(card.data));
            expect(text).toContain(norm(card.purpose));
        }
        expect(text).toContain(DATA_FIDUCIARY.legalName);
        expect(text).toContain(DATA_FIDUCIARY.contact);
        // Corporate-register detail stays off the public screen (owed to the privacy notice).
        expect(document.body.textContent ?? '').not.toContain(DATA_FIDUCIARY.cin);
        expect(document.body.textContent ?? '').not.toContain(DATA_FIDUCIARY.registeredOffice);
    });

    it('has its own scroller', async () => {
        render(<Harness />);
        const sheet = await openSheet();
        const scrollers = [sheet, ...Array.from(sheet.querySelectorAll('*'))].filter(isScroller);
        expect(scrollers.length).toBeGreaterThan(0);
    });

    it('its language switch calls the app setLanguage, and the notice and the hook follow', async () => {
        render(<Harness />);
        const sheet = await openSheet();
        expect(norm(sheet.textContent ?? '')).toContain(norm(CONSENT_NOTICE.mr.title));

        fireEvent.click(within(sheet).getByText('English'));

        expect(h.lang.calls).toContain('en');
        await waitFor(() =>
            expect(norm(screen.getByTestId('consent-notice-sheet').textContent ?? ''))
                .toContain(norm(CONSENT_NOTICE.en.title)));
        expect(hook().language).toBe('en');

        fireEvent.click(within(screen.getByTestId('consent-notice-sheet')).getByText('मराठी'));
        expect(h.lang.calls).toContain('mr');
        await waitFor(() => expect(hook().language).toBe('mr'));
    });

    it('never links to a document by href — that would unload the page and lose the session', async () => {
        render(<Harness />);
        const sheet = await openSheet();
        const docLinks = Array.from(sheet.querySelectorAll('a[href]'))
            .map((a) => a.getAttribute('href') ?? '')
            .filter((href) => href.includes('/legal/') || href.endsWith('.md'));
        expect(docLinks).toEqual([]);
    });

    it.each([
        ['terms', 'consent-open-terms'],
        ['privacy', 'consent-open-privacy'],
    ] as const)('opens %s inside the same sheet from /legal/{doc}_{lang}.md and comes back with the back control', async (doc, testId) => {
        render(<Harness />);
        const before = window.location.href;
        const sheet = await openSheet();

        fireEvent.click(within(sheet).getByTestId(testId));

        await waitFor(() => expect(screen.getByTestId('legal-document')).toHaveTextContent('Legal heading'));
        expect(screen.getByTestId('consent-notice-sheet')).toContainElement(screen.getByTestId('legal-document'));
        const fetchMock = vi.mocked(globalThis.fetch);
        const urls = fetchMock.mock.calls.map(([u]) => String(u));
        expect(urls.some((u) => new RegExp(`/legal/${doc}_mr\\.md$`).test(u))).toBe(true);
        expect(window.location.href).toBe(before);

        const back = norm(translate('consentGate.noticeBack', 'mr')).replace(EDGE, '');
        const backControl = within(screen.getByTestId('consent-notice-sheet'))
            .getByRole('button', { name: new RegExp(back.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) });
        fireEvent.click(backControl);

        await waitFor(() => expect(screen.queryByTestId('legal-document')).toBeNull());
        expect(norm(screen.getByTestId('consent-notice-sheet').textContent ?? ''))
            .toContain(norm(CONSENT_NOTICE.mr.title));
    });

    it('fetches the document in the displayed language', async () => {
        h.lang.reset('en');
        render(<Harness />);
        const sheet = await openSheet();
        fireEvent.click(within(sheet).getByTestId('consent-open-privacy'));
        await waitFor(() => {
            const urls = vi.mocked(globalThis.fetch).mock.calls.map(([u]) => String(u));
            expect(urls.some((u) => /\/legal\/privacy_en\.md$/.test(u))).toBe(true);
        });
    });
});

describe('AC21 — Android hardware Back inside the notice', () => {
    const activeBackListeners = () =>
        h.back.registrations.filter((r) => r.event === 'backButton' && r.remove.mock.calls.length === 0);

    /** Capacitor calls every registered backButton listener. */
    const pressBack = async () => {
        const active = activeBackListeners();
        expect(active.length).toBeGreaterThan(0);
        await act(async () => {
            for (const r of active) r.cb({ canGoBack: false });
            await new Promise((resolve) => setTimeout(resolve, 20));
        });
    };

    beforeEach(() => { h.native = true; });

    it('goes from a document back to the notice, then closes the notice; never exits; the number stays', async () => {
        render(<Harness />);
        fireEvent.change(screen.getByTestId('harness-phone'), { target: { value: '9876543210' } });
        expect(activeBackListeners()).toHaveLength(0);

        fireEvent.click(screen.getByTestId('consent-open-notice'));
        const sheet = await screen.findByTestId('consent-notice-sheet');
        await waitFor(() => expect(activeBackListeners().length).toBeGreaterThan(0));

        fireEvent.click(within(sheet).getByTestId('consent-open-terms'));
        await waitFor(() => expect(screen.getByTestId('legal-document')).toHaveTextContent('Legal heading'));

        await pressBack();
        await waitFor(() => expect(screen.queryByTestId('legal-document')).toBeNull());
        expect(screen.getByTestId('consent-notice-sheet')).toBeInTheDocument();
        expect(norm(screen.getByTestId('consent-notice-sheet').textContent ?? ''))
            .toContain(norm(CONSENT_NOTICE.mr.title));

        await pressBack();
        await waitFor(() => expect(screen.queryByTestId('consent-notice-sheet')).toBeNull());

        expect(h.back.exitApp).not.toHaveBeenCalled();
        expect(screen.getByTestId('harness-phone')).toHaveValue('9876543210');
        expect(screen.getByTestId('consent-tick')).toBeInTheDocument();
        expect(hook().noticeOpen).toBe(false);
        // Registered only while open.
        await waitFor(() => expect(activeBackListeners()).toHaveLength(0));
    });

    it('Back on the notice itself closes it', async () => {
        render(<Harness />);
        fireEvent.click(screen.getByTestId('consent-open-notice'));
        await screen.findByTestId('consent-notice-sheet');
        await waitFor(() => expect(activeBackListeners().length).toBeGreaterThan(0));

        await pressBack();

        await waitFor(() => expect(screen.queryByTestId('consent-notice-sheet')).toBeNull());
        expect(h.back.exitApp).not.toHaveBeenCalled();
        expect(tickState(screen.getByTestId('consent-tick'))).toBe(false);
    });
});

describe('AC9 — every string the tick row and the sheet render is in the hashed text', () => {
    it.each(['mr', 'en'] as const)('[%s] tick row (unticked, with its hint)', (language) => {
        h.lang.reset(language);
        render(<Harness />);
        expect(unhashedStringsUnder(screen.getByTestId('tick-host'), language)).toEqual([]);
    });

    it.each(['mr', 'en'] as const)('[%s] notice sheet', async (language) => {
        h.lang.reset(language);
        render(<Harness />);
        fireEvent.click(screen.getByTestId('consent-open-notice'));
        const sheet = await screen.findByTestId('consent-notice-sheet');
        expect(unhashedStringsUnder(sheet, language)).toEqual([]);
    });

    it.each(['mr', 'en'] as const)('[%s] and every notice string is actually displayable (tick row + sheet)', async (language) => {
        h.lang.reset(language);
        render(<Harness />);
        const tickText = norm(screen.getByTestId('tick-host').textContent ?? '');
        fireEvent.click(screen.getByTestId('consent-open-notice'));
        const sheet = await screen.findByTestId('consent-notice-sheet');
        const shown = `${tickText} ${norm(sheet.textContent ?? '')}`;

        const notShown = displayableCopy(language).filter((s) => !shown.includes(norm(s)));
        expect(notShown).toEqual([]);
    });

    it.each(['mr', 'en'] as const)('[%s] AC13 — every non-metadata line of the hash is displayed in the sheet or the tick row', async (language) => {
        h.lang.reset(language);
        render(<Harness />);
        const tickText = norm(screen.getByTestId('tick-host').textContent ?? '');
        fireEvent.click(screen.getByTestId('consent-open-notice'));
        const sheet = await screen.findByTestId('consent-notice-sheet');
        const shown = `${tickText} ${norm(sheet.textContent ?? '')}`;
        const squash = (s: string) => s.replace(/\s+/g, '');

        const c = CONSENT_NOTICE[language];
        const contactLine = `${c.entity.contactLabel}:${DATA_FIDUCIARY.contact}`;
        const METADATA = /^(notice-version|terms-version|privacy-version|language|card|purposes|categories):/;
        const hidden = canonicalNoticeText(language)
            .split('\n')
            .filter((line) => line.trim().length > 0 && !METADATA.test(line))
            .filter((line) => {
                if (line === contactLine) {
                    // Displayed as the label and the address, not necessarily glued by ':'.
                    return !(shown.includes(norm(c.entity.contactLabel)) && shown.includes(DATA_FIDUCIARY.contact));
                }
                // The tick label may be hashed as one line; it is displayed as one label.
                return !shown.includes(norm(line)) && !squash(shown).includes(squash(line));
            });
        expect(hidden).toEqual([]);
    });

    it.each(['mr', 'en'] as const)('[%s] AC13 — each field shows where the spec puts it', async (language) => {
        h.lang.reset(language);
        render(<Harness />);
        const c = CONSENT_NOTICE[language];

        // Tick row: lead / link / tail and the hint.
        const tickText = norm(screen.getByTestId('tick-host').textContent ?? '');
        for (const s of [c.tick.lead, c.tick.link, c.tick.tail, c.ctaDisabledHint].filter((x) => x.trim())) {
            expect(tickText).toContain(norm(s));
        }

        // Sheet: the notice, with acceptanceMeaning AFTER the cards, and the two document buttons.
        fireEvent.click(screen.getByTestId('consent-open-notice'));
        const sheet = await screen.findByTestId('consent-notice-sheet');
        const sheetText = norm(sheet.textContent ?? '');
        expect(sheetText).toContain(norm(c.title));
        expect(sheetText).toContain(norm(c.acceptanceMeaning));
        const lastCard = c.cards[c.cards.length - 1];
        expect(sheetText.indexOf(norm(c.acceptanceMeaning))).toBeGreaterThan(sheetText.indexOf(norm(lastCard.purpose)));
        expect(sheetText.indexOf(norm(c.acceptanceMeaning))).toBeGreaterThan(sheetText.indexOf(norm(c.cards[0].title)));

        const terms = within(sheet).getByTestId('consent-open-terms');
        const privacy = within(sheet).getByTestId('consent-open-privacy');
        expect(terms.tagName).toBe('BUTTON');
        expect(privacy.tagName).toBe('BUTTON');
        expect(terms).toHaveTextContent(norm(c.links.terms));
        expect(privacy).toHaveTextContent(norm(c.links.privacy));
    });

    it.each(['mr', 'en'] as const)('[%s] AC15 — legal name and contact shown in the sheet; CIN and office neither shown nor hashed', async (language) => {
        h.lang.reset(language);
        render(<Harness />);
        fireEvent.click(screen.getByTestId('consent-open-notice'));
        const sheet = await screen.findByTestId('consent-notice-sheet');

        expect(sheet).toHaveTextContent(DATA_FIDUCIARY.legalName);
        expect(sheet).toHaveTextContent(DATA_FIDUCIARY.contact);
        expect(document.body.textContent ?? '').not.toContain(DATA_FIDUCIARY.cin);
        expect(document.body.textContent ?? '').not.toContain(DATA_FIDUCIARY.registeredOffice);
        expect(canonicalNoticeText(language)).not.toContain(DATA_FIDUCIARY.cin);
        expect(canonicalNoticeText(language)).not.toContain(DATA_FIDUCIARY.registeredOffice);
    });
});

describe('useConsentBeforeOtp.recordIfNeeded — record first, mark after, never on failure', () => {
    it('rejects when not ticked, and records nothing (AC10)', async () => {
        render(<Harness />);
        let caught: unknown = null;
        await act(async () => {
            try { await hook().recordIfNeeded(); } catch (e) { caught = e ?? 'thrown'; }
        });
        expect(caught).not.toBeNull();
        expect(h.record).not.toHaveBeenCalled();
        expect(h.remember).not.toHaveBeenCalled();
        expect(await deviceMark()).not.toBe(NOTICE_VERSION);
        expect(hook().status).toBe('required');
    });

    it('when ticked: records buildConsentAcceptance(language) with a minted session id, then remembers, marks the device and passes', async () => {
        let resolveRecord: (v: typeof IDS) => void = () => undefined;
        h.record.mockImplementation(() => new Promise((resolve) => { resolveRecord = resolve; }));
        render(<Harness />);
        fireEvent.click(screen.getByTestId('consent-tick'));
        await waitFor(() => expect(hook().canSend).toBe(true));

        let pending: Promise<void> = Promise.resolve();
        act(() => { pending = hook().recordIfNeeded(); });
        await waitFor(() => expect(h.record).toHaveBeenCalledTimes(1));

        // Nothing is remembered or marked while the write is in flight.
        await settle();
        expect(h.remember).not.toHaveBeenCalled();
        expect(await deviceMark()).not.toBe(NOTICE_VERSION);
        expect(hook().status).toBe('required');

        const [acceptance, sessionId] = h.record.mock.calls[0];
        expect(acceptance).toEqual(buildConsentAcceptance('mr'));
        expect(typeof sessionId).toBe('string');
        expect((sessionId as string).length).toBeGreaterThan(0);

        await act(async () => { resolveRecord(IDS); await pending; });

        expect(h.remember).toHaveBeenCalledTimes(1);
        expect(h.remember.mock.calls[0][0]).toEqual(buildConsentAcceptance('mr'));
        expect(h.remember.mock.calls[0][1]).toBe(sessionId);
        await waitFor(async () => expect(await deviceMark()).toBe(NOTICE_VERSION), { timeout: 5000 });
        expect(hook().status).toBe('passed');
        expect(hook().canSend).toBe(true);
    });

    it('records the language on screen at the time — English after a switch', async () => {
        render(<Harness />);
        fireEvent.click(screen.getByTestId('consent-tick'));
        fireEvent.click(screen.getByTestId('consent-open-notice'));
        const sheet = await screen.findByTestId('consent-notice-sheet');
        fireEvent.click(within(sheet).getByText('English'));
        fireEvent.click(screen.getByTestId('consent-notice-close'));
        await waitFor(() => expect(hook().language).toBe('en'));
        await waitFor(() => expect(hook().canSend).toBe(true));

        await act(async () => { await hook().recordIfNeeded(); });

        const acceptance = h.record.mock.calls[0][0] as ReturnType<typeof buildConsentAcceptance>;
        expect(acceptance.displayedLanguage).toBe('en');
        expect(acceptance.canonicalNotice).toBe(canonicalNoticeText('en'));
    });

    it('on failure rethrows, marks nothing, remembers nothing, keeps the tick and stays required', async () => {
        const failure = new Error('offline');
        h.record.mockRejectedValue(failure);
        render(<Harness />);
        fireEvent.click(screen.getByTestId('consent-tick'));
        await waitFor(() => expect(hook().canSend).toBe(true));

        let caught: unknown = null;
        await act(async () => {
            try { await hook().recordIfNeeded(); } catch (e) { caught = e; }
        });

        expect(caught).toBe(failure);
        await settle();
        expect(h.remember).not.toHaveBeenCalled();
        expect(await deviceMark()).not.toBe(NOTICE_VERSION);
        expect(hook().ticked).toBe(true);
        expect(hook().recording).toBe(false);
        expect(hook().status).toBe('required');
        expect(hook().canSend).toBe(true);
        expect(tickState(screen.getByTestId('consent-tick'))).toBe(true);
    });

    it('a second attempt after a failure records again (retry)', async () => {
        h.record.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(IDS);
        render(<Harness />);
        fireEvent.click(screen.getByTestId('consent-tick'));
        await waitFor(() => expect(hook().canSend).toBe(true));

        await act(async () => { try { await hook().recordIfNeeded(); } catch { /* first attempt fails */ } });
        await act(async () => { await hook().recordIfNeeded(); });

        expect(h.record).toHaveBeenCalledTimes(2);
        expect(h.remember).toHaveBeenCalledTimes(1);
        await waitFor(() => expect(hook().status).toBe('passed'));
    });
});

describe('AC16 — while the acceptance is being written', () => {
    it('the tick is held, sending is off, and a second call makes no second write', async () => {
        const user = userEvent.setup();
        let resolveRecord: (v: typeof IDS) => void = () => undefined;
        h.record.mockImplementation(() => new Promise((resolve) => { resolveRecord = resolve; }));
        render(<Harness />);
        fireEvent.click(screen.getByTestId('consent-tick'));
        await waitFor(() => expect(hook().canSend).toBe(true));

        let first: Promise<void> = Promise.resolve();
        act(() => { first = hook().recordIfNeeded(); });
        await waitFor(() => expect(hook().recording).toBe(true));
        expect(h.record).toHaveBeenCalledTimes(1);
        expect(hook().canSend).toBe(false);
        expect(hook().status).toBe('required');

        // The tick cannot be changed while recording.
        const box = screen.getByTestId('consent-tick');
        expect(isTickDisabled(box)).toBe(true);
        await user.click(box);
        await settle();
        expect(hook().ticked).toBe(true);
        expect(tickState(box)).toBe(true);

        // A second tap reuses the one in-flight write and does not report success early.
        let secondSettled = false;
        let second: Promise<void> = Promise.resolve();
        act(() => { second = hook().recordIfNeeded(); });
        void second.then(() => { secondSettled = true; }, () => { secondSettled = true; });
        await settle();
        expect(h.record).toHaveBeenCalledTimes(1);
        expect(secondSettled).toBe(false);

        await act(async () => { resolveRecord(IDS); await first; await second; });

        expect(h.record).toHaveBeenCalledTimes(1);
        expect(h.remember).toHaveBeenCalledTimes(1);
        expect(hook().recording).toBe(false);
        expect(hook().status).toBe('passed');
        expect(hook().canSend).toBe(true);
    });

    it('a failed in-flight write rejects every caller that joined it, once', async () => {
        let rejectRecord: (e: unknown) => void = () => undefined;
        h.record.mockImplementation(() => new Promise((_resolve, reject) => { rejectRecord = reject; }));
        render(<Harness />);
        fireEvent.click(screen.getByTestId('consent-tick'));
        await waitFor(() => expect(hook().canSend).toBe(true));

        const outcomes: string[] = [];
        act(() => {
            void hook().recordIfNeeded().then(() => outcomes.push('ok'), () => outcomes.push('failed'));
        });
        await waitFor(() => expect(hook().recording).toBe(true));
        act(() => {
            void hook().recordIfNeeded().then(() => outcomes.push('ok'), () => outcomes.push('failed'));
        });

        await act(async () => { rejectRecord(new Error('offline')); await new Promise((r) => setTimeout(r, 20)); });

        expect(h.record).toHaveBeenCalledTimes(1);
        expect(outcomes).toEqual(['failed', 'failed']);
        expect(hook().recording).toBe(false);
        expect(hook().status).toBe('required');
        expect(hook().ticked).toBe(true);
    });
});
